// Read-only browser checks of going back to the previous version: the answers are faked here, nothing is changed.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const OLDER = "0.0.1";
const UPDATED_AT = "2026-11-20T09:30:00+00:00";

function newest(current, overrides = {}) {
  return { currentVersion: current, latestVersion: current, available: false, canInstall: true, checked: true, notes: null, problem: null, skipped: false, ...overrides };
}

// Fakes the app closing after going back and opening again as the older version.
async function goingBack(page, current, rollback) {
  let phase = "running";
  let posted = null;
  await page.route("**/api/updates*", (route) => route.fulfill({ json: newest(phase === "back" ? OLDER : current) }));
  await page.route("**/api/updates/rollback", (route) => {
    if (route.request().method() === "POST") {
      posted = route.request().postDataJSON();
      phase = "closed";
      return route.fulfill({ json: { restarting: true } });
    }
    return route.fulfill({ json: phase === "back" ? { available: false, version: null, undoesChanges: false, updatedAt: null } : rollback });
  });
  let downChecks = 0;
  await page.route("**/api/info", async (route) => {
    if (phase === "closed") {
      if (++downChecks >= 2) phase = "back";
      return route.abort("connectionrefused");
    }
    const real = await route.fetch();
    const body = await real.json();
    return route.fulfill({ response: real, json: phase === "back" ? { ...body, version: OLDER } : body });
  });
  return () => posted;
}

async function openMenu(page) {
  await page.goto(BASE);
  await page.waitForSelector("html.ready");
  await page.click("#menuToggle");
  await page.locator("#rollbackUpdate").waitFor({ state: "visible" });
}

(async () => {
  const current = (await (await fetch(`${BASE}/api/info`)).json()).version;
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    // Nothing to go back to (the developer's Mac, or no update yet): no button.
    const plain = await browser.newContext();
    const quiet = await plain.newPage();
    await quiet.goto(BASE);
    await quiet.waitForSelector("html.ready");
    await quiet.click("#menuToggle");
    assert.ok(await quiet.locator("#rollbackUpdate").evaluate((node) => node.classList.contains("hidden")));
    await plain.close();

    // Same data format: going back keeps the data and says so; the window comes back as the older version.
    const keep = await browser.newContext();
    const page = await keep.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const sent = await goingBack(page, current, { available: true, version: OLDER, undoesChanges: false, updatedAt: UPDATED_AT });
    await openMenu(page);
    assert.equal(await page.locator("#rollbackUpdate").textContent(), `Go back to version ${OLDER}`);
    await page.click("#rollbackUpdate");
    assert.equal(await page.locator("#appDialogTitle").textContent(), `Go back to version ${OLDER}?`);
    assert.match(await page.locator("#appDialogBody").textContent(), /Your entries, bills and settings stay as they are\./);
    assert.equal(await page.locator("#appDialogConfirm").textContent(), "Go back");
    await page.click("#appDialogConfirm");
    await page.locator(".toast").filter({ hasText: `Went back to version ${OLDER} ✓` }).waitFor({ timeout: 20000 });
    assert.deepEqual(sent(), { undoChanges: false });
    await page.click("#menuToggle");
    assert.ok(await page.locator("#rollbackUpdate").evaluate((node) => node.classList.contains("hidden")));
    assert.deepEqual(errors, []);
    await keep.close();

    // A newer data format: the warning says changes since the update are undone and a copy is kept; Cancel changes nothing.
    const undo = await browser.newContext();
    const risky = await undo.newPage();
    const sentUndo = await goingBack(risky, current, { available: true, version: OLDER, undoesChanges: true, updatedAt: UPDATED_AT });
    await openMenu(risky);
    await risky.click("#rollbackUpdate");
    const warning = await risky.locator("#appDialogBody").textContent();
    assert.match(warning, /everything changed since then is undone/);
    assert.match(warning, /\(20\/Nov\/26 \d\d:\d\d\)/);
    assert.match(warning, /kept as a copy in the data folder/);
    assert.equal(await risky.locator("#appDialogConfirm").textContent(), "Go back and undo changes");
    await risky.click("#appDialogCancel");
    assert.equal(sentUndo(), null);
    await risky.evaluate(() => window.applyLanguage("hi"));
    await risky.click("#menuToggle");
    assert.equal(await risky.locator("#rollbackUpdate").textContent(), `Version ${OLDER} पर वापस जाएँ`);
    await risky.click("#rollbackUpdate");
    assert.match(await risky.locator("#appDialogBody").textContent(), /उसके बाद के सभी बदलाव हट जाएँगे/);
    assert.equal(await risky.locator("#appDialogConfirm").textContent(), "वापस जाएँ और बदलाव हटाएँ");
    await risky.evaluate(() => window.applyLanguage("en"));
    await risky.click("#appDialogConfirm");
    await risky.locator(".toast").filter({ hasText: `Went back to version ${OLDER} ✓` }).waitFor({ timeout: 20000 });
    assert.deepEqual(sentUndo(), { undoChanges: true });
    await undo.close();

    // Refused by the app: the error is shown and nothing closes.
    const refused = await browser.newContext();
    const failed = await refused.newPage();
    await failed.route("**/api/updates/rollback", (route) => (route.request().method() === "POST"
      ? route.fulfill({ status: 400, json: { errors: ["There is no earlier version to go back to."] } })
      : route.fulfill({ json: { available: true, version: null, undoesChanges: false, updatedAt: UPDATED_AT } })));
    await openMenu(failed);
    assert.equal(await failed.locator("#rollbackUpdate").textContent(), "Go back to the previous version");
    await failed.click("#rollbackUpdate");
    assert.equal(await failed.locator("#appDialogTitle").textContent(), "Go back to the previous version?");
    await failed.click("#appDialogConfirm");
    await failed.locator(".toast.err").filter({ hasText: "Could not go back: There is no earlier version to go back to." }).waitFor();
    assert.ok(!(await failed.locator("#updateDialog").evaluate((node) => node.open)));
    await refused.close();

    // After going back, the version gone back from is offered only in the menu, not in the bar.
    const skipped = await browser.newContext();
    const later = await skipped.newPage();
    await later.route("**/api/updates*", (route) => route.fulfill({ json: newest(OLDER, { latestVersion: "0.0.2", available: true, skipped: true }) }));
    await later.goto(BASE);
    await later.waitForSelector("html.ready");
    await later.click("#menuToggle");
    await later.locator("#updateInfo").filter({ hasText: "Version 0.0.2 is available. You went back from it." }).waitFor();
    assert.ok(await later.locator("#installUpdate").isVisible());
    assert.ok(await later.locator("#updateBar").evaluate((node) => node.classList.contains("hidden")));
    await skipped.close();

    console.log("Going back checks passed");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
