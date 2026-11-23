// An entry an import updated gets a Δ next to its INW. NO.; it opens what the import changed and the import that added the entry.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const FILE = "INWARD REG.-NOV.-26-27.xlsx";
const UPDATED_AT = "2026-11-22 21:40:05";
const entry = (id, inwardNo, extra = {}) => ({
  id, inwardNo, party: "HISTORY TEST", finish: "S2G", registerMonth: "2026-11", entryDate: `2026-11-0${inwardNo}`, designNo: `D${id}`,
  lotNo: "", status: "partial", repair: false, billedIn: null, than: 54, nettThan: 54, nag: 54, tp: 0, twoPart: 0, balance: 4,
  dispatched: 50, dispatches: [{ qty: 50, gatePass: "5162", date: "2026-11-21", dateText: null }], warnings: [], carriedOver: false, imported: true,
  lastImport: null, importUpdatedAt: null, ...extra,
});
// Entry 2 was updated by the latest import; entry 3 by an earlier one (no longer the latest of its month); entry 4 was only added.
const entries = [
  entry(1, 1),
  entry(2, 2, { importUpdatedAt: UPDATED_AT, lastImport: { action: "updated", fileName: FILE, importedAt: UPDATED_AT, registerMonth: "2026-11", changes: "THAN 52 → 54" } }),
  entry(3, 3, { importUpdatedAt: "2026-11-15 18:05:00" }),
  entry(4, 4, { lastImport: { action: "added", fileName: FILE, importedAt: UPDATED_AT, registerMonth: "2026-11", changes: "" } }),
];
const history = {
  2: {
    entryId: 2,
    events: [
      {
        action: "updated", fileName: FILE, importedAt: UPDATED_AT, registerMonth: "2026-11", sourceRow: 7, changes: "THAN 52 → 54",
        details: {
          fields: [{ field: "THAN", was: "52", now: "54" }, { field: "LOT N.", was: "", now: "L2" }, { field: "DATE", was: "2026-11-01", now: "2026-11-02" }],
          dispatches: [{ number: 1, was: { qty: 52, gatePass: "5162", date: "2026-11-21", dateText: null }, now: { qty: 50, gatePass: "5162", date: "2026-11-21", dateText: null } }],
          effects: [{ field: "NAG", was: "52", now: "54" }, { field: "BALANCE", was: "0", now: "4" }],
        },
      },
      { action: "added", fileName: FILE, importedAt: "2026-11-08 09:30:00", registerMonth: "2026-11", sourceRow: 12, changes: "", details: null },
    ],
  },
  3: {
    entryId: 3,
    events: [{ action: "updated", fileName: FILE, importedAt: "2026-11-15 18:05:00", registerMonth: "2026-11", sourceRow: 8, changes: "", details: null }],
  },
};
// Entry 2 holds a lot number typed in the app after the import, so the window says it was edited since.
entries[1].lotNo = "L2X";

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/\/api\/entries(?:\?|$)/, (route) => route.fulfill({ json: entries }));
    await page.route(/\/api\/entries\/\d+$/, (route) => route.fulfill({ json: entries.find((e) => route.request().url().endsWith(`/${e.id}`)) }));
    await page.route(/\/api\/entries\/\d+\/import-history$/, (route) => {
      const id = Number(route.request().url().match(/entries\/(\d+)\//)[1]);
      route.fulfill({ json: history[id] || { entryId: id, events: [] } });
    });
    await page.route("**/api/months", (route) => route.fulfill({ json: [{ month: "2026-11", entries: entries.length }] }));
    await page.goto(BASE);
    await page.waitForFunction(() => document.activeElement.id === "party");
    await page.locator('[data-view="register"]').click();
    await page.locator("#registerTable tbody tr").first().waitFor();

    const tags = page.locator("#registerTable tbody .import-tag");
    assert.equal(await tags.count(), 2, "only entries an import updated get a Δ");
    assert.deepEqual(await page.locator("#registerTable tbody tr:has(.import-tag) td:first-child").allTextContents(), ["2Δ", "3Δ"]);
    assert.equal(await tags.first().getAttribute("title"), "Updated by an import on 22/Nov/26 21:40. Click to see what changed");

    // The Δ opens the window and does not open the entry in the form.
    await tags.first().click();
    const drawer = page.locator("#importHistoryDrawer");
    await drawer.waitFor({ state: "visible" });
    assert.equal(await page.locator("#view-entry.active").count(), 0, "the click does not open the entry form");
    assert.match(await drawer.locator("h2").textContent(), /INW\. NO\. 2 · HISTORY TEST/);
    assert.match(await drawer.locator(".drawer-head .sub").textContent(), /1 of 2 changed/);
    assert.deepEqual(await drawer.locator(".ih-badge").allTextContents(), ["UPDATED", "ADDED"]);
    assert.deepEqual(await drawer.locator(".ih-when").allTextContents(), ["22/Nov/26 21:40", "08/Nov/26 09:30"]);
    assert.match(await drawer.locator(".ih-source").first().textContent(), new RegExp(`the import of ${FILE} \\(Nov 2026 register, row 7\\)`));

    const rows = await drawer.locator(".ih-event.updated .ih-table").first().locator("tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((td) => td.textContent.trim())));
    assert.deepEqual(rows, [
      ["THAN", "52", "54"],
      ["LOT N.", "blank", "L2edited since: L2X"],
      ["DATE", "01/Nov/26", "02/Nov/26"],
      ["Dispatch 1", "52 NAG · gate pass 5162 · 21/Nov/26", "50 NAG · gate pass 5162 · 21/Nov/26"],
    ]);
    const follows = await drawer.locator(".ih-event.updated .ih-table").nth(1).locator("tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((td) => td.textContent.trim())));
    assert.deepEqual(follows, [["NAG", "52", "54"], ["BALANCE", "0", "4"]]);
    assert.equal(await drawer.locator(".ih-event.added").textContent().then((text) => /row 12/.test(text)), true);
    assert.equal(await drawer.getByRole("button", { name: "‹ Previous changed" }).isDisabled(), true);

    // Next steps to the other updated entry, whose import did not record what it changed.
    await drawer.getByRole("button", { name: "Next changed ›" }).click();
    await page.waitForFunction(() => /INW\. NO\. 3/.test(document.querySelector("#importHistoryDrawer h2").textContent));
    assert.match(await drawer.locator(".drawer-head .sub").textContent(), /2 of 2 changed/);
    assert.equal(await drawer.locator(".ih-event .muted").first().evaluate((node) => node.parentElement.querySelectorAll(".ih-table").length), 0);
    assert.match(await drawer.locator(".ih-event.updated").textContent(), /What this import changed was not recorded\./);
    assert.equal(await drawer.getByRole("button", { name: "Next changed ›" }).isDisabled(), true);

    // Open entry leaves the window and opens the entry in the form.
    await drawer.getByRole("button", { name: "Open entry" }).click();
    await page.waitForFunction(() => document.querySelector("#view-entry.active"));
    await drawer.waitFor({ state: "hidden" });

    assert.deepEqual(errors, []);
    console.log("PASS ui-import-history: Δ opens what the import changed, the adding import, and steps through changed entries");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
