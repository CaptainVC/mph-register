// Run against a test data folder: this creates two parties and a saved bill for each.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const { chooseDropdown, dropdownValues } = require("./dropdown-helpers");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const PARTY = "DASH TEST A & CO";
const OTHER = "DASH TEST B";
const MONTH = "2024-10";

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
  await call("/api/masters/group", "POST", { name: "DASH TEST GROUP", active: true });
  await call("/api/masters/finish", "POST", { name: "DASH TEST FINISH", active: true, group: "DASH TEST GROUP", color: "black" });
  await call("/api/masters/style", "POST", {
    name: "DASH TEST STYLE", gpnColumn: "gatePass", dnColumn: "designNo", lotColumn: "lotNo",
    lines: "onePerEntry", order: "inward", combineSmallEntries: false,
  });
  for (const [party, than, inwardNo] of [[PARTY, 10, 8501], [OTHER, 30, 8503]]) {
    await call("/api/masters/party", "POST", { name: party, active: true, discount: 0, billingStyle: "DASH TEST STYLE", color: "black" });
    await call("/api/masters/party/rate", "PUT", { party, finish: "DASH TEST FINISH", rate: 100 });
    const entry = { registerMonth: MONTH, entryDate: `${MONTH}-02`, party, finish: "DASH TEST FINISH", than };
    const billed = await call("/api/entries", "POST", { ...entry, inwardNo, dispatches: [{ qty: than, gatePass: `GP${inwardNo}`, date: `${MONTH}-03` }] });
    await call("/api/entries", "POST", { ...entry, inwardNo: inwardNo + 1 });
    const invoices = await call("/api/billing/build", "POST", {
      party, month: MONTH, entryIds: [billed.id], billDate: `${MONTH}-31`, periodFrom: `${MONTH}-01`, periodTo: `${MONTH}-31`,
    });
    await call("/api/billing/save", "POST", { invoices });
  }
}

const chips = (page) => page.locator("#dashChips .dash-chip-name").allTextContents();

(async () => {
  await seed();
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1320, height: 800 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
    await page.locator('[data-view="dashboard"]').click();
    const party = page.locator("#dashParty");
    await party.waitFor();
    assert.equal(await page.locator("#dashChips").textContent(), "All parties");
    assert.equal(await page.locator("#dash-overall").count(), 0);

    // October 2024: the year first, then its month.
    await chooseDropdown(page.locator("#dashYear"), "24-25");
    await page.locator(`#dashMonths [data-month="${MONTH}"]`).click();
    await page.locator(`#dashMonths [data-month="${MONTH}"][aria-pressed="true"]`).waitFor();
    assert.match(await page.locator("#dashSummary").textContent(), /October 2024/);

    // Typing part of a name and pressing Enter adds the party; its share of all parties is shown.
    await party.fill("test a");
    await party.press("Enter");
    const overall = page.locator("#dash-overall");
    await overall.waitFor();
    assert.deepEqual(await chips(page), [PARTY]);
    assert.match(await overall.textContent(), /Compared with all parties/);
    const monthCells = overall.locator("tbody tr").first().locator("td");
    assert.deepEqual((await monthCells.allTextContents()).slice(0, 1), ["₹1,000"]);
    const all = Number((await monthCells.nth(1).getAttribute("title")).replace(/[₹,]/g, ""));
    assert.ok(all >= 4000, `all parties include both bills (${all})`);
    assert.equal(await monthCells.nth(2).textContent(), `${((1000 * 100) / all).toFixed(1)}%`);
    assert.equal(await page.locator("#kpi-billed .kpi-value").getAttribute("title"), "₹1,000");
    assert.match(await page.locator("#kpi-stock .kpi-value").textContent(), /^10 pieces$/, "the unsent entry is in the factory");

    // A second party: both are added up and listed side by side; the list no longer offers the parties already picked.
    await party.fill("test b");
    const offered = await dropdownValues(party);
    assert.equal(offered.length, 1, `one match for "test b": ${offered}`);
    await party.fill("test b");
    await party.press("Enter");
    await page.waitForFunction(() => document.querySelectorAll("#dashChips .dash-chip-name").length === 2);
    assert.deepEqual(await chips(page), [PARTY, OTHER]);
    assert.equal(await page.locator("#kpi-billed .kpi-value").getAttribute("title"), "₹4,000");
    assert.deepEqual(await page.locator("#dash-top-parties .hbar-name").allTextContents(), [OTHER, PARTY]);
    await party.fill("dash test");
    assert.deepEqual(await dropdownValues(party), [], "picked parties are not offered again");

    // Text that is no party adds nothing; removing a chip and "All parties" bring the others back.
    await party.fill("no such party");
    await party.press("Enter");
    assert.deepEqual(await chips(page), [PARTY, OTHER]);
    await page.locator("#dashChips .dash-chip", { hasText: PARTY }).locator(".dash-chip-x").click();
    await page.waitForFunction(() => document.querySelectorAll("#dashChips .dash-chip-name").length === 1);
    assert.equal(await page.locator("#kpi-billed .kpi-value").getAttribute("title"), "₹3,000");
    await page.locator("#dashPartyClear").click();
    await page.locator("#dash-top-parties").waitFor();
    assert.equal(await page.locator("#dashChips").textContent(), "All parties");
    assert.equal(await overall.count(), 0);
    assert.match(await page.locator("#dashSummary").textContent(), /October 2024/, "the period stays when parties change");

    // Refresh asks again; while nothing changed the server answers 304 and the screen stays as it is.
    const refreshed = page.waitForResponse((r) => r.url().endsWith("/api/dashboard/facts"));
    await page.locator("#dashRefresh").click();
    assert.equal((await refreshed).status(), 304);
    assert.deepEqual(errors, []);
    console.log("Dashboard party picking, adding up and overall comparisons passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
