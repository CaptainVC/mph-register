// Run against a fresh test data directory; this scenario creates its own party, finish and entries.
// Deleting an entry from the form, undoing it, and restoring a deleted entry only once nothing clashes with it.
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const PARTY = "DELUI PARTY";
const FINISH = "DELUI FIN";
const MONTH = "2026-11";

async function call(path, method = "GET", body) {
  const response = await fetch(BASE + path, {
    method, headers: { "X-MPH-Request": "1", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = response.status === 204 ? null : await response.json();
  return { ok: response.ok, status: response.status, json };
}

async function must(path, method, body) {
  const result = await call(path, method, body);
  assert.ok(result.ok, `${method || "GET"} ${path}: ${JSON.stringify(result.json)}`);
  return result.json;
}

const entry = (inwardNo, designNo) => ({
  registerMonth: MONTH, inwardNo, entryDate: `${MONTH}-04`, party: PARTY, designNo, lotNo: `L${inwardNo}`, than: 10, finish: FINISH,
  dispatches: [{ qty: 6, gatePass: `GP${inwardNo}`, date: `${MONTH}-05` }],
});

async function seed() {
  await must("/api/masters/group", "POST", { name: "DELUI GROUP", active: true });
  await must("/api/masters/finish", "POST", { name: FINISH, active: true, group: "DELUI GROUP", color: "black" });
  await must("/api/masters/style", "POST", {
    name: "DELUI STYLE", gpnColumn: "gatePass", dnColumn: "designNo", lotColumn: "lotNo",
    lines: "onePerEntry", order: "inward", combineSmallEntries: false,
  });
  await must("/api/masters/party", "POST", { name: PARTY, active: true, discount: 0, billingStyle: "DELUI STYLE", color: "black" });
  const first = await must("/api/entries", "POST", entry(8801, "DEL1"));
  const second = await must("/api/entries", "POST", entry(8802, "DEL2"));
  return [first.id, second.id];
}

// The question opens after the screen has asked the server, so its title is awaited.
async function dialogTitled(page, title) {
  await page.waitForFunction((text) => document.getElementById("appDialog").open
    && document.getElementById("appDialogTitle")?.textContent === text, title);
}

async function waitFor(check, message) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await check()) return;
    await delay(100);
  }
  assert.fail(message);
}

(async () => {
  const [firstId, secondId] = await seed();
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.clock.install({ time: new Date("2026-11-21T12:00:00") });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
    assert.equal(await page.locator("#deleteEntry").isVisible(), false, "a new entry has nothing to delete");

    const openEntry = async (inwardNo) => {
      await page.locator('[data-view="register"]').click();
      await page.locator("#registerSearch").fill("DELUI");
      const row = page.locator("#registerTable tbody tr").filter({ hasText: String(inwardNo) }).first();
      await row.waitFor();
      await row.locator("td").first().click();
      await page.waitForFunction((no) => document.getElementById("formTitle").textContent.startsWith(`Correcting INW. NO. ${no}`), inwardNo);
    };

    // Cancelling the question keeps the entry; confirming deletes it and offers Undo.
    await openEntry(8801);
    assert.equal(await page.locator("#deleteEntry").isVisible(), true);
    await page.locator("#deleteEntry").click();
    await dialogTitled(page, "Delete this entry?");
    await page.locator("#appDialogCancel").click();
    assert.ok((await call(`/api/entries/${firstId}`)).ok, "cancel keeps the entry");
    await page.locator("#deleteEntry").click();
    await dialogTitled(page, "Delete this entry?");
    await page.locator("#appDialogConfirm").click();
    await page.locator("#undoDelete").waitFor();
    await waitFor(async () => (await page.locator("#toasts").textContent()).includes("Deleted ✓ INW. NO. 8801"), "delete is announced by a toast");
    assert.equal((await call(`/api/entries/${firstId}`)).status, 404);
    assert.equal(await page.locator("#deleteEntry").isVisible(), false, "the form is back to a new entry");

    await page.locator("#undoDelete").click();
    await dialogTitled(page, "Restore this entry?");
    await page.locator("#appDialogConfirm").click();
    await waitFor(async () => (await page.locator("#toasts").textContent()).includes("Restored ✓ INW. NO. 8801"), "undo restores the entry");
    const restored = await must(`/api/entries/${firstId}`);
    assert.equal(restored.dispatches.length, 1, "dispatches come back with the entry");
    assert.equal(restored.designNo, "DEL1");

    // A deleted entry whose INW. NO. was used again cannot be restored until the number is free again.
    await must(`/api/entries/${firstId}`, "DELETE");
    const clash = await must("/api/entries", "POST", entry(8801, "CLASH"));
    await page.locator('[data-view="register"]').click();
    await page.locator("#openDeletedEntries").click();
    const item = page.locator(`#deletedForm .deleted-item[data-id="${firstId}"]`);
    await item.waitFor();
    assert.equal(await item.locator("button").isDisabled(), true);
    assert.ok((await item.locator(".deleted-notes .clash").textContent()).includes("INW. NO. 8801"));
    await page.locator("#deletedForm .drawer-foot button").filter({ hasText: /^Close$/ }).click();

    await must(`/api/entries/${clash.id}`, "PUT", entry(8899, "CLASH"));
    await page.locator("#openDeletedEntries").click();
    // The list is read again on opening: the clash is gone, so Restore is offered.
    await item.locator("button:enabled").waitFor();
    await item.locator("button").click();
    await dialogTitled(page, "Restore this entry?");
    await page.locator("#appDialogConfirm").click();
    await waitFor(async () => (await page.locator(`#deletedForm .deleted-item[data-id="${firstId}"]`).count()) === 0, "the restored entry leaves the list");
    assert.ok((await call(`/api/entries/${firstId}`)).ok);
    await page.locator("#deletedForm .drawer-foot button").filter({ hasText: /^Close$/ }).click();

    // An entry already billed (here outside the app) is not deleted; the reason is shown.
    await must("/api/billing/elsewhere", "POST", { entryIds: [secondId], note: "Billed in Excel" });
    await openEntry(8802);
    await page.locator("#deleteEntry").click();
    await dialogTitled(page, "Delete this entry?");
    await page.locator("#appDialogConfirm").click();
    await dialogTitled(page, "Entry not deleted");
    assert.ok((await page.locator("#appDialogBody").textContent()).includes("billed outside the app"));
    await page.locator("#appDialogConfirm").click();
    assert.ok((await call(`/api/entries/${secondId}`)).ok);

    // Deleting everything permanently asks first; cancelling keeps the list, confirming empties it for good.
    await must(`/api/entries/${firstId}`, "DELETE");
    await page.locator('[data-view="register"]').click();
    await page.locator("#openDeletedEntries").click();
    await page.locator(`#deletedForm .deleted-item[data-id="${firstId}"]`).waitFor();
    await page.locator("#purgeDeletedEntries").click();
    await dialogTitled(page, "Delete all permanently?");
    await page.locator("#appDialogCancel").click();
    assert.equal((await must("/api/entries/deleted")).length, 1, "cancel keeps the deleted entry");
    await page.locator("#purgeDeletedEntries").click();
    await dialogTitled(page, "Delete all permanently?");
    await page.locator("#appDialogConfirm").click();
    await page.locator("#deletedForm .deleted-empty").waitFor();
    assert.equal(await page.locator("#purgeDeletedEntries").count(), 0, "nothing is left to delete");
    assert.deepEqual(await must("/api/entries/deleted"), []);
    await page.locator("#deletedForm .drawer-foot button").filter({ hasText: /^Close$/ }).click();

    assert.deepEqual(errors, []);
    console.log("Passed delete, undo, clash-checked restore, billed-entry refusal and permanent delete checks.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
