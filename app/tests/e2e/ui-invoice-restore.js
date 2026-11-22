// Routed fixtures exercise the real bill drawer without changing production data.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const blockedReason = "This bill cannot be restored because its entries are in use. RESTORE TEST inward 1 (2026-10) is already on bill 26-27\\JOB\\280.";
const bill = {
  id: 1, invoiceNo: "26-27\\JOB\\279", billMonth: "2026-10", billDate: "2026-10-28",
  periodFrom: "2026-10-01", periodTo: "2026-10-28", party: "RESTORE TEST", partyName: "RESTORE TEST",
  address: "TEST ADDRESS", state: "", gstin: "", notes: "", finishes: "F1", entries: 0,
  status: "cancelled", source: "app", gross: 1000, discountPct: 0, discount: 0, taxable: 1000,
  cgstRate: 2.5, sgstRate: 2.5, igstRate: 5, taxMode: "intra", cgst: 25, sgst: 25, igst: 0,
  total: 1050, than: 10, amountInWords: "One Thousand Fifty Only", warnings: [], firm: null,
  lines: [{ kind: "priced", gpn: "G1", dn: "D1", lot: "L1", finish: "F1", qty: 10, rate: 100, amount: 1000, entryIds: [1], rows: 1 }],
  restore: { allowed: false, reason: blockedReason },
};

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.clock.install({ time: new Date("2026-11-21T12:00:00") });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let restores = 0;
    await page.route("**/api/months", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/invoices", (route) => route.fulfill({ json: [bill] }));
    await page.route("**/api/billing/parties?*", (route) => route.fulfill({ json: [] }));
    await page.route(/\/api\/invoices\/\d+(?:\/restore)?$/, async (route) => {
      if (route.request().url().endsWith("/restore")) {
        restores += 1;
        Object.assign(bill, { status: "saved", entries: 1, restore: null, undoSave: { allowed: false, reason: "A later bill exists in this financial year, even if it is cancelled or for another party.", token: null } });
      }
      return route.fulfill({ json: bill });
    });

    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
    await page.locator('[data-view="bills"]').click();
    await page.locator('#view-bills [data-sub="saved"]').click();
    await page.locator('#invoiceTable tr[data-id="1"]').click();

    await page.waitForSelector("#invoiceDrawer[open] #ie-restore:disabled");
    assert.equal(await page.locator("#ie-restore-help").textContent(), blockedReason);
    assert.equal(restores, 0);
    await page.locator("#invoiceDrawer .drawer-foot button").filter({ hasText: /^Close$/ }).click();

    bill.restore = { allowed: true, reason: null };
    await page.locator('#invoiceTable tr[data-id="1"]').click();
    await page.waitForSelector("#invoiceDrawer[open] #ie-restore:enabled");
    await page.locator("#ie-restore").click();
    assert.ok((await page.locator("#appDialogBody").textContent()).includes("Restore bill 26-27\\JOB\\279?"));
    await page.locator("#appDialogCancel").click();
    assert.equal(restores, 0);

    await page.locator("#ie-restore").click();
    await page.locator("#appDialogConfirm").click();
    await page.waitForFunction(() => !document.querySelector("#ie-restore"));
    assert.equal(restores, 1);
    assert.equal(await page.locator("#ie-cancel").count(), 1);
    assert.equal(await page.locator("#ie-save").isEnabled(), true);
    assert.deepEqual(errors, []);
    console.log("PASS: cancelled bill restore is blocked with a reason, can be declined, and reopens as an editable saved bill.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
