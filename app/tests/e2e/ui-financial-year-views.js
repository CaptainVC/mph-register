// Historical fixtures are served by browser routes; no production data is changed.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const { chooseDropdown, dropdownValue, dropdownValues, waitForDropdownValues } = require("./dropdown-helpers");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const entry = (id, month, extra = {}) => ({
  id, registerMonth: month, inwardNo: id, entryDate: `${month}-15`,
  party: "TEST PARTY", designNo: `DESIGN-${id}`, lotNo: "", repair: false,
  than: id * 10, tp: 0, nag: id * 10, nettThan: id * 10, twoPart: 0, finish: "S2G",
  dispatched: 0, balance: id * 10, shortThan: null, billedIn: null,
  status: "pending", carriedOver: false, warnings: [], dispatches: [], ...extra,
});
const invoice = (id, month, extra = {}) => ({
  id, billMonth: month, billDate: `${month}-15`, invoiceNo: `BILL-${id}`,
  party: "TEST PARTY", partyName: "TEST PARTY", finishes: "S2G", than: id * 10,
  total: id * 100, entries: 1, status: "saved", source: "app", ...extra,
});

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-11-21T12:00:00") });
    const entries = [
      entry(1, "2025-03"), entry(2, "2025-04"), entry(3, "2026-03"),
      entry(4, "2026-04"), entry(5, "2026-11", { entryDate: "2025-03-15", carriedOver: true, billedIn: "OLD-BILL" }),
      entry(6, "2027-03"), entry(7, "2027-04"),
    ];
    let invoices = [
      invoice(1, "2025-03"), invoice(2, "2025-04"), invoice(3, "2026-03"),
      invoice(4, "2026-04"), invoice(5, "2026-11", { status: "cancelled" }),
      invoice(6, "2027-03"), invoice(7, "2027-04"), invoice(8, "2023-12", { source: "excel" }),
    ];
    await page.route("**/api/months", (route) => {
      const months = [...new Set(entries.map((e) => e.registerMonth))].sort().reverse();
      return route.fulfill({ json: months.map((month) => ({ month, entries: entries.filter((e) => e.registerMonth === month).length })) });
    });
    await page.route(/\/api\/entries(\?.*)?$/, (route) => {
      const month = new URL(route.request().url()).searchParams.get("month");
      return route.fulfill({ json: entries.filter((e) => !month || e.registerMonth === month) });
    });
    await page.route("**/api/partywise?*", (route) => {
      const query = new URL(route.request().url()).searchParams;
      return route.fulfill({ json: entries.filter((e) =>
        (!query.get("month") || e.registerMonth === query.get("month")) && (!query.get("party") || e.party === query.get("party"))) });
    });
    await page.route("**/api/invoices", (route) => route.fulfill({ json: invoices }));
    await page.route("**/api/billing/parties?*", (route) => route.fulfill({ json: [{ party: "TEST PARTY", entries: 1, nettThan: 10, notDispatched: 1 }] }));
    await page.route("**/api/billing/candidates?*", (route) => route.fulfill({ json: {
      billParty: "TEST PARTY", sourceParties: ["TEST PARTY"], active: true, billBeforeDispatch: true,
      discount: 0, gstin: "", problems: [], entries: [{
        ...entry(1, "2025-03"), entryId: 1, billFinish: "S2G", rate: 10, selected: true,
        dispatchState: "none", gatePasses: "",
      }],
    } }));
    const values = (id) => dropdownValues(page.locator(`#${id}`));
    const partyRows = async (ids) => {
      await page.waitForFunction((expected) =>
        [...document.querySelectorAll("#partyTable tbody tr:not(.group):not(.subgroup) td:first-child")].map((td) => td.textContent).join(",") === expected.join(","),
      ids.map(String));
    };
    const invoiceRows = async (ids) => {
      await page.waitForFunction((expected) =>
        [...document.querySelectorAll("#invoiceTable tbody tr")].map((tr) => tr.dataset.id).join(",") === expected.join(","),
      ids.map(String));
    };
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));

    await page.locator('[data-view="partywise"]').click();
    await partyRows([4, 5, 6]);
    assert.equal(await dropdownValue(page.locator("#partyFinancialYear")), "2026");
    assert.deepEqual(await values("partyViewMonth"), ["", "2027-03", "2026-11", "2026-04"]);
    assert.equal(await page.locator("#partyTotals .stat").filter({ has: page.locator(".stat-label", { hasText: /^THAN:/ }) }).locator(".stat-value").textContent(), "150");
    assert.equal(await page.locator("#partyFilters").isVisible(), false, "filters start collapsed");
    await page.locator("#partyFiltersToggle").click();
    assert.equal(await page.locator('#partyFilters [data-filter="carried"] .chip-count').textContent(), "1");
    assert.ok((await page.locator("#partyTable tr.group").textContent()).includes("3 entries"));
    await chooseDropdown(page.locator("#partyViewMonth"), "2026-04");
    await partyRows([4]);
    await chooseDropdown(page.locator("#partyFinancialYear"), "2025");
    await partyRows([2, 3]);
    assert.equal(await dropdownValue(page.locator("#partyViewMonth")), "");
    await page.locator('#partyFilters [data-filter="billNo"]').click();
    await partyRows([]);
    assert.ok(await page.locator("#view-partywise .table-empty").isVisible());
    await page.locator("#partyFilters .filter-clear").click();
    await partyRows([2, 3]);
    await chooseDropdown(page.locator("#partyFinancialYear"), "");
    await partyRows([1, 2, 3, 4, 5, 6, 7]);
    await chooseDropdown(page.locator("#partyFinancialYear"), "2024");
    await partyRows([1]);
    await page.locator('[data-view="register"]').click();
    await page.waitForFunction(() => document.querySelector("#registerFinancialYear").value === "2026");
    await page.locator('[data-view="partywise"]').click();
    await partyRows([1]);
    assert.equal(await dropdownValue(page.locator("#partyFinancialYear")), "2024", "per-screen selections survive tab changes");

    await page.locator('[data-view="bills"]').click();
    await waitForDropdownValues(page.locator("#billFinancialYear"), (options) => options.includes("2023"));
    assert.equal(await dropdownValue(page.locator("#billFinancialYear")), "2026");
    assert.ok((await values("billFinancialYear")).includes("2023"), "Make bills includes bill-only historical years");
    assert.ok(!(await values("billFinancialYear")).includes(""), "making bills requires a concrete year");
    await chooseDropdown(page.locator("#billFinancialYear"), "2025");
    assert.equal(await page.locator("#billMonth").inputValue(), "2025-11");
    assert.equal(await page.locator("#billDate").inputValue(), "2025-11-30");
    assert.equal(await page.locator("#periodFrom").inputValue(), "2025-10-26", "entries run from the 26th of the month before");
    assert.equal(await page.locator("#periodTo").inputValue(), "2025-11-25", "entries run to the 25th of the bill month");
    assert.equal(await page.locator("#billMonth").getAttribute("min"), "2025-04");
    assert.equal(await page.locator("#billMonth").getAttribute("max"), "2026-03");
    await page.locator("#billMonth").fill("2026-02");
    await page.locator("#billMonth").dispatchEvent("change");
    await chooseDropdown(page.locator("#billFinancialYear"), "2026");
    assert.equal(await page.locator("#billMonth").inputValue(), "2027-02", "Jan-March uses the end calendar year");
    assert.equal(await page.locator("#billDate").inputValue(), "2027-02-28");
    await page.locator("#toBillList button").first().click();
    await page.waitForFunction(() => document.querySelectorAll("#candidateTable .cand").length === 1);
    await page.locator("#periodFrom").fill("2025-03-01");
    await page.locator("#periodFrom").dispatchEvent("change");
    await page.waitForLoadState("networkidle");
    assert.equal(await page.locator("#periodFrom").inputValue(), "2025-03-01", "carryover entry periods can cross a financial year");
    assert.equal(await dropdownValue(page.locator("#billFinancialYear")), "2026");
    const candidateRequest = page.waitForRequest((request) => request.url().includes("/api/billing/candidates?") && request.url().includes("from=2026-01-26"));
    await chooseDropdown(page.locator("#billFinancialYear"), "2025");
    await candidateRequest;
    assert.equal(await page.locator("#billMonth").inputValue(), "2026-02");

    await page.locator('.subtabs[data-group="bills"] [data-sub="saved"]').click();
    await invoiceRows([4, 5, 6]);
    assert.equal(await dropdownValue(page.locator("#savedFinancialYear")), "2026");
    assert.deepEqual(await values("savedMonth"), ["", "2027-03", "2026-11", "2026-04"]);
    assert.equal(await page.locator("#savedCount").textContent(), "3 bills");
    assert.equal(await page.locator("#savedTotals").textContent(), "Bills: 2THAN: 100Total: \u20b91,000.00");
    await page.evaluate(() => { window.printedIds = ""; openPrint = (ids) => { window.printedIds = ids; }; });
    await page.locator("#printShown").click();
    assert.equal(await page.evaluate(() => window.printedIds), "4,6", "printing obeys FY and excludes cancelled bills");
    await chooseDropdown(page.locator("#savedMonth"), "2026-04");
    await invoiceRows([4]);
    await chooseDropdown(page.locator("#savedFinancialYear"), "2025");
    await invoiceRows([2, 3]);
    assert.equal(await dropdownValue(page.locator("#savedMonth")), "");
    await page.locator("#savedSearch").fill("BILL-3");
    await invoiceRows([3]);
    await page.locator("#printShown").click();
    assert.equal(await page.evaluate(() => window.printedIds), "3", "printing obeys search as well");
    await page.locator("#savedSearch").fill("");
    await chooseDropdown(page.locator("#savedFinancialYear"), "");
    await invoiceRows([1, 2, 3, 4, 5, 6, 7, 8]);
    await chooseDropdown(page.locator("#savedFinancialYear"), "2023");
    await invoiceRows([8]);
    invoices.push(invoice(9, "2022-04"));
    await page.locator('[data-view="entry"]').click();
    await page.locator('[data-view="bills"]').click();
    await waitForDropdownValues(page.locator("#savedFinancialYear"), (options) => options.includes("2022"));
    assert.equal(await dropdownValue(page.locator("#savedFinancialYear")), "2023");
    await chooseDropdown(page.locator("#savedFinancialYear"), "2022");
    await invoiceRows([9]);

    await page.locator('[data-view="import"]').click();
    await page.waitForLoadState("networkidle");
    assert.equal(await dropdownValue(page.locator("#importFinancialYear")), "");
    assert.equal(await page.locator("#importMonth").inputValue(), "", "workbook detection remains the default");
    await page.locator("#importFile").setInputFiles({ name: "INWARD REG.-MAR.-24-25.xlsm", mimeType: "application/octet-stream", buffer: Buffer.from("fixture") });
    assert.equal(await page.locator("#importMonth").inputValue(), "2025-03");
    assert.equal(await dropdownValue(page.locator("#importFinancialYear")), "2024", "workbook FY follows March boundary");
    await page.evaluate(() => { document.querySelector("#runImport").disabled = false; document.querySelector("#importResult").textContent = "Old preview"; });
    await chooseDropdown(page.locator("#importFinancialYear"), "2025");
    assert.equal(await page.locator("#importMonth").inputValue(), "2026-03");
    assert.ok(await page.locator("#runImport").isDisabled(), "changing FY invalidates an old preview");
    assert.equal(await page.locator("#importResult").textContent(), "");
    await chooseDropdown(page.locator("#importFinancialYear"), "");
    assert.equal(await page.locator("#importMonth").inputValue(), "");
    assert.equal(await page.locator("#importMonth").getAttribute("min"), null);
    await page.locator("#importMonth").fill("2021-04");
    await page.locator("#importMonth").dispatchEvent("input");
    assert.equal(await dropdownValue(page.locator("#importFinancialYear")), "2021", "manual historic month adds its FY");
    const importRequest = page.waitForRequest((request) => request.url().endsWith("/api/import"));
    await page.route("**/api/import", (route) => route.fulfill({ status: 400, json: { errors: ["Test preview only"] } }));
    await page.locator("#previewImport").click();
    const request = await importRequest;
    assert.ok(request.postDataBuffer().toString().includes("2021-04"), "preview uses the chosen historic month");

    for (const width of [390, 1366, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [view, sub, id] of [
        ["partywise", "", "partyFinancialYear"], ["bills", "saved", "savedFinancialYear"],
        ["bills", "make", "billFinancialYear"], ["import", "", "importFinancialYear"],
      ]) {
        await page.locator(`[data-view="${view}"]`).click();
        if (sub) await page.locator(`.subtabs[data-group="bills"] [data-sub="${sub}"]`).click();
        await page.waitForLoadState("networkidle");
        await page.locator(`#${id}`).scrollIntoViewIfNeeded();
        for (const theme of ["light", "dark"]) {
          await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
          const box = await page.locator(`#${id}`).boundingBox();
          assert.ok(box && box.width > 100 && box.x >= 0 && box.x + box.width <= width, `${id}: usable at ${width}px in ${theme}: ${JSON.stringify(box)}`);
        }
      }
    }
    await page.setViewportSize({ width: 1600, height: 1000 });
    invoices = [];
    await page.locator('[data-view="bills"]').click();
    await page.locator('.subtabs[data-group="bills"] [data-sub="saved"]').click();
    await invoiceRows([]);
    assert.ok(await page.locator("#bills-saved .table-empty").isVisible());
    assert.equal(await dropdownValue(page.locator("#savedFinancialYear")), "2022", "empty refresh retains selected year");
    assert.deepEqual(await values("savedMonth"), [""]);

    await page.locator('[data-view="dashboard"]').click();
    await page.locator("#dashYear").waitFor();
    assert.equal(await page.locator('label[for="dashYear"]').textContent(), "Financial year");
    assert.equal(await page.locator("#dashYear").count(), 1, "Dashboard retains its existing year selector");
    assert.equal(await page.locator("#dashYear").getAttribute("title"), "April to March");
    const months = await values("dashMonth");
    if (months.length > 1) {
      const target = months.at(-1);
      const response = page.waitForResponse((r) => r.url().includes("/api/dashboard?") && r.url().includes(`month=${target}`));
      await chooseDropdown(page.locator("#dashMonth"), target);
      await response;
      await page.waitForFunction((month) => document.querySelector("#dashMonth").value === month, target);
    }
    assert.deepEqual(errors, [], "no screen errors");
    console.log("Passed Party-wise, Make bills, Saved bills/printing, Import, and Dashboard financial-year boundary, refresh, carryover, empty-data, and responsive checks.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
