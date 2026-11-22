// Read-only regression: real app screens with historical register responses supplied by the browser.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const { chooseDropdown, dropdownOption, dropdownValue, dropdownValues, waitForDropdownValues } = require("./dropdown-helpers");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";

const entry = (id, month, than, extra = {}) => ({
  id, registerMonth: month, inwardNo: id, entryDate: `${month}-15`,
  party: "TEST PARTY", designNo: `DESIGN-${id}`, lotNo: "", repair: false,
  than, tp: 0, nag: than, nettThan: than, twoPart: 0, finish: "S2G",
  dispatched: 0, balance: than, shortThan: null, billedIn: null,
  status: "pending", carriedOver: false, warnings: [], dispatches: [], ...extra,
});

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-11-21T12:00:00") });
    let language = "en";
    await page.route("**/api/info", async (route) => {
      const response = await route.fetch();
      const info = await response.json();
      await route.fulfill({ response, json: { ...info, language } });
    });
    let entries = [
      entry(1, "2025-03", 10),
      entry(2, "2025-04", 20),
      entry(3, "2026-03", 30),
      entry(4, "2026-04", 40, { dispatched: 40, balance: 0, status: "done" }),
      // A carryover is filed under its register month, not its original inward date.
      entry(5, "2026-11", 50, { entryDate: "2025-03-15", carriedOver: true, billedIn: "OLD-BILL" }),
      entry(6, "2027-03", 60),
      entry(7, "2027-04", 70),
    ];
    await page.route("**/api/months", (route) => {
      const months = [...new Set(entries.map((e) => e.registerMonth))].sort().reverse();
      return route.fulfill({ json: months.map((month) => ({ month, entries: entries.filter((e) => e.registerMonth === month).length })) });
    });
    await page.route(/\/api\/entries(\?.*)?$/, (route) => {
      const month = new URL(route.request().url()).searchParams.get("month");
      return route.fulfill({ json: entries.filter((e) => !month || e.registerMonth === month) });
    });
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
    await page.locator('[data-view="register"]').click();
    const year = page.locator("#registerFinancialYear");
    const month = page.locator("#registerViewMonth");
    const values = dropdownValues;
    const rows = () => page.locator("#registerTable tbody tr td:first-child").allTextContents();
    const expectRows = async (ids) => {
      await page.waitForFunction((expected) =>
        [...document.querySelectorAll("#registerTable tbody tr td:first-child")].map((td) => td.textContent).join(",") === expected.join(","),
      ids.map(String));
      assert.deepEqual(await rows(), ids.map(String));
    };
    const expectTotal = async (label, value) => {
      const stat = page.locator("#registerTotals .stat").filter({ has: page.locator(".stat-label", { hasText: new RegExp(`^${label}:`) }) });
      assert.equal(await stat.locator(".stat-value").textContent(), String(value));
    };
    await expectRows([4, 5, 6]);
    assert.equal(await dropdownValue(year), "2026");
    assert.equal(await year.textContent(), "2026-2027");
    assert.deepEqual(await values(year), ["", "2027", "2026", "2025", "2024"]);
    assert.deepEqual(await values(month), ["", "2027-03", "2026-11", "2026-04"]);
    assert.equal(await page.locator("#registerCount").textContent(), "3 of 3 entries");
    await expectTotal("THAN", 150);
    assert.equal(await page.locator("#registerFilters").isVisible(), false, "filters start collapsed");
    await page.locator("#registerFiltersToggle").click();
    assert.equal(await page.locator('#registerFilters [data-filter="carried"] .chip-count').textContent(), "1");
    const yearBox = await year.boundingBox();
    const monthBox = await month.boundingBox();
    assert.ok(yearBox.x + yearBox.width <= monthBox.x, "financial year sits before Month");

    await chooseDropdown(month, "2026-04");
    await expectRows([4]);
    await chooseDropdown(year, "2025");
    await expectRows([2, 3]);
    assert.equal(await dropdownValue(month), "", "incompatible month resets to All months");
    assert.deepEqual(await values(month), ["", "2026-03", "2025-04"]);
    await expectTotal("THAN", 50);
    await page.locator("#registerSearch").fill("DESIGN-3");
    await expectRows([3]);
    assert.equal(await page.locator("#registerCount").textContent(), "1 of 2 entries");
    await page.locator("#clearRegisterSearch").click();
    await expectRows([2, 3]);
    await chooseDropdown(year, "2024");
    await expectRows([1]);
    await chooseDropdown(year, "");
    await expectRows([1, 2, 3, 4, 5, 6, 7]);
    assert.equal((await values(month)).length, 8);
    await expectTotal("THAN", 280);
    await chooseDropdown(month, "2026-11");
    await expectRows([5]);
    await chooseDropdown(year, "2026");
    await expectRows([5]);
    assert.equal(await dropdownValue(month), "2026-11", "compatible month is preserved");
    await chooseDropdown(month, "");
    await expectRows([4, 5, 6]);
    const hasBalance = page.locator('#registerFilters [data-filter="balance"]');
    assert.equal(await hasBalance.locator(".chip-count").textContent(), "2", "fully dispatched entry 4 has no balance");
    await hasBalance.click();
    await expectRows([5, 6]);
    await hasBalance.click();
    await expectRows([4, 5, 6]);
    await page.locator('#registerFilters [data-filter="billNo"]').click();
    await expectRows([5]);
    await expectTotal("THAN", 50);
    await chooseDropdown(year, "2025");
    await expectRows([]);
    assert.ok(await page.locator("#view-register .table-empty").isVisible());
    await page.locator("#registerFilters .filter-clear").click();
    await expectRows([2, 3]);

    await page.locator('[data-view="partywise"]').click();
    await waitForDropdownValues(page.locator("#partyViewMonth"), (options) => options.length === 4);
    assert.equal(await dropdownValue(page.locator("#partyFinancialYear")), "2026", "Party-wise has its own current-year scope");
    await page.locator('[data-view="register"]').click();
    await expectRows([2, 3]);
    assert.equal(await dropdownValue(year), "2025", "selection survives tab changes");

    await page.waitForLoadState("networkidle");
    language = "hi";
    const translated = await page.evaluate(() => {
      window.applyLanguage("hi");
      return { year: window.t("Financial year"), all: window.t("All financial years") };
    });
    assert.notEqual(translated.all, "All financial years", "all-years option has a translation");
    assert.equal(await page.locator('label[for="registerFinancialYear"]').textContent(), translated.year);
    assert.equal(await (await dropdownOption(year, "")).textContent(), translated.all);
    await year.press("Escape");
    assert.equal(await dropdownValue(year), "2025", "translation does not change selection");
    language = "en";
    await page.evaluate(() => window.applyLanguage("en"));

    entries.push(entry(8, "2023-12", 80));
    await page.locator('[data-view="entry"]').click();
    await page.locator('[data-view="register"]').click();
    await waitForDropdownValues(year, (options) => options.includes("2023"));
    assert.equal(await dropdownValue(year), "2025", "new historical year does not change selection");

    for (const width of [390, 1366, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
        const box = await year.boundingBox();
        assert.ok(box && box.width > 100 && box.x >= 0 && box.x + box.width <= width, `usable year control at ${width}px in ${theme}`);
      }
    }
    for (const [date, expectedYear, expectedRows] of [
      ["2027-03-31T12:00:00", "2026", [4, 5, 6]],
      ["2027-04-01T12:00:00", "2027", [7]],
    ]) {
      await page.clock.setSystemTime(new Date(date));
      await page.reload();
      await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
      await page.locator('[data-view="register"]').click();
      await expectRows(expectedRows);
      assert.equal(await dropdownValue(year), expectedYear, `current financial year on ${date}`);
    }
    await page.clock.setSystemTime(new Date("2026-11-21T12:00:00"));
    await page.reload();
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
    entries = [];
    await page.locator('[data-view="register"]').click();
    await page.waitForFunction(() => document.querySelector("#registerCount").textContent === "0 of 0 entries");
    assert.deepEqual(await values(year), ["", "2026"]);
    assert.deepEqual(await values(month), [""]);
    assert.equal(await page.locator("#view-register .table-empty").textContent(), "No entries in this financial year.");
    await chooseDropdown(year, "");
    await page.waitForFunction(() => document.querySelector("#view-register .table-empty").textContent === "No entries yet.");
    assert.deepEqual(errors, [], "no screen JavaScript errors");
    console.log("Passed financial-year boundaries, carryovers, months, search, chips, totals, refresh, empty-data, and responsive theme checks.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
