// Run against a fresh test data directory; this scenario creates its own parties, finishes and entries.
// Register cells edit in place like a spreadsheet; only INW. NO. opens the whole entry in the form.
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { chromium } = require("playwright-core");
const { chooseDropdown, dropdownOption } = require("./dropdown-helpers");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const FIRST = "INLINE ALPHA";
const SECOND = "INLINE BETA";
const FINISH = "INLINE SGZ";
const OTHER_FINISH = "INLINE S2G";

async function call(path, method = "GET", body) {
  const response = await fetch(BASE + path, {
    method, headers: { "X-MPH-Request": "1", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(json)}`);
  return json;
}

async function seed() {
  await call("/api/masters/group", "POST", { name: "INLINE GROUP", active: true });
  for (const name of [FINISH, OTHER_FINISH]) {
    await call("/api/masters/finish", "POST", { name, active: true, group: "INLINE GROUP", color: "black" });
  }
  await call("/api/masters/style", "POST", {
    name: "INLINE STYLE", gpnColumn: "gatePass", dnColumn: "designNo", lotColumn: "lotNo",
    lines: "onePerEntry", order: "inward", combineSmallEntries: false,
  });
  for (const name of [FIRST, SECOND]) {
    await call("/api/masters/party", "POST", { name, active: true, discount: 0, billingStyle: "INLINE STYLE", color: "black" });
  }
  const ids = [];
  for (const inwardNo of [8701, 8702, 8703]) {
    const saved = await call("/api/entries", "POST", {
      registerMonth: "2026-11", inwardNo, entryDate: "2026-11-02", party: FIRST,
      designNo: `IL${inwardNo}`, lotNo: `L${inwardNo}`, than: 10, finish: FINISH,
      dispatches: [{ qty: 4, gatePass: `GP${inwardNo}`, date: "2026-11-03" }],
    });
    ids.push(saved.id);
  }
  return ids;
}

// The server saves before the screen redraws the row, so cell text is awaited instead of read once.
async function expectText(locator, text, message) {
  for (let attempt = 0; attempt < 50 && (await locator.textContent()) !== text; attempt++) await delay(100);
  assert.equal(await locator.textContent(), text, message);
}

const COL = { inward: 0, party: 2, designNo: 3, repair: 5, than: 6, tp: 7, nag: 8, finish: 9, nett: 10, qty2: 16, gate2: 17, date2: 18 };

(async () => {
  const ids = await seed();
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.clock.install({ time: new Date("2026-11-21T12:00:00") });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));

    await page.locator('[data-view="register"]').click();
    await page.locator("#registerSearch").fill("INLINE");
    const rows = page.locator("#registerTable tbody tr");
    await rows.nth(2).waitFor();
    assert.equal(await rows.count(), 3);
    const cell = (row, col) => rows.nth(row).locator("td").nth(col);
    const editor = (row, col) => cell(row, col).locator(".cell-input");
    const entry = (i) => call(`/api/entries/${ids[i]}`);
    const thanTotal = page.locator("#registerTotals .stat").nth(1).locator(".stat-value");
    await expectText(thanTotal, "30");

    // A click edits just that cell, without leaving the register for the form.
    await cell(0, COL.party).click();
    await editor(0, COL.party).waitFor();
    assert.equal(await page.locator("#view-register").evaluate((v) => v.classList.contains("active")), true);
    assert.equal(await editor(0, COL.party).inputValue(), FIRST);
    // Typed in another case, the name is saved as the master spells it; Enter moves down like a spreadsheet.
    await editor(0, COL.party).fill(SECOND.toLowerCase());
    await editor(0, COL.party).press("Enter");
    await editor(1, COL.party).waitFor();
    assert.equal((await entry(0)).party, SECOND);
    await expectText(cell(0, COL.party), SECOND);
    await editor(1, COL.party).press("Escape");
    assert.equal(await page.locator("#registerTable .cell-input").count(), 0);
    await expectText(cell(1, COL.party), FIRST);

    // THAN saves on Tab, worked-out cells and the totals follow, and the next editable cell opens.
    await cell(1, COL.than).click();
    await editor(1, COL.than).fill("15");
    await editor(1, COL.than).press("Tab");
    await editor(1, COL.tp).waitFor();
    assert.equal((await entry(1)).than, 15);
    await expectText(cell(1, COL.nag), "15");
    await expectText(cell(1, COL.nett), "15");
    await expectText(thanTotal, "35");
    await editor(1, COL.tp).press("Escape");

    // A wrong value keeps the cell open and marked; Esc puts the saved value back.
    await cell(2, COL.than).click();
    await editor(2, COL.than).fill("abc");
    await editor(2, COL.than).press("Enter");
    await page.locator(".toast.err", { hasText: "Numbers must be whole numbers." }).waitFor();
    assert.equal(await editor(2, COL.than).evaluate((input) => input.classList.contains("invalid")), true);
    await editor(2, COL.than).press("Escape");
    await expectText(cell(2, COL.than), "10");
    await cell(2, COL.finish).click();
    await editor(2, COL.finish).fill("NOT A FINISH");
    await editor(2, COL.finish).press("Enter");
    await page.locator(".toast.err", { hasText: "is not in the finish list" }).waitFor();
    assert.equal(await editor(2, COL.finish).count(), 1);
    const finish = editor(2, COL.finish);
    await finish.fill(OTHER_FINISH.toLowerCase().slice(0, -1));
    const suggestion = await dropdownOption(finish, OTHER_FINISH);
    assert.equal(await suggestion.isVisible(), true, "the finish list is rendered over the scrollable register");
    await suggestion.click();
    await page.waitForFunction(async (id) => (await (await fetch(`/api/entries/${id}`)).json()).finish === "INLINE S2G", ids[2]);
    assert.equal(await page.locator("select, datalist, input[list]").count(), 0);

    // Clicking away saves too.
    await cell(2, COL.designNo).click();
    await editor(2, COL.designNo).fill("NEW DN");
    await page.locator("#registerCount").click();
    await page.waitForFunction(async (id) => (await (await fetch(`/api/entries/${id}`)).json()).designNo === "NEW DN", ids[2]);
    await expectText(cell(2, COL.designNo), "NEW DN");

    // REP. is a Yes/No pick; a repair has no NETT THAN.
    await cell(0, COL.repair).click();
    await chooseDropdown(editor(0, COL.repair), "Yes");
    await page.waitForFunction(async (id) => (await (await fetch(`/api/entries/${id}`)).json()).repair === true, ids[0]);
    await page.waitForFunction(() => document.querySelector("#registerTable tbody tr td:nth-child(11)").textContent === "0");

    // Worked-out cells do not open an editor.
    await cell(0, COL.nag).click();
    assert.equal(await page.locator("#registerTable .cell-input").count(), 0);

    // A new dispatch in the first empty slot waits for its gate pass, then saves dated today.
    await cell(1, COL.qty2).click();
    await editor(1, COL.qty2).fill("3");
    await editor(1, COL.qty2).press("Enter");
    await editor(1, COL.gate2).waitFor();
    assert.equal((await entry(1)).dispatches.length, 1, "half a dispatch is not saved");
    await expectText(cell(1, COL.qty2), "3");
    await editor(1, COL.gate2).fill("GP-NEW");
    await editor(1, COL.gate2).press("Enter");
    await page.waitForFunction(async (id) => (await (await fetch(`/api/entries/${id}`)).json()).dispatches.length === 2, ids[1]);
    assert.deepEqual((await entry(1)).dispatches[1], { qty: 3, gatePass: "GP-NEW", date: "2026-11-21", dateText: null });
    await expectText(cell(1, COL.date2), "21/Nov/26");
    await page.keyboard.press("Escape");

    // Leaving half a dispatch drops it.
    await cell(0, COL.qty2).click();
    await editor(0, COL.qty2).fill("2");
    await editor(0, COL.qty2).press("Enter");
    await editor(0, COL.gate2).press("Escape");
    await expectText(cell(0, COL.qty2), "");
    assert.equal((await entry(0)).dispatches.length, 1);

    // Clearing JAWAK NAG removes that dispatch after asking.
    await cell(1, COL.qty2).click();
    await editor(1, COL.qty2).fill("");
    await editor(1, COL.qty2).press("Enter");
    await page.locator("#appDialogConfirm").click();
    await page.waitForFunction(async (id) => (await (await fetch(`/api/entries/${id}`)).json()).dispatches.length === 1, ids[1]);
    await expectText(cell(1, COL.gate2), "");

    // INW. NO. still opens the whole entry for correction.
    await cell(1, COL.inward).click();
    await page.waitForFunction(() => document.getElementById("view-entry").classList.contains("active"));
    assert.match(await page.locator("#formTitle").textContent(), /Correcting INW\. NO\. 8702/);
    assert.equal(await page.locator("#than").inputValue(), "15");
    await page.keyboard.press("Escape");

    // The recent table on the entry screen edits in place too.
    const recentRow = page.locator("#recentTable tbody tr", { hasText: "IL8701" });
    await recentRow.locator("td").nth(COL.than).click();
    await recentRow.locator(".cell-input").fill("12");
    await recentRow.locator(".cell-input").press("Enter");
    await page.waitForFunction(async (id) => (await (await fetch(`/api/entries/${id}`)).json()).than === 12, ids[0]);
    assert.match(await page.locator("#formTitle").textContent(), /New inward entry/);

    // Party-wise rows edit in place, and the party's totals catch up once editing stops.
    await page.locator('[data-view="partywise"]').click();
    await page.locator("#partyFilter").fill(SECOND);
    await page.locator("#partyFilter").press("Enter");
    await page.locator("#partyCount", { hasText: `1 entries for ${SECOND}` }).waitFor();
    await page.locator("#expandAllParties").click();
    const partyRow = page.locator("#partyTable tbody tr[data-entry-id]").first();
    await partyRow.locator("td").nth(COL.than).click();
    await partyRow.locator(".cell-input").fill("20");
    await partyRow.locator(".cell-input").press("Tab");
    await partyRow.locator("td").nth(COL.tp).locator(".cell-input").waitFor();
    await partyRow.locator(".cell-input").press("Escape");
    await page.locator("#partyTable tr.group .group-stat", { hasText: "THAN20" }).first().waitFor();
    assert.equal((await entry(0)).than, 20);

    assert.deepEqual(errors, []);
    console.log("PASS: Register cells edit and save in place; INW. NO. opens the whole entry.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
