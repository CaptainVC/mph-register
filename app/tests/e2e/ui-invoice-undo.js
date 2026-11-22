// Routed fixtures exercise the real bill drawer without changing production data.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const blockedReason = "A later bill exists in this financial year, even if it is cancelled or for another party.";
const invoice = (id, allowed) => ({
  id, invoiceNo: `26-27\\JOB\\${278 + id}`, billMonth: "2026-10", billDate: "2026-10-28",
  periodFrom: "2026-10-01", periodTo: "2026-10-28", party: "UNDO TEST", partyName: "UNDO TEST",
  address: "TEST ADDRESS", state: "", gstin: "", notes: "", finishes: "F1", entries: 1,
  status: "saved", source: "app", gross: 1000, discountPct: 0, discount: 0, taxable: 1000,
  cgstRate: 2.5, sgstRate: 2.5, igstRate: 5, taxMode: "intra", cgst: 25, sgst: 25, igst: 0,
  total: 1050, than: 10, amountInWords: "One Thousand Fifty Only", warnings: [], firm: null,
  lines: [{ kind: "priced", gpn: "G1", dn: "D1", lot: "L1", finish: "F1", qty: 10, rate: 100, amount: 1000, entryIds: [id], rows: 1 }],
  undoSave: { allowed, reason: allowed ? null : blockedReason, token: allowed ? `token-${id}` : null },
});

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.clock.install({ time: new Date("2026-11-21T12:00:00") });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let invoices = [invoice(1, false), invoice(2, true)];
    let failure = null;
    const requests = [];
    await page.route("**/api/months", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/invoices", (route) => route.fulfill({ json: invoices }));
    await page.route("**/api/billing/parties?*", (route) => route.fulfill({ json: [] }));
    await page.route(/\/api\/invoices\/\d+(?:\/undo-save|\/cancel)?$/, async (route) => {
      const request = route.request();
      const id = Number(new URL(request.url()).pathname.split("/")[3]);
      const bill = invoices.find((i) => i.id === id);
      if (request.url().endsWith("/undo-save")) {
        requests.push(request.postDataJSON());
        if (failure) return route.fulfill({ status: 400, json: { errors: [failure] } });
        invoices = invoices.filter((i) => i.id !== id);
        return route.fulfill({ json: { invoiceNo: bill.invoiceNo, nextSerial: 278 + id } });
      }
      if (request.url().endsWith("/cancel")) {
        bill.status = "cancelled";
        bill.undoSave = { allowed: false, reason: "A cancelled bill keeps its number and cannot be undone.", token: null };
      }
      return route.fulfill({ json: bill });
    });

    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
    await page.locator('[data-view="bills"]').click();
    await page.locator('#view-bills [data-sub="saved"]').click();
    await page.locator('#invoiceTable tr[data-id="1"]').click();
    await page.waitForSelector("#invoiceDrawer[open] #ie-undo:disabled");
    assert.equal(await page.locator("#ie-undo").isDisabled(), true);
    assert.equal(await page.locator("#ie-undo-help").textContent(), blockedReason);
    await page.locator("#invoiceDrawer .drawer-foot button").filter({ hasText: /^Close$/ }).click();

    await page.locator('#invoiceTable tr[data-id="2"]').click();
    await page.waitForSelector("#invoiceDrawer[open] #ie-undo:enabled");
    assert.equal(await page.locator("#ie-undo").isEnabled(), true);
    await page.locator("#ie-undo").click();
    assert.ok((await page.locator("#appDialogBody").textContent()).includes("never issued"));
    assert.ok((await page.locator("#appDialogBody").textContent()).includes("IRN"));
    assert.equal(await page.locator("#appDialogConfirm").textContent(), "Never issued - undo save");
    await page.locator("#appDialogCancel").click();
    assert.equal(requests.length, 0);
    assert.equal(await page.locator("#invoiceDrawer").getAttribute("open"), "");

    await page.locator("#ie-notes").fill("unsaved correction");
    await page.locator("#ie-undo").click();
    assert.equal(await page.locator("#ie-message").textContent(), "Save or discard your changes before undoing this bill's save.");
    assert.equal(requests.length, 0);
    await page.locator("#invoiceDrawer .drawer-foot button").filter({ hasText: /^Close$/ }).click();
    await page.locator("#appDialogConfirm").click();
    await page.locator('#invoiceTable tr[data-id="2"]').click();
    await page.waitForFunction(() => document.querySelector("#invoiceDrawer").open && document.querySelector("#ie-notes").value === "");

    failure = "The bill has changed. Reopen it before undoing the save.";
    await page.locator("#ie-undo").click();
    await page.locator("#appDialogConfirm").click();
    await page.waitForFunction((text) => document.querySelector("#ie-message").textContent === text, failure);
    assert.equal(invoices.length, 2);
    assert.equal(await page.locator("#ie-undo").isEnabled(), true);

    failure = null;
    await page.locator("#ie-undo").click();
    await page.locator("#appDialogConfirm").click();
    await page.waitForFunction(() => !document.querySelector("#invoiceDrawer").open);
    await page.waitForFunction(() => document.querySelectorAll("#invoiceTable tbody tr").length === 1);
    assert.deepEqual(requests.at(-1), { neverIssued: true, token: "token-2" });
    assert.equal(await page.locator("#invoiceTable tbody tr").getAttribute("data-id"), "1");
    await page.waitForFunction(() => document.querySelector("#billMessage").textContent.includes("Next bill number: 280."));

    await page.locator('#invoiceTable tr[data-id="1"]').click();
    await page.locator("#ie-cancel").click();
    assert.ok((await page.locator("#appDialogBody").textContent()).includes("The number stays used"));
    await page.locator("#appDialogConfirm").click();
    await page.waitForFunction(() => !document.querySelector("#ie-cancel"));
    assert.equal(await page.locator("#ie-undo").count(), 0);
    assert.equal(await page.locator("#ie-print").isEnabled(), true);
    assert.equal(await page.locator("#invoiceTable tbody tr").count(), 1);
    assert.equal(await page.locator("#invoiceTable tbody tr").locator("td").nth(7).textContent(), "CANCELLED");
    assert.deepEqual(errors, []);
    console.log("PASS: invoice undo eligibility, explicit confirmation, decline, dirty/stale protection, release refresh, and unchanged cancellation.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
