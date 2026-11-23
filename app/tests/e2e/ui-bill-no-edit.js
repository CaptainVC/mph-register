// Run against a fresh test data directory; this scenario creates entries and saves bills.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const FIRST = "BILL NO EDIT FIRST";
const SECOND = "BILL NO EDIT SECOND";

async function call(path, method = "GET", body) {
  const response = await fetch(BASE + path, {
    method, headers: { "X-MPH-Request": "1", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(json)}`);
  return json;
}

const serialOf = (invoiceNo) => Number(/(\d+)$/.exec(invoiceNo)[1]);

async function seed() {
  await call("/api/masters/group", "POST", { name: "BILL NO EDIT GROUP", active: true });
  await call("/api/masters/finish", "POST", { name: "BILL NO EDIT FINISH", active: true, group: "BILL NO EDIT GROUP", color: "black" });
  await call("/api/masters/style", "POST", {
    name: "BILL NO EDIT STYLE", gpnColumn: "gatePass", dnColumn: "designNo", lotColumn: "lotNo",
    lines: "onePerEntry", order: "inward", combineSmallEntries: false,
  });
  const entries = {};
  for (const [index, party] of [FIRST, SECOND].entries()) {
    await call("/api/masters/party", "POST", { name: party, active: true, discount: 0, billingStyle: "BILL NO EDIT STYLE", color: "black" });
    await call("/api/masters/party/rate", "PUT", { party, finish: "BILL NO EDIT FINISH", rate: 100 });
    entries[party] = await call("/api/entries", "POST", {
      registerMonth: "2026-11", inwardNo: 8900 + index, entryDate: "2026-11-02", party,
      designNo: `NUM${index}`, lotNo: `L${index}`, than: 10, finish: "BILL NO EDIT FINISH",
      dispatches: [{ qty: 10, gatePass: `GN${index}`, date: "2026-11-03" }],
    });
  }
  const drafts = await call("/api/billing/build", "POST", {
    party: FIRST, month: "2026-11", entryIds: [entries[FIRST].id], billDate: "2026-11-20", periodFrom: "2026-11-01", periodTo: "2026-11-30",
  });
  const [bill] = await call("/api/billing/save", "POST", { invoices: drafts });
  return serialOf(bill.invoiceNo);
}

(async () => {
  const taken = await seed();
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1268, height: 900 } });
    await page.clock.install({ time: new Date("2026-11-21T12:00:00") });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
    await page.locator('[data-view="bills"]').click();
    await page.locator("#toBillList button").filter({ hasText: SECOND }).click();
    await page.waitForFunction(() => !document.querySelector("#makeBills").disabled);
    await page.locator("#makeBills").click();

    const input = page.locator("#billNo0");
    await input.waitFor();
    await page.waitForFunction(() => document.querySelector("#billNo0").value !== "");
    assert.equal(await input.inputValue(), String(taken + 1), "the next free number is shown before saving");
    assert.equal(await page.locator(".bill-no-problem").textContent(), "");

    const discount = page.locator("#billDiscount0");
    assert.equal(await discount.inputValue(), "0", "the party discount is the initial value");
    await discount.fill("10");
    await page.waitForFunction(() => document.querySelector("#draftArea .bill-totals").textContent.includes("10%"));
    assert.match(await page.locator("#draftArea .bill-totals").textContent(), /₹100\.00/, "the discount amount is recalculated");

    // A number that a saved bill already has is refused on screen and nothing is saved.
    await input.fill(String(taken));
    await page.locator(".bill-no-problem").filter({ hasText: "already used" }).waitFor();
    assert.equal(await input.getAttribute("aria-invalid"), "true");
    await page.locator("#saveBills").click();
    assert.match(await page.locator("#billMessage").textContent(), /already used/);
    assert.equal((await call("/api/invoices?party=" + encodeURIComponent(SECOND))).length, 0);

    // A free number is accepted and used for the saved bill.
    const chosen = taken + 25;
    await input.fill(String(chosen));
    await page.waitForFunction(() => document.querySelector("#billNo0").getAttribute("aria-invalid") === "false");
    await page.locator("#saveBills").click();
    await page.locator("#printSaved").waitFor();
    const [saved] = await call("/api/invoices?party=" + encodeURIComponent(SECOND));
    assert.equal(serialOf(saved.invoiceNo), chosen);
    const savedBill = await call(`/api/invoices/${saved.id}`);
    assert.equal(savedBill.discountPct, 10, "the edited discount percentage is saved on the bill");
    assert.equal(savedBill.discount, 100, "the saved discount amount uses the edited percentage");
    assert.deepEqual(errors, []);
    console.log("PASS: Make bills lets the user edit the discount and bill no., recalculates totals, and refuses a number that clashes with a saved bill.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
