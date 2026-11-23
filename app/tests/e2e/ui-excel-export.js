// Routed fixtures exercise the Export to Excel window without a real workbook or real data.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const invoice = (id, extra = {}) => ({
  id, invoiceNo: `26-27\\JOB\\${300 + id}`, billDate: "2026-11-30", billMonth: "2026-11", party: "EXCEL TEST", partyName: "EXCEL TEST",
  than: 10, total: 1050, status: "saved", source: "app", finishes: "F1", entries: 1, exportedAt: null, exportedTo: null, changedSinceExport: false, ...extra,
});
const row = (b, status, extra = {}) => ({
  invoiceId: b.id, invoiceNo: b.invoiceNo, partyName: b.partyName, billDate: b.billDate, total: b.total, status,
  place: `column 1, bill ${b.id} (A1:G49)`, typed: [], differences: [], problems: [], ...extra,
});

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const invoices = [
      invoice(1),
      invoice(2, { exportedAt: "2026-11-22 10:15:00", exportedTo: "MPH BILL--NOV.-26-27.xlsm", changedSinceExport: true }),
      invoice(3, { source: "excel" }),
      invoice(4, { status: "cancelled" }),
    ];
    const previews = [];
    const exports = [];
    const requestOf = (route) => JSON.parse(/name="request"\r\n\r\n(.*)\r\n/.exec(route.request().postData())[1]);
    await page.route("**/api/months", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/invoices", (route) => route.fulfill({ json: invoices }));
    await page.route("**/api/billing/parties?*", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/billing/excel/preview", (route) => {
      const request = requestOf(route);
      previews.push(request);
      const replaced = request.replace.includes(2);
      const bills = invoices.filter((b) => request.ids.includes(b.id)).map((b) => b.id === 1
        ? row(b, "write", { typed: ["Rate for F1 on line 1: 77 typed in (the Details sheet has 75)."] })
        : row(b, replaced ? "replace" : "different", { differences: ["Total: workbook ₹1,000, app ₹1,050"] }));
      return route.fulfill({ json: {
        fileName: "MPH BILL--NOV.-26-27.xlsm", firstNumber: "26-27\\JOB\\301", lastNumber: "26-27\\JOB\\400", filledPlaces: 1, places: 100,
        bills, notes: ["The workbook had no bills, so its first bill no. (F7) is now 26-27\\JOB\\301."], problems: [],
        toWrite: bills.filter((b) => b.status === "write" || b.status === "replace").length,
      } });
    });
    await page.route("**/api/billing/excel/export", (route) => {
      exports.push(requestOf(route));
      return route.fulfill({
        status: 200, body: Buffer.from("filled workbook"),
        headers: { "Content-Type": "application/vnd.ms-excel.sheet.macroEnabled.12", "Content-Disposition": "attachment; filename=\"x.xlsm\"; filename*=UTF-8''MPH%20BILL--NOV.-26-27.xlsm" },
      });
    });

    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
    await page.locator('[data-view="bills"]').click();
    await page.locator('#view-bills [data-sub="saved"]').click();
    await page.waitForFunction(() => document.querySelectorAll("#invoiceTable tbody tr").length === 4);
    const excelColumn = await page.locator("#invoiceTable tbody tr td:last-child").allTextContents();
    assert.deepEqual(excelColumn, ["", "Changed since written", "From Excel", ""]);

    await page.locator("#excelShown").click();
    await page.waitForSelector("#excelDrawer[open]");
    assert.equal(await page.locator("#excelBills tbody tr").count(), 3, "cancelled bills are not offered");
    assert.deepEqual(await page.locator("#excelBills tbody input[type=checkbox]").evaluateAll((ticks) => ticks.map((t) => t.checked)), [true, true, false]);
    assert.equal(await page.locator("#excelDownload").isDisabled(), true);

    await page.locator("#excelFile").setInputFiles({ name: "MPH BILL--NOV.-26-27.xlsm", mimeType: "application/octet-stream", buffer: Buffer.from("workbook") });
    await page.waitForSelector("#excelResult tbody tr");
    assert.deepEqual(previews.at(-1), { ids: [1, 2], replace: [] });
    assert.deepEqual(await page.locator("#excelResult tbody tr td:nth-child(5)").allTextContents(), ["Will be written", "In the workbook, but differentReplace"]);
    assert.ok((await page.locator("#excelResult tbody tr").first().textContent()).includes("Rate for F1 on line 1: 77 typed in"));
    assert.ok((await page.locator("#excelNotes").textContent()).includes("first bill no. (F7) is now 26-27\\JOB\\301"));
    assert.equal(await page.locator("#excelDownload").isEnabled(), true);

    await page.locator('#excelResult input[data-replace="2"]').check();
    await page.waitForFunction(() => document.querySelector("#excelResult tbody tr:nth-child(2) td:nth-child(5)")?.textContent.startsWith("Will be written over"));
    assert.deepEqual(previews.at(-1), { ids: [1, 2], replace: [2] });
    assert.ok((await page.locator("#excelForm .form-message").textContent()).startsWith("2 bill(s) will be written."));

    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#excelDownload").click()]);
    assert.equal(download.suggestedFilename(), "MPH BILL--NOV.-26-27.xlsm");
    assert.deepEqual(exports, [{ ids: [1, 2], replace: [2] }]);
    await page.waitForFunction(() => document.querySelector("#excelForm .form-message").textContent.startsWith("Downloaded MPH BILL--NOV.-26-27.xlsm with 2 bill(s) written."));

    await page.locator("#excelBills tbody input[type=checkbox]").first().uncheck();
    await page.waitForFunction(() => document.querySelectorAll("#excelResult tbody tr").length === 1);
    assert.deepEqual(previews.at(-1), { ids: [2], replace: [2] });
    await page.locator("#excelDrawer .drawer-foot button").filter({ hasText: /^Close$/ }).click();
    await page.waitForFunction(() => !document.querySelector("#excelDrawer").open);
    assert.deepEqual(errors, []);
    console.log("PASS: Saved bills EXCEL column, Export to Excel ticks, check, replace and download of the filled workbook.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
