// The import report lists the entries an import adds and updates, and the Register's Last import filters find them later.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const { chooseDropdown } = require("./dropdown-helpers");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const FILE = "INWARD REG.-NOV.-26-27.xlsx";
const entry = (id, month, inwardNo, lastImport) => ({
  id, inwardNo, party: "MARK TEST", finish: "S2G", registerMonth: month, entryDate: `${month}-0${inwardNo}`, designNo: `D${id}`,
  lotNo: "", status: "pending", repair: false, billedIn: null, than: 10, nettThan: 10, nag: 10, tp: 0, twoPart: 0, balance: 10,
  dispatched: 0, dispatches: [], warnings: [], carriedOver: false, imported: true, lastImport,
});
const mark = (action, changes, registerMonth = "2026-11") => ({ action, fileName: FILE, importedAt: "2026-11-22 21:40:05", registerMonth, changes });
const entries = [
  entry(1, "2026-11", 1, null),
  entry(2, "2026-11", 2, mark("updated", "THAN 10 → 12")),
  entry(3, "2026-11", 3, mark("added", "")),
  entry(4, "2026-10", 9, mark("updated", "LOT N. filled in (L9)")),
];
const report = (imported) => ({
  imported, fileName: FILE, registerMonth: "2026-11", entries: 1, dispatches: 0, carriedOver: 1, than: 40, tp: 0, nag: 40, nettThan: 40,
  twoPart: 0, dispatched: 0, mergedCarryovers: 1, addedParties: [], addedFinishes: [], warnings: [], errors: [], savedEntries: 2,
  updatedEntries: 1, unchangedEntries: 1, removedEntries: 0, upToDate: false,
  changes: [
    { row: 5, message: "INW. NO. 2 of 2026-11-02 (MARK TEST): THAN 10 → 12." },
    { row: 9, message: "INW. NO. 9 of 2026-10-09 (MARK TEST), 2026-10 register: LOT N. filled in (L9)." },
  ],
  kept: [], notInWorkbook: [],
  added: [{ row: 6, message: "INW. NO. 3 of 2026-11-03 (MARK TEST): D.N. D3, THAN 10, FINISH S2G." }],
  otherMonthUpdates: 1,
});

async function shownRows(page) {
  return page.$$eval("#registerTable tbody tr td:first-child", (cells) => cells.map((td) => Number(td.textContent)));
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/\/api\/entries(?:\?|$)/, (route) => {
      const month = new URL(route.request().url()).searchParams.get("month");
      route.fulfill({ json: entries.filter((e) => !month || e.registerMonth === month) });
    });
    await page.route("**/api/months", (route) => route.fulfill({ json: [{ month: "2026-11", entries: 3 }, { month: "2026-10", entries: 1 }] }));
    const commits = [];
    await page.route("**/api/import", (route) => {
      const commit = route.request().postData().includes('name="commit"\r\n\r\ntrue');
      commits.push(commit);
      route.fulfill({ json: report(commit) });
    });
    await page.goto(BASE);
    await page.waitForFunction(() => document.activeElement.id === "party");

    await page.locator('[data-view="import"]').click();
    await page.locator("#importFile").setInputFiles({ name: FILE, mimeType: "application/octet-stream", buffer: Buffer.from("test workbook") });
    await page.locator("#previewImport").click();
    await page.locator("#importAddedTitle").waitFor();
    assert.equal(await page.locator("#importAddedTitle").textContent(), "New entries (1)");
    assert.deepEqual(await page.locator("#importAddedList li").allTextContents(), ["Excel row 6: INW. NO. 3 of 2026-11-03 (MARK TEST): D.N. D3, THAN 10, FINISH S2G."]);
    assert.equal(await page.locator("#importUpdatedTitle").textContent(), "Updated entries (2)");
    assert.deepEqual(await page.locator("#importUpdatedList li").allTextContents(), [
      "Excel row 5: INW. NO. 2 of 2026-11-02 (MARK TEST): THAN 10 → 12.",
      "Excel row 9: INW. NO. 9 of 2026-10-09 (MARK TEST), 2026-10 register: LOT N. filled in (L9).",
    ]);
    const otherMonths = page.locator("#importResult tr", { hasText: "Entries of other months changed" });
    assert.equal(await otherMonths.locator("td").textContent(), "1");
    assert.equal(await page.locator("#showImportAdded, #showImportUpdated").count(), 0, "a check offers nothing to show yet");

    assert.equal(await page.locator("#runImport").isDisabled(), false, "a passed check enables Import");
    await page.locator("#cancelImport").click();
    assert.equal(await page.locator("#importFile").evaluate((input) => input.files.length), 0, "Cancel clears the chosen workbook");
    assert.equal(await page.locator("#importResult").evaluate((el) => el.children.length), 0, "Cancel clears the check result");
    assert.equal(await page.locator("#runImport").isDisabled(), true, "Cancel disables Import");
    await page.locator("#importFile").setInputFiles({ name: FILE, mimeType: "application/octet-stream", buffer: Buffer.from("test workbook") });
    await page.locator("#previewImport").click();
    await page.locator("#importAddedTitle").waitFor();

    await page.locator("#runImport").click();
    await page.locator("#showImportUpdated").waitFor();
    assert.deepEqual(commits, [false, false, true]);
    assert.equal(await page.locator("#importResult h2").textContent(), "Updated ✓");

    await page.locator("#showImportUpdated").click();
    await page.waitForFunction(() => document.querySelector("#view-register.active") && document.querySelectorAll("#registerTable tbody tr").length === 1);
    assert.equal(await page.locator("#registerViewMonth").evaluate((control) => control.value), "2026-11");
    assert.equal(await page.locator("#registerFilters").isVisible(), true, "the filter bar opens so the Updated filter shows");
    assert.equal(await page.locator('#registerFilters [data-filter="importUpdated"]').getAttribute("aria-pressed"), "true");
    assert.deepEqual(await shownRows(page), [2]);
    assert.equal(await page.locator("#registerTable tbody tr").getAttribute("title"),
      `Updated by the import of ${FILE} (Nov 2026) on 22/Nov/26 21:40: THAN 10 → 12`);
    assert.equal(await page.locator("#registerFilters-importAdded-count").textContent(), "1");
    assert.equal(await page.locator("#registerFilters-importUpdated-count").textContent(), "1");

    // Back to the report: the new entries open the same way.
    await page.locator('[data-view="import"]').click();
    await page.locator("#showImportAdded").click();
    await page.waitForFunction(() => document.querySelector('#registerFilters [data-filter="importAdded"]').getAttribute("aria-pressed") === "true"
      && document.querySelector('#registerFilters [data-filter="importUpdated"]').getAttribute("aria-pressed") === "false");
    assert.deepEqual(await shownRows(page), [3]);
    assert.equal(await page.locator("#registerTable tbody tr").getAttribute("title"), `Added by the import of ${FILE} on 22/Nov/26 21:40`);

    // Another month's import updated an October entry: its own month's Register shows it too.
    await page.locator('#registerFilters [data-filter="importAdded"]').click();
    await page.locator('#registerFilters [data-filter="importUpdated"]').click();
    await chooseDropdown(page.locator("#registerViewMonth"), "2026-10");
    await page.waitForFunction(() => document.querySelectorAll("#registerTable tbody tr").length === 1
      && document.querySelector("#registerTable tbody tr td").textContent === "9");
    assert.match(await page.locator("#registerTable tbody tr").getAttribute("title"), /^Updated by the import of .+ \(Nov 2026\) on .+: LOT N\. filled in \(L9\)$/);

    assert.deepEqual(errors, []);
    console.log("PASS ui-import-marks: report lists new and updated entries; Register Last import filters find them");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
