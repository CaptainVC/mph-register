// Read-only browser checks of the update bar and menu: the update answers are faked here, nothing is downloaded or installed.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const NEW = "9.9.9";

function status(current, overrides = {}) {
  return { currentVersion: current, latestVersion: NEW, available: true, canInstall: true, checked: true, notes: "- Faster bills\n- Clearer totals", problem: null, ...overrides };
}

async function open(context, answer) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/updates*", (route) => route.fulfill({ json: answer() }));
  await page.goto(BASE);
  await page.waitForSelector("html.ready");
  return { page, errors };
}

(async () => {
  const info = await (await fetch(`${BASE}/api/info`)).json();
  const current = info.version;
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    // Outside the Windows app nothing is offered: the menu only shows the version.
    const plain = await browser.newContext();
    const quiet = await plain.newPage();
    await quiet.goto(BASE);
    await quiet.waitForSelector("html.ready");
    assert.ok(await quiet.locator("#updateBar").evaluate((node) => node.classList.contains("hidden")));
    await quiet.click("#menuToggle");
    assert.equal(await quiet.locator("#updateInfo").textContent(), `Version ${current}`);
    assert.ok(await quiet.locator("#installUpdate").evaluate((node) => node.classList.contains("hidden")));
    await plain.close();

    // A newer version: the bar offers it, shows what is new and can be put off until the app is opened again.
    const later = await browser.newContext();
    const offered = await open(later, () => status(current));
    const bar = offered.page.locator("#updateBar");
    await bar.waitFor({ state: "visible" });
    assert.match(await bar.textContent(), new RegExp(`New version ${NEW.replaceAll(".", "\\.")} is ready`));
    await offered.page.click("#updateNotes");
    assert.equal(await offered.page.locator("#appDialogTitle").textContent(), `What's new in version ${NEW}`);
    assert.match(await offered.page.locator("#appDialogBody").textContent(), /Faster bills/);
    await offered.page.click("#appDialogConfirm");
    await offered.page.evaluate(() => window.applyLanguage("hi"));
    assert.match(await bar.textContent(), new RegExp(`नया Version ${NEW.replaceAll(".", "\\.")} तैयार है`));
    assert.equal(await offered.page.locator("#updateNow").textContent(), "अभी Update करें");
    await offered.page.evaluate(() => window.applyLanguage("en"));
    await offered.page.click("#updateLater");
    assert.ok(await bar.evaluate((node) => node.classList.contains("hidden")));
    await offered.page.reload();
    await offered.page.waitForSelector("html.ready");
    assert.ok(await bar.evaluate((node) => node.classList.contains("hidden")), "Later keeps the bar away in this window");
    await offered.page.click("#menuToggle");
    assert.match(await offered.page.locator("#updateInfo").textContent(), new RegExp(`Version ${NEW.replaceAll(".", "\\.")} is available\\. You have`));
    assert.ok(await offered.page.locator("#installUpdate").isVisible());
    assert.deepEqual(offered.errors, []);
    await later.close();

    // The Mac or a build folder: the version is named but cannot be installed.
    const elsewhere = await browser.newContext();
    const mac = await open(elsewhere, () => status(current, { canInstall: false }));
    await mac.page.click("#menuToggle");
    assert.match(await mac.page.locator("#updateInfo").textContent(), /Updates install only in the Windows app/);
    assert.ok(await mac.page.locator("#updateBar").evaluate((node) => node.classList.contains("hidden")));
    await elsewhere.close();

    // Checking by hand when GitHub cannot be reached says so in the menu.
    const offline = await browser.newContext();
    let checks = 0;
    const noNet = await open(offline, () => (++checks > 1
      ? status(current, { latestVersion: null, available: false, problem: "Could not check for a new version. Is the internet on?" })
      : status(current, { available: false, latestVersion: current })));
    await noNet.page.click("#menuToggle");
    await noNet.page.click("#checkUpdates");
    await noNet.page.waitForFunction(() => document.getElementById("updateInfo").textContent.includes("internet"));
    await offline.close();

    // A failed download leaves the app as it was and says why.
    const failing = await browser.newContext();
    const failed = await open(failing, () => status(current));
    await failed.page.route("**/api/updates/install", (route) => route.fulfill({ status: 400, json: { errors: ["The downloaded file was not complete. Try again."] } }));
    await failed.page.click("#updateNow");
    await failed.page.click("#appDialogConfirm");
    await failed.page.locator(".toast.err").filter({ hasText: "Could not update: The downloaded file was not complete." }).waitFor();
    assert.ok(!(await failed.page.locator("#updateDialog").evaluate((node) => node.open)));
    await failed.page.locator("#updateBar").waitFor({ state: "visible" });
    await failing.close();

    // Installing: the window waits while the app is closed, reloads when it answers again and names the new version.
    const installing = await browser.newContext();
    let phase = "running";
    const page = await installing.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/updates*", (route) => route.fulfill({ json: phase === "updated" ? status(NEW, { available: false, latestVersion: NEW }) : status(current) }));
    await page.route("**/api/updates/install", (route) => { phase = "closed"; return route.fulfill({ json: { restarting: true } }); });
    let downChecks = 0;
    await page.route("**/api/info", async (route) => {
      if (phase === "closed") {
        if (++downChecks >= 2) phase = "updated";
        return route.abort("connectionrefused");
      }
      const real = await route.fetch();
      const body = await real.json();
      return route.fulfill({ response: real, json: phase === "updated" ? { ...body, version: NEW } : body });
    });
    await page.goto(BASE);
    await page.waitForSelector("html.ready");
    await page.click("#updateNow");
    assert.equal(await page.locator("#appDialogTitle").textContent(), `Update to version ${NEW}?`);
    await page.click("#appDialogConfirm");
    await page.locator(".toast").filter({ hasText: `Updated to version ${NEW} ✓` }).waitFor({ timeout: 20000 });
    assert.ok(await page.locator("#updateBar").evaluate((node) => node.classList.contains("hidden")));
    assert.deepEqual(errors, []);
    await installing.close();

    console.log("Update bar and menu checks passed");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
