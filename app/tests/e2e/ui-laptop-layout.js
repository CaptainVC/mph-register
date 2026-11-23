// Run against a fresh test data directory; this scenario creates its own parties, finishes and entries.
// A small laptop (1920×1080 at 150%: 1280×640 left for the app): one row of controls, the Columns switch (Main / JAWAK /
// All), the Register opening at its newest entries, JAWAK NAG offering what is left, several entries sent in full on
// one gate pass, New Entry with its saved entries in view, and sub-tabs that stay readable under the mouse.
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const ALPHA = "LAPTOP ALPHA";
const BETA = "LAPTOP BETA";
const FINISH = "LAPTOP SGZ";
const FIRST = 9601;
const COUNT = 30;
// The last three are not sent yet: 9628 is sent from its cell, 9629 and 9630 together on one gate pass.
const PENDING = [9628, 9629, 9630];
const LONG_LOT = "723,724,726,727,729";

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
  await call("/api/masters/group", "POST", { name: "LAPTOP GROUP", active: true });
  await call("/api/masters/finish", "POST", { name: FINISH, active: true, group: "LAPTOP GROUP", color: "black" });
  await call("/api/masters/style", "POST", {
    name: "LAPTOP STYLE", gpnColumn: "gatePass", dnColumn: "designNo", lotColumn: "lotNo",
    lines: "onePerEntry", order: "inward", combineSmallEntries: false,
  });
  for (const name of [ALPHA, BETA]) {
    await call("/api/masters/party", "POST", { name, active: true, discount: 0, billingStyle: "LAPTOP STYLE", color: "black" });
  }
  const ids = new Map();
  for (let inwardNo = FIRST; inwardNo < FIRST + COUNT; inwardNo++) {
    const pending = PENDING.includes(inwardNo);
    const saved = await call("/api/entries", "POST", {
      registerMonth: "2026-11", inwardNo, entryDate: "2026-11-05", party: inwardNo === 9630 ? BETA : ALPHA,
      designNo: `LD${inwardNo}`, lotNo: inwardNo === FIRST ? LONG_LOT : `L${inwardNo}`, than: 10, finish: FINISH,
      dispatches: pending ? [] : [{ qty: 10, gatePass: `LG${inwardNo}`, date: "2026-11-06" }],
    });
    ids.set(inwardNo, saved.id);
  }
  return ids;
}

async function until(check, message) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await check()) return;
    await delay(100);
  }
  assert.fail(message);
}

const wrapOf = (page) => page.locator("#registerTable").locator("..");
const box = (locator) => locator.evaluate((node) => {
  const { top, bottom, left, right, height } = node.getBoundingClientRect();
  return { top, bottom, left, right, height, display: getComputedStyle(node).display };
});
const scroll = (page) => wrapOf(page).evaluate((node) => ({
  top: node.scrollTop, max: node.scrollHeight - node.clientHeight, width: node.scrollWidth, shown: node.clientWidth,
}));
const rowOf = (page, inwardNo) => page.locator("#registerTable tbody tr").filter({ has: page.locator("td:first-child", { hasText: new RegExp(`^${inwardNo}$`) }) });
const headerIndex = (page, title) => page.locator("#registerTable thead th").evaluateAll((ths, t) => ths.findIndex((th) => th.textContent === t), title);

async function entry(id) {
  return call(`/api/entries/${id}`);
}

(async () => {
  const ids = await seed();
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 640 } });
    const page = await context.newPage();
    await page.clock.install({ time: new Date("2026-11-21T12:00:00") });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
    const hide = page.locator("#noticeBar:visible button");
    if (await hide.count()) await hide.first().click();

    // Shell: a thinner top bar.
    assert.ok((await box(page.locator("header.top"))).height <= 46, "the top bar is thinner on a laptop");

    // New Entry: the form and its saved entries on one screen; JAWAK NAG offers what is left.
    await page.locator('[data-view="entry"]').click();
    const recentTop = (await box(page.locator("#view-entry .recent-card"))).top;
    assert.ok(recentTop < 640 - 150, `Recently saved starts on the screen (top ${recentTop})`);
    await page.locator("#recentTable tbody tr").first().waitFor();
    const recent = await page.locator("#recentTable").locator("..").evaluate((node) => ({ width: node.scrollWidth, shown: node.clientWidth }));
    assert.ok(recent.width <= recent.shown + 1, `Recently saved needs no sideways scroll (${recent.width} > ${recent.shown})`);
    const lotWidths = await page.locator("#recentTable thead th").evaluateAll((ths) => {
      const lot = ths.findIndex((th) => th.textContent === "LOT N.");
      return { lot: ths[lot].getBoundingClientRect().width, dn: ths[lot - 1].getBoundingClientRect().width };
    });
    assert.ok(Math.abs(lotWidths.lot - lotWidths.dn) < 1.5 && lotWidths.lot > 90, `D.N. and LOT N. keep a fixed width in Recently saved (${JSON.stringify(lotWidths)})`);
    const longLot = page.locator("#recentTable tbody tr").filter({ hasText: LONG_LOT.split(",")[0] }).first().locator("td:nth-child(5)");
    if (await longLot.count()) {
      const lines = await longLot.evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
      assert.ok(lines <= 3, `a long LOT N. wraps on a few lines, not one number per line (${lines})`);
    }
    await page.locator("#than").fill("12");
    const qty = page.locator("#dispatchRows .d-qty").first();
    await until(async () => (await qty.getAttribute("placeholder")) === "12", "JAWAK NAG shows what is left (12)");
    await qty.focus();
    await page.keyboard.press("Enter");
    assert.equal(await qty.inputValue(), "12", "Enter on an empty JAWAK NAG takes what is left");
    assert.ok(await page.locator("#dispatchRows .d-gate").first().evaluate((node) => node === document.activeElement), "then GATE PASS NO is next");
    await qty.fill("");
    await page.locator("#than").fill("");

    // Register: opens at the newest entries; Main fits the screen with more rows than before.
    await page.locator('[data-view="register"]').click();
    await page.locator("#registerTable tbody tr[data-entry-id]").nth(COUNT - 1).waitFor({ state: "attached" });
    await until(async () => { const s = await scroll(page); return s.max > 0 && s.top >= s.max - 2; }, "the Register opens scrolled to its newest entries");
    assert.ok((await box(page.locator("#view-register .panel-top"))).height <= 52, "the Register controls take one row");
    assert.ok(await page.locator("#registerTable").evaluate((t) => t.classList.contains("cols-main")), "a laptop starts on the Main columns");
    let s = await scroll(page);
    assert.ok(s.width <= s.shown + 1, `Main needs no sideways scroll (${s.width} > ${s.shown})`);
    // Rows in view are counted on this test's own entries, whose names are as short as real ones.
    await page.locator("#registerSearch").fill("LAPTOP");
    await page.keyboard.press("Escape");
    await rowOf(page, FIRST).waitFor();
    const shownRows = await wrapOf(page).evaluate((wrap) => {
      const area = wrap.getBoundingClientRect();
      return [...wrap.querySelectorAll("tbody tr")].filter((tr) => { const r = tr.getBoundingClientRect(); return r.height && r.top >= area.top && r.bottom <= area.bottom + 1; }).length;
    });
    assert.ok(shownRows >= 12, `at least 12 rows in view (${shownRows})`);
    await page.locator("#registerTop").click();
    assert.equal((await scroll(page)).top, 0, "↑ Top goes to the first entry");
    await page.locator("#registerNewest").click();
    s = await scroll(page);
    assert.ok(s.top >= s.max - 2, "↓ Newest goes back to the newest entries");
    for (const [title, display] of [["BALANCE", "table-cell"], ["WARNINGS", "table-cell"], ["TWO PART", "none"], ["JAWAK NAG 1", "none"]]) {
      const index = await headerIndex(page, title);
      assert.equal((await box(page.locator("#registerTable thead th").nth(index))).display, display, `Main: ${title} is ${display === "none" ? "hidden" : "shown"}`);
    }

    // Main: Tab from FINISH skips the hidden columns instead of editing a cell that cannot be seen.
    await page.locator("#registerSearch").fill(ALPHA);
    await page.keyboard.press("Escape");
    await rowOf(page, FIRST + 1).waitFor();
    await rowOf(page, FIRST + 1).locator("td").nth(await headerIndex(page, "FINISH")).click();
    await page.locator("#registerTable td.cell-editing").waitFor();
    await page.keyboard.press("Tab");
    await delay(300);
    const editing = page.locator("#registerTable td.cell-editing");
    if (await editing.count()) assert.notEqual((await box(editing)).display, "none", "Tab never opens a hidden cell");
    await page.keyboard.press("Escape");
    await page.locator("#registerSearch").fill("LAPTOP");
    await page.keyboard.press("Escape");

    // JAWAK: every dispatch column with NAG and BALANCE, no sideways scroll; the choice is remembered.
    await page.locator('#view-register .colset button[data-set="jawak"]').click();
    s = await scroll(page);
    assert.ok(s.width <= s.shown + 1, `JAWAK needs no sideways scroll (${s.width} > ${s.shown})`);
    assert.equal(await page.evaluate(() => localStorage.getItem("mph-columns-registerTable")), "jawak");
    assert.equal((await box(page.locator("#registerTable thead th").nth(await headerIndex(page, "D.N.")))).display, "none", "JAWAK leaves D.N. out");
    assert.equal(await page.locator('#view-register .colset button[aria-pressed="true"]').textContent(), "JAWAK");

    // An empty JAWAK NAG cell offers what is left; Enter takes it and goes on to GATE PASS NO.
    const qtyIndex = await headerIndex(page, "JAWAK NAG 1");
    await rowOf(page, 9628).locator("td").nth(qtyIndex).click();
    const cellInput = page.locator("#registerTable td.cell-editing input");
    await cellInput.waitFor();
    assert.equal(await cellInput.getAttribute("placeholder"), "10", "the empty JAWAK NAG cell offers the balance");
    await page.keyboard.press("Enter");
    await until(async () => (await page.locator("#registerTable td.cell-editing").count()) === 1
      && (await page.locator("#registerTable td.cell-editing").evaluate((td) => td.cellIndex)) === qtyIndex + 1, "GATE PASS NO 1 opens next");
    await page.keyboard.type("LGONE");
    await page.keyboard.press("Enter");
    await until(async () => (await entry(ids.get(9628))).dispatches.length === 1, "the dispatch is saved");
    const sentOne = await entry(ids.get(9628));
    assert.deepEqual(sentOne.dispatches.map((d) => [d.qty, d.gatePass]), [[10, "LGONE"]]);
    await page.keyboard.press("Escape");

    // Several entries sent in full on one gate pass.
    assert.ok(await page.locator("#sendFullBar").evaluate((bar) => bar.classList.contains("hidden")), "no bar until something is ticked");
    assert.equal(await rowOf(page, FIRST + 1).locator(".send-pick").count(), 0, "an entry sent in full has no tick box");
    // A tick while a dispatch cell of the same row is being edited still counts (the edit ends and the row redraws first).
    await rowOf(page, 9629).locator("td").nth(qtyIndex).click();
    await page.locator("#registerTable td.cell-editing input").waitFor();
    await rowOf(page, 9629).locator(".send-pick").click();
    await until(async () => rowOf(page, 9629).locator(".send-pick").isChecked(), "the tick registers while a cell is open");
    await rowOf(page, 9630).locator(".send-pick").check();
    await page.locator("#sendFullBar:not(.hidden)").waitFor();
    assert.match(await page.locator("#sendFullSummary").textContent(), /^2 entries ticked · LAPTOP ALPHA, LAPTOP BETA · 20 NAG still to send$/);
    assert.equal(await page.locator("#sendFullSave").textContent(), "Mark all 2 sent in full");
    assert.equal(await page.locator("#sendFullDate").inputValue(), "2026-11-21", "the date starts as today");
    await page.locator("#sendFullSave").click();
    await page.locator(".toast.err", { hasText: "Type the gate pass number first." }).waitFor();
    assert.equal((await entry(ids.get(9629))).dispatches.length, 0, "nothing is saved without a gate pass");
    await page.locator("#sendFullGatePass").fill("LGTWO");
    await page.locator("#sendFullSave").click();
    await page.locator(".toast", { hasText: "Saved ✓ 2 entries sent in full: INW. NO. 9629, 9630 · gate pass LGTWO · 21/Nov/26" }).waitFor();
    for (const inwardNo of [9629, 9630]) {
      const saved = await entry(ids.get(inwardNo));
      assert.deepEqual(saved.dispatches.map((d) => [d.qty, d.gatePass, d.date]), [[10, "LGTWO", "2026-11-21"]], `INW. NO. ${inwardNo} sent in full`);
      assert.equal(saved.balance, 0);
      await until(async () => (await rowOf(page, inwardNo).locator(".send-pick").count()) === 0, `INW. NO. ${inwardNo} loses its tick box`);
    }
    assert.ok(await page.locator("#sendFullBar").evaluate((bar) => bar.classList.contains("hidden")), "the bar goes away once all are sent");

    // All (like Excel): the wide register, with BALANCE kept at the right edge.
    await page.locator('#view-register .colset button[data-set="all"]').click();
    s = await scroll(page);
    assert.ok(s.width > s.shown, "All scrolls sideways");
    await wrapOf(page).evaluate((node) => { node.scrollLeft = 300; });
    const balanceTh = page.locator("#registerTable thead th").nth(await headerIndex(page, "BALANCE"));
    const edge = await wrapOf(page).evaluate((node) => node.getBoundingClientRect().left + node.clientLeft + node.clientWidth);
    assert.ok(Math.abs((await box(balanceTh)).right - edge) < 1.5, "BALANCE is pinned at the right edge");
    assert.equal(await page.locator(".send-pick:visible").count(), 0, "tick boxes are only in JAWAK");
    await page.locator('#view-register .colset button[data-set="main"]').click();

    // Party-wise: Main leaves PARTY out (the party is on its bar) and fits the screen.
    await page.locator('[data-view="partywise"]').click();
    await page.locator("#partyTable tr.group").first().waitFor();
    assert.equal((await box(page.locator("#partyTable thead th").nth(2))).display, "none", "Party-wise Main hides PARTY");
    await page.locator("#partyTable tr.group button").first().click();
    const party = await page.locator("#partyTable").locator("..").evaluate((node) => ({ width: node.scrollWidth, shown: node.clientWidth }));
    assert.ok(party.width <= party.shown + 1, `Party-wise Main needs no sideways scroll (${party.width} > ${party.shown})`);

    // Bills: sub-tabs stay readable under the mouse; dates on one line; Saved bills controls on one row.
    await page.locator('[data-view="bills"]').click();
    const makeTab = page.locator('.subtab[data-sub="make"]');
    await makeTab.hover();
    const tabColours = await makeTab.evaluate((node) => { const c = getComputedStyle(node); return { color: c.color, background: c.backgroundColor }; });
    assert.equal(tabColours.background, "rgba(0, 0, 0, 0)", `a hovered sub-tab is not painted over (${JSON.stringify(tabColours)})`);
    assert.ok((await box(page.locator(".bill-date-fields"))).height <= 40, "the bill dates take one line");
    await page.locator('.subtab[data-sub="saved"]').click();
    const savedTab = page.locator('.subtab[data-sub="saved"]');
    await savedTab.hover();
    assert.equal(await savedTab.evaluate((node) => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)", "the active sub-tab keeps its text readable");
    assert.ok((await box(page.locator("#bills-saved > .toolbar"))).height <= 44, "Saved bills controls take one row");
    assert.equal((await box(page.locator("#cancelSelected"))).display, "none", "Cancel selected waits until a bill is ticked");
    await context.close();

    // A tall window keeps today's layout: every column until a choice is made, the full-size top bar.
    const tall = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const desk = await tall.newPage();
    desk.on("pageerror", (error) => errors.push(error.message));
    await desk.goto(BASE);
    await desk.waitForFunction(() => document.documentElement.classList.contains("ready"));
    assert.ok((await box(desk.locator("header.top"))).height >= 59, "a tall window keeps the full top bar");
    await desk.locator('[data-view="register"]').click();
    await desk.locator("#registerTable tbody tr[data-entry-id]").first().waitFor({ state: "attached" });
    assert.ok(await desk.locator("#registerTable").evaluate((t) => t.classList.contains("cols-all")), "a tall window starts on All");
    assert.ok((await box(desk.locator("#view-register .panel-top"))).height < 100, "the Register controls still fit on one row");
    await tall.close();

    assert.deepEqual(errors, []);
    console.log("PASS: laptop layout, Columns switch, newest first, JAWAK offers, sending in full and readable sub-tabs.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
