// Party-wise and Make bills bring along slips of earlier months still in stock, against the real screen with made-up API answers.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const { chooseDropdown } = require("./dropdown-helpers");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const STOCK_TIP = "Still in stock from an earlier month";
const slip = (id, party, month, sent = []) => {
  const dispatched = sent.reduce((s, d) => s + d.qty, 0);
  return {
    id, inwardNo: id, party, registerMonth: month, entryDate: `${month}-05`, designNo: `D${id}`, lotNo: "", repair: false,
    than: 10, tp: 0, nag: 10, nettThan: 10, twoPart: 0, finish: "S2G", shortThan: null, carriedOver: false, billedIn: null,
    dispatches: sent.map((d, i) => ({ qty: d.qty, gatePass: `G${id}${i}`, date: d.date, dateText: null })), dispatched, balance: 10 - dispatched,
    status: dispatched === 0 ? "pending" : dispatched < 10 ? "partial" : "done", warnings: [],
  };
};
const entries = [
  slip(1, "STOCK PARTY", "2026-10"),                                        // nothing sent yet
  slip(2, "STOCK PARTY", "2026-10", [{ qty: 4, date: "2026-10-20" }]),      // part sent in October
  slip(3, "STOCK PARTY", "2026-10", [{ qty: 10, date: "2026-11-05" }]),     // all sent, but in November
  slip(4, "STOCK PARTY", "2026-10", [{ qty: 10, date: "2026-10-25" }]),     // all sent in October
  slip(5, "STOCK PARTY", "2026-11", [{ qty: 10, date: "2026-11-06" }]),     // November's own
  slip(6, "OTHER PARTY", "2026-11"),                                        // November's own
  slip(7, "STOCK PARTY", "2026-03"),                                        // last financial year, nothing sent
];

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-11-21T12:00:00") });
    await page.route("**/api/months", (route) => {
      const months = [...new Set(entries.map((e) => e.registerMonth))].sort().reverse();
      return route.fulfill({ json: months.map((month) => ({ month, entries: entries.filter((e) => e.registerMonth === month).length })) });
    });
    // The screen works out which earlier slips to show, so every slip is answered and the screen has to leave out the rest.
    await page.route("**/api/partywise?*", (route) => route.fulfill({ json: entries }));
    await page.route("**/api/billing/parties?*", (route) => route.fulfill({ json: [{ party: "STOCK PARTY", entries: 2, nettThan: 20, notDispatched: 1 }] }));
    await page.route("**/api/billing/candidates?*", (route) => route.fulfill({ json: {
      billParty: "STOCK PARTY", sourceParties: ["STOCK PARTY"], active: true, billBeforeDispatch: false, discount: 0, gstin: "", problems: [], billRecipients: ["STOCK PARTY"],
      entries: [
        { entryId: 1, registerMonth: "2026-10", inwardNo: 1, entryDate: "2026-10-05", party: "STOCK PARTY", designNo: "D1", lotNo: "", finish: "S2G", billFinish: "S2G",
          nettThan: 10, nag: 10, dispatched: 0, available: 10, dispatchState: "none", gatePasses: "", lastDispatch: null, carriedOver: false, selected: false, rate: 10, fromStock: true },
        { entryId: 5, registerMonth: "2026-11", inwardNo: 5, entryDate: "2026-11-05", party: "STOCK PARTY", designNo: "D5", lotNo: "", finish: "S2G", billFinish: "S2G",
          nettThan: 10, nag: 10, dispatched: 10, available: 10, dispatchState: "full", gatePasses: "G50", lastDispatch: "2026-11-06", carriedOver: false, selected: true, rate: 10, fromStock: false },
      ],
    } }));

    const shown = async (ids) => {
      await page.waitForFunction((expected) =>
        [...document.querySelectorAll("#partyTable tbody tr:not(.group):not(.subgroup) td:first-child")].map((td) => Number(td.textContent)).sort((a, b) => a - b).join(",") === expected.join(","),
      ids);
    };
    const stockIds = () => page.locator("#partyTable tr.from-stock td:first-child").evaluateAll((cells) => cells.map((td) => Number(td.textContent)).sort((a, b) => a - b));
    const stat = (label) => page.locator("#partyTotals .stat").filter({ has: page.locator(".stat-label", { hasText: new RegExp(`^${label}:`) }) });

    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
    await page.locator('[data-view="partywise"]').click();

    // The financial year with no month: its slips and last year's still in stock when April began.
    await shown([1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(await stockIds(), [7]);

    // November: its slips, and October's (and March's) not fully sent before the 1st, marked like carryovers.
    await chooseDropdown(page.locator("#partyViewMonth"), "2026-11");
    await shown([1, 2, 3, 5, 6, 7]);
    assert.deepEqual(await stockIds(), [1, 2, 3, 7]);
    assert.equal(await page.locator("#partyTable tr.from-stock:not(.carried)").count(), 0, "stock rows look like carryovers");
    assert.ok((await page.locator("#partyTable tr.from-stock").first().getAttribute("title")).startsWith(STOCK_TIP));
    const stockParty = page.locator("#partyTable tr.group").filter({ hasText: "STOCK PARTY" });
    assert.equal(await stockParty.locator(".group-count").textContent(), "5 entries · 4 from stock");
    assert.equal(await page.locator("#partyTable tr.group").filter({ hasText: "OTHER PARTY" }).locator(".group-count").textContent(), "1 entry");
    assert.equal(await stat("Entries").locator(".stat-value").textContent(), "6");
    assert.equal(await stat("From stock").locator(".stat-value").textContent(), "4");
    assert.equal(await stat("Balance").locator(".stat-value").textContent(), "36", "the stock's balance counts in the totals");
    await page.locator("#partyFiltersToggle").click();
    assert.equal(await page.locator('#partyFilters [data-filter="carried"] .chip-count').textContent(), "4");
    await page.locator('#partyFilters [data-filter="carried"]').click();
    await shown([1, 2, 3, 7]);
    await page.locator("#partyFilters .filter-clear").click();
    await shown([1, 2, 3, 5, 6, 7]);

    // October and November together: October's own slips are not stock; only March's comes along.
    await chooseDropdown(page.locator("#partyViewMonth"), "2026-10");
    await shown([1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(await stockIds(), [7]);
    await page.locator("#partyViewMonth").press("Escape");

    // Last financial year: nothing earlier, and no From stock figure.
    await chooseDropdown(page.locator("#partyFinancialYear"), "2025");
    await shown([7]);
    assert.deepEqual(await stockIds(), []);
    assert.equal(await stat("From stock").count(), 0);

    // Make bills marks the slips from stock and says why they are there.
    await page.locator('[data-view="bills"]').click();
    await page.locator("#toBillList button").first().click();
    await page.waitForFunction(() => document.querySelectorAll("#candidateTable .cand").length === 2);
    assert.equal(await page.locator("#candidateTable .bill-stock-note").count(), 1);
    assert.equal(await page.locator("#candidateTable tbody tr").first().locator(".bill-stock-note").textContent(), "From stock");
    assert.ok((await page.locator("#candidateHint").textContent()).includes("still in stock when the period began"));

    assert.deepEqual(errors, []);
    console.log("Passed Party-wise and Make bills stock carry-in checks: months, financial years, marks, counts, totals, filter, and bill candidates.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
