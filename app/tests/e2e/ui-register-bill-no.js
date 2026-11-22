// Run against a fresh test data directory; this scenario creates entries and saves one bill.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const PARTY = "BILL NO LINK TEST";

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
  await call("/api/masters/group", "POST", { name: "BILL NO GROUP", active: true });
  await call("/api/masters/finish", "POST", { name: "BILL NO FINISH", active: true, group: "BILL NO GROUP", color: "black" });
  await call("/api/masters/style", "POST", {
    name: "BILL NO STYLE", gpnColumn: "gatePass", dnColumn: "designNo", lotColumn: "lotNo",
    lines: "onePerEntry", order: "inward", combineSmallEntries: false,
  });
  await call("/api/masters/party", "POST", { name: PARTY, active: true, discount: 0, billingStyle: "BILL NO STYLE", color: "black" });
  await call("/api/masters/party/rate", "PUT", { party: PARTY, finish: "BILL NO FINISH", rate: 100 });
  const ids = [];
  for (let i = 1; i <= 3; i++) {
    const entry = await call("/api/entries", "POST", {
      registerMonth: "2026-11", inwardNo: 8200 + i, entryDate: "2026-11-02", party: PARTY,
      designNo: `LINK${i}`, lotNo: `L${i}`, than: 10, finish: "BILL NO FINISH",
      dispatches: [{ qty: 10, gatePass: `GP${i}`, date: "2026-11-03" }],
    });
    ids.push(entry.id);
  }
  const drafts = await call("/api/billing/build", "POST", {
    party: PARTY, month: "2026-11", entryIds: [ids[0]], billDate: "2026-11-30", periodFrom: "2026-11-01", periodTo: "2026-11-30",
  });
  const [bill] = await call("/api/billing/save", "POST", { invoices: drafts });
  await call("/api/billing/elsewhere", "POST", { entryIds: [ids[1]], note: "Billed in Excel" });
  return bill;
}

(async () => {
  const bill = await seed();
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.clock.install({ time: new Date("2026-11-21T12:00:00") });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));

    await page.locator('[data-view="register"]').click();
    await page.locator("#registerSearch").fill(PARTY);
    const rows = page.locator("#registerTable tbody tr");
    await rows.nth(2).waitFor();
    assert.equal(await rows.count(), 3);
    const billCell = (row) => rows.nth(row).locator("td").nth(24);
    assert.equal(await page.locator("#registerTable th").nth(24).textContent(), "BILL NO.");
    assert.equal(await billCell(0).locator("a").count(), 1, "a saved bill number is a link");
    assert.equal(await billCell(0).locator("a").textContent(), bill.invoiceNo);
    assert.equal(await billCell(1).locator("a").count(), 0, "a billed-outside note is plain text");
    assert.match(await billCell(1).textContent(), /Billed outside app/);
    assert.equal(await billCell(2).textContent(), "", "an unbilled row is blank");

    // The BILL NO. filter: bill numbers, blank and anything else.
    await page.locator("#registerFiltersToggle").click();
    const chip = (key) => page.locator(`#registerFilters [data-filter="${key}"]`);
    for (const [key, expected] of [["billNo", 1], ["billBlank", 1], ["billOther", 1]]) {
      assert.equal(await chip(key).locator(".chip-count").textContent(), String(expected), `${key} count`);
      await chip(key).click();
      assert.equal(await rows.count(), expected, `${key} rows`);
      await chip(key).click();
    }
    await chip("billNo").click();
    await chip("billOther").click();
    assert.equal(await rows.count(), 2, "ticked chips add up");
    await page.locator("#registerFilters .filter-clear").click();
    assert.equal(await rows.count(), 3);

    // The link opens the bill in Saved bills, even when its list was narrowed by a search.
    await page.locator('[data-view="bills"]').click();
    await page.locator('.subtab[data-sub="saved"]').click();
    await page.locator("#savedSearch").fill("no such bill");
    await page.locator("#savedSearch").dispatchEvent("input");
    await page.locator('[data-view="register"]').click();
    await rows.nth(2).waitFor();
    await billCell(0).locator("a").click();
    await page.locator("#bills-saved.active").waitFor();
    await page.locator("#invoiceEditor #ie-save").waitFor();
    assert.equal(await page.locator("#savedSearch").inputValue(), "");
    assert.match(await page.locator("#invoiceEditor").textContent(), new RegExp(PARTY));
    assert.equal(await page.locator("#invoiceTable tbody tr.selected").getAttribute("data-id"), String(bill.id));
    assert.deepEqual(errors, []);
    console.log("PASS: Register BILL NO. links open the saved bill and the BILL NO. filter chips.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
