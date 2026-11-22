// Run against a test data folder: this creates two parties and a saved bill for each.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const { chooseDropdown, dropdownValue, dropdownValues } = require("./dropdown-helpers");

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
    assert.match(await party.textContent(), /All parties/);
    assert.equal((await dropdownValues(party))[0], "");
    assert.equal(await page.locator("#dash-overall").count(), 0);

    await chooseDropdown(page.locator("#dashYear"), "24-25");
    await page.waitForFunction((month) => document.querySelector("#dashMonth").value === month, MONTH);
    await chooseDropdown(party, PARTY);
    const overall = page.locator("#dash-overall");
    await overall.waitFor();
    assert.equal(await dropdownValue(party), PARTY);
    assert.equal(await dropdownValue(page.locator("#dashMonth")), MONTH);
    assert.match(await overall.textContent(), /Compared with all parties/);
    const monthCells = overall.locator("tbody tr").first().locator("td");
    assert.deepEqual(await monthCells.allTextContents(), ["₹1,000", "₹4,000", "25.0%"]);
    assert.equal(await page.locator("#dash-parties").count(), 0);
    assert.match(await page.locator("#dash-stock tbody tr").first().textContent(), /10/);

    await chooseDropdown(page.locator("#dashMonth"), "2024-09");
    await page.waitForFunction(() => document.querySelector("#dash-overall tbody tr th")?.textContent === "September 2024");
    assert.deepEqual(await monthCells.allTextContents(), ["₹0", "₹0", "—"]);
    const refreshed = page.waitForResponse((r) => new URL(r.url()).searchParams.get("party") === PARTY && r.url().includes("/api/dashboard?"));
    await page.locator("#dashRefresh").click();
    assert.ok((await refreshed).ok());
    await chooseDropdown(party, "");
    await page.locator("#dash-parties").waitFor();
    assert.equal(await overall.count(), 0);
    assert.equal(await dropdownValue(page.locator("#dashMonth")), "2024-09");
    assert.deepEqual(errors, []);
    console.log("Dashboard party filter and overall comparisons passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
