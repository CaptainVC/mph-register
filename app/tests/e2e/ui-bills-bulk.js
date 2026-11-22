// Routed fixtures exercise the Saved bills selection (cancel several, undo the newest ones) without changing production data.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const bill = (serial, extra = {}) => ({
  id: serial, invoiceNo: `26-27\\JOB\\${serial}`, fy: "26-27", serial, billMonth: "2026-10", billDate: "2026-10-28",
  periodFrom: "2026-10-01", periodTo: "2026-10-28", party: "BULK TEST", partyName: "BULK TEST",
  address: "TEST ADDRESS", state: "", gstin: "", notes: "", finishes: "F1", entries: 1,
  status: "saved", source: "app", gross: 1000, discountPct: 0, discount: 0, taxable: 1000,
  cgstRate: 2.5, sgstRate: 2.5, igstRate: 5, taxMode: "intra", cgst: 25, sgst: 25, igst: 0,
  total: 1050, than: 10, amountInWords: "One Thousand Fifty Only", warnings: [], firm: null,
  lines: [{ kind: "priced", gpn: "G1", dn: "D1", lot: "L1", finish: "F1", qty: 10, rate: 100, amount: 1000, entryIds: [serial], rows: 1 }],
  ...extra,
});

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.clock.install({ time: new Date("2026-11-21T12:00:00") });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let invoices = [bill(10), bill(11), bill(12), bill(13, { source: "excel" }), bill(14), bill(15)];
    const undone = [];
    const cancelled = [];
    let failOn = null;
    const withUndo = (i) => ({
      ...i,
      undoSave: i.status === "saved" && i.source === "app" && i.serial === Math.max(...invoices.map((b) => b.serial))
        ? { allowed: true, reason: null, token: `token-${i.id}` }
        : { allowed: false, reason: "A later bill exists in this financial year, even if it is cancelled or for another party.", token: null },
    });
    await page.route("**/api/months", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/invoices", (route) => route.fulfill({ json: invoices }));
    await page.route("**/api/billing/parties?*", (route) => route.fulfill({ json: [] }));
    await page.route(/\/api\/invoices\/\d+(?:\/undo-save|\/cancel)?$/, async (route) => {
      const request = route.request();
      const id = Number(new URL(request.url()).pathname.split("/")[3]);
      const target = invoices.find((i) => i.id === id);
      if (request.url().endsWith("/undo-save")) {
        if (id === failOn) return route.fulfill({ status: 400, json: { errors: ["The bill has changed. Reopen it before undoing the save."] } });
        assert.equal(request.postDataJSON().token, `token-${id}`);
        invoices = invoices.filter((i) => i.id !== id);
        undone.push(id);
        return route.fulfill({ json: { invoiceNo: target.invoiceNo, nextSerial: id } });
      }
      if (request.url().endsWith("/cancel")) {
        target.status = "cancelled";
        cancelled.push(id);
      }
      return route.fulfill({ json: withUndo(target) });
    });

    const tick = (id) => page.locator(`#invoiceTable tr[data-id="${id}"] input[type=checkbox]`).click();
    const undo = page.locator("#undoSelected");

    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
    await page.locator('[data-view="bills"]').click();
    await page.locator('#view-bills [data-sub="saved"]').click();
    await page.waitForSelector('#invoiceTable tr[data-id="15"]');
    assert.equal(await page.locator("#cancelSelected").isDisabled(), true);
    assert.equal(await undo.isDisabled(), true);

    // Ticking a row does not open the bill; the buttons follow the selection.
    await tick(12);
    assert.equal(await page.locator("#invoiceDrawer").getAttribute("open"), null);
    assert.equal(await page.locator("#savedSelection").textContent(), "1 selected");
    assert.equal(await page.locator("#cancelSelected").isEnabled(), true);
    assert.equal(await undo.isDisabled(), true, "the newest bill is not ticked");
    assert.ok((await undo.getAttribute("title")).includes("26-27\\JOB\\15"));
    await tick(15);
    assert.equal(await undo.isDisabled(), true, "bills between the ticked ones are not ticked");
    await tick(14);
    assert.equal(await undo.isDisabled(), true, "bill 13 sits between 12 and 14");
    await tick(13);
    assert.equal(await undo.isDisabled(), true, "an imported bill can never release its number");
    assert.ok((await undo.getAttribute("title")).includes("Imported"));
    await tick(13);
    await tick(12);
    assert.equal(await page.locator("#savedSelection").textContent(), "2 selected");
    assert.equal(await undo.isEnabled(), true, "14 and 15 are the newest two");

    // Undo the newest two: declined first, then newest-first, with a failure stopping the rest.
    await undo.click();
    const body = await page.locator("#appDialogBody").textContent();
    assert.ok(body.includes("26-27\\JOB\\15, 26-27\\JOB\\14"), body);
    assert.ok(body.includes("never issued"));
    await page.locator("#appDialogCancel").click();
    assert.deepEqual(undone, []);

    failOn = 14;
    await undo.click();
    await page.locator("#appDialogConfirm").click();
    await page.locator("#appDialogBody", { hasText: "26-27\\JOB\\14: The bill has changed" }).waitFor();
    await page.locator("#appDialogConfirm").click();
    assert.deepEqual(undone, [15]);
    await page.waitForFunction(() => document.querySelectorAll("#invoiceTable tbody tr").length === 5);
    assert.equal(await page.locator("#savedSelection").textContent(), "1 selected", "only the bill that failed stays ticked");

    failOn = null;
    await undo.click();
    await page.locator("#appDialogConfirm").click();
    await page.waitForFunction(() => document.querySelectorAll("#invoiceTable tbody tr").length === 4);
    assert.deepEqual(undone, [15, 14]);
    await page.locator(".toast", { hasText: "Next bill number: 14." }).waitFor();
    assert.equal(await page.locator("#savedSelection").textContent(), "");

    // Cancel several.
    await page.locator("#savedAll").click();
    assert.equal(await page.locator("#savedSelection").textContent(), "4 selected");
    await page.locator("#cancelSelected").click();
    assert.ok((await page.locator("#appDialogBody").textContent()).includes("The numbers stay used"));
    await page.locator("#appDialogCancel").click();
    assert.deepEqual(cancelled, []);
    await page.locator("#cancelSelected").click();
    await page.locator("#appDialogConfirm").click();
    await page.waitForFunction(() => [...document.querySelectorAll("#invoiceTable tbody tr")].every((tr) => tr.classList.contains("inactive")));
    assert.deepEqual(cancelled, [10, 11, 12, 13]);
    assert.equal(await page.locator("#savedSelection").textContent(), "");
    await tick(10);
    assert.equal(await page.locator("#cancelSelected").isDisabled(), true, "nothing left to cancel");
    assert.equal(await undo.isDisabled(), true, "a cancelled bill cannot release its number");
    assert.deepEqual(errors, []);
    console.log("PASS: saved bills selection, newest-only undo with ordering and partial failure, bulk cancel, and row click unchanged.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
