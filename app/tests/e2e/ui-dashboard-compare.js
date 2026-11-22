// Run against a test data folder: this creates three parties with bills in 2023 and 2024. The dashboard adds up several months
// and several parties on the screen, compares them with the period before or the year before, and remembers the choice.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright-core");
const { chooseDropdown } = require("./dropdown-helpers");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const ALPHA = "CMP TEST ALPHA";
const BETA = "CMP TEST BETA";
const GAMMA = "CMP TEST GAMMA";
const GROUP = "CMP TEST SISTERS";
const FINISH = "CMP TEST FINISH";
// THAN billed per month at ₹100 a THAN, no discount.
const BILLS = {
  [ALPHA]: { "2023-07": 10, "2023-08": 10, "2023-09": 10, "2023-10": 10, "2024-07": 20, "2024-08": 30, "2024-09": 40, "2024-10": 50 },
  [BETA]: { "2023-08": 10, "2023-09": 10, "2023-10": 10, "2024-08": 5, "2024-09": 5, "2024-10": 5 },
  [GAMMA]: { "2024-10": 7 },
};

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
  await call("/api/masters/group", "POST", { name: "CMP TEST GROUP", active: true });
  await call("/api/masters/finish", "POST", { name: FINISH, active: true, group: "CMP TEST GROUP", color: "black" });
  await call("/api/masters/style", "POST", {
    name: "CMP TEST STYLE", gpnColumn: "gatePass", dnColumn: "designNo", lotColumn: "lotNo",
    lines: "onePerEntry", order: "inward", combineSmallEntries: false,
  });
  let inwardNo = 8700;
  for (const [party, months] of Object.entries(BILLS)) {
    await call("/api/masters/party", "POST", {
      name: party, active: true, discount: 0, billingStyle: "CMP TEST STYLE", color: "black", sisterGroup: party === GAMMA ? "" : GROUP,
    });
    await call("/api/masters/party/rate", "PUT", { party, finish: FINISH, rate: 100 });
    for (const [month, than] of Object.entries(months)) {
      const last = `${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()}`;
      const entry = await call("/api/entries", "POST", {
        registerMonth: month, inwardNo: ++inwardNo, entryDate: `${month}-02`, party, finish: FINISH, than,
        dispatches: [{ qty: than, gatePass: `CMP${inwardNo}`, date: `${month}-03` }],
      });
      const invoices = await call("/api/billing/build", "POST", { party, month, entryIds: [entry.id], billDate: last, periodFrom: `${month}-01`, periodTo: last });
      await call("/api/billing/save", "POST", { invoices });
    }
  }
}

const text = (page, selector) => page.locator(selector).textContent();
const chips = (page) => page.locator("#dashChips .dash-chip-name").allTextContents();
const billed = (page) => page.locator("#kpi-billed .kpi-value").getAttribute("title");
const cells = (page, party) => page.locator("#dashMatrix tbody tr", { hasText: party }).locator("td").allTextContents();

(async () => {
  await seed();
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
    await page.locator('[data-view="dashboard"]').click();
    await page.locator("#dashMain").waitFor();

    // Sister firms are ticked together from the list.
    await page.locator("#dashPartyList").click();
    await page.locator("#dashPicker[open]").waitFor();
    await page.locator("#dashPickerSearch").fill("cmp test");
    assert.equal(await page.locator("#dashPickerList label").count(), 3);
    await page.locator("#dashPicker .dash-groups button", { hasText: GROUP }).click();
    assert.equal(await text(page, "#dashPickerCount"), "2 parties ticked");
    await page.locator("#dashPickerApply").click();
    await page.waitForFunction(() => !document.querySelector("#dashPicker[open]"));
    assert.deepEqual((await chips(page)).sort(), [ALPHA, BETA]);

    // Several months: pick August, then add September and October.
    await chooseDropdown(page.locator("#dashYear"), "24-25");
    await page.locator('#dashMonths [data-month="2024-08"]').click();
    await page.locator("#dashMulti").check();
    await page.locator('#dashMonths [data-month="2024-09"]').click();
    await page.locator('#dashMonths [data-month="2024-10"]').click();
    assert.equal(await text(page, "#dashPicked"), "Aug – Oct 2024 · 3 months");
    assert.equal(await billed(page), "₹13,500");
    // The previous period (May – Jul 2024) had only ALPHA's July bill of ₹2,000.
    await page.locator('[data-compare="previous"]').click();
    assert.equal(await text(page, "#kpi-billed .trend"), "▲ 575.0% more than May – Jul 2024");
    await page.locator('[data-compare="lastYear"]').click();
    assert.equal(await text(page, "#kpi-billed .trend"), "▲ 125.0% more than Aug – Oct 2023");
    assert.match(await text(page, "#dashSummary"), /vs Aug – Oct 2023/);

    // Shift+click picks the months in between.
    await page.locator("#dashMulti").uncheck();
    await page.locator('#dashMonths [data-month="2024-07"]').click();
    await page.locator('#dashMonths [data-month="2024-10"]').click({ modifiers: ["Shift"] });
    assert.equal(await text(page, "#dashPicked"), "Jul – Oct 2024 · 4 months");
    assert.equal(await billed(page), "₹15,500");

    // Compare: one row per party, one column per month, the total and the same months last year.
    await page.locator('.dash-tab[data-section="compare"]').click();
    await page.locator("#dashMatrix").waitFor();
    assert.deepEqual(await page.locator("#dashMatrix thead th").allTextContents(), ["Party", "Jul", "Aug", "Sep", "Oct", "Total", "Jul – Oct 2023", "Change"]);
    assert.deepEqual(await cells(page, ALPHA), ["₹2,000", "₹3,000", "₹4,000", "₹5,000", "₹14,000", "₹4,000", "▲ 250.0%"]);
    assert.deepEqual(await cells(page, BETA), ["—", "₹500", "₹500", "₹500", "₹1,500", "₹3,000", "▼ 50.0%"]);
    assert.deepEqual((await page.locator("#dashMatrix tfoot tr").first().locator("td").allTextContents()).slice(4, 5), ["₹15,500"]);
    assert.equal(await page.locator("#dash-compare svg.line-chart polyline").count(), 2);
    await page.locator('[data-metric="than"]').click();
    assert.deepEqual((await cells(page, ALPHA)).slice(0, 5), ["20", "30", "40", "50", "140"]);
    const download = page.waitForEvent("download");
    await page.locator("#dashCsvCompare").click();
    const csv = fs.readFileSync(await (await download).path(), "utf8");
    assert.match(csv, /^\uFEFFParty,July 2024,August 2024,September 2024,October 2024,Total,Jul – Oct 2023\r\n/);
    assert.match(csv, new RegExp(`${ALPHA},20,30,40,50,140,40\\r\\n`));
    await page.locator('[data-metric="perThan"]').click();
    assert.deepEqual((await cells(page, ALPHA)).slice(0, 5), ["₹100.00", "₹100.00", "₹100.00", "₹100.00", "₹100.00"]);

    // Parties: every party, found by name, sorted; ticked parties are compared.
    await page.locator("#dashPartyClear").click();
    await page.locator('.dash-tab[data-section="parties"]').click();
    await page.locator("#dashPartyFilter").fill("cmp test");
    await page.locator('#dashPartyTable [data-sort="name"]').click();
    const names = () => page.locator("#dashPartyTable tbody td.name-cell").allTextContents();
    assert.deepEqual(await names(), [ALPHA, BETA, GAMMA]);
    await page.locator('#dashPartyTable [data-sort="name"]').click();
    assert.deepEqual(await names(), [GAMMA, BETA, ALPHA]);
    await page.getByLabel(`Tick ${BETA}`).check();
    await page.getByLabel(`Tick ${GAMMA}`).check();
    await page.locator("#dashCompareTicked").click();
    await page.locator('.dash-tab.active[data-section="compare"]').waitFor();
    assert.deepEqual((await chips(page)).sort(), [BETA, GAMMA]);

    // A party in detail, then that party alone.
    await page.locator("#dashMatrix tbody tr", { hasText: GAMMA }).locator("button").click();
    await page.locator("#dashPartyPanel[open]").waitFor();
    assert.match(await text(page, "#dashPartyPanel h2"), new RegExp(GAMMA));
    assert.equal(await page.locator("#panel-billed .kpi-value").getAttribute("title"), "₹700");
    await page.locator("#dashPanelOnly").click();
    await page.waitForFunction(() => !document.querySelector("#dashPartyPanel[open]"));
    assert.deepEqual(await chips(page), [GAMMA]);

    // The choice is remembered when the app is opened again.
    await page.reload();
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
    await page.locator('[data-view="dashboard"]').click();
    await page.locator('.dash-tab.active[data-section="compare"]').waitFor();
    assert.deepEqual(await chips(page), [GAMMA]);
    assert.equal(await text(page, "#dashPicked"), "Jul – Oct 2024 · 4 months");

    // A month still running is not compared, and the side panel says why.
    await page.locator('[data-preset="thisMonth"]').click();
    assert.match(await text(page, "#dashCompareGap"), /still running/);
    await page.evaluate(() => setLanguageChoice("hi"));
    await page.waitForFunction(() => document.querySelector('.dash-tab[data-section="compare"]')?.textContent.includes("तुलना"));
    assert.match(await text(page, "#dashCompareGap"), /अभी चल रहा है/, "worked-out sentences follow the language too");
    await page.evaluate(() => setLanguageChoice("en"));
    await page.waitForFunction(() => document.querySelector('.dash-tab[data-section="compare"]')?.textContent.includes("Compare"));
    assert.deepEqual(errors, []);
    console.log("Dashboard months, parties, comparisons, matrix, ticking, party detail, Excel and remembered choice passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
