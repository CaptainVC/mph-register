// Emptying the Party-wise party box must bring every party back without pressing Enter.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const entry = (id, party) => ({
  id, inwardNo: id, party, finish: "S2G", status: "pending", than: 5, nettThan: 5, nag: 5,
  registerMonth: "2026-11", entryDate: "2026-11-15", designNo: "", lotNo: "",
  repair: false, tp: 0, twoPart: 0, shortThan: null, carriedOver: false,
  dispatched: 0, balance: 5, dispatches: [], warnings: [], billedIn: "",
});
const entries = [entry(1, "ABC"), entry(2, "THOMAS MILLS")];

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/partywise?**", (route) => {
      const party = new URL(route.request().url()).searchParams.get("party");
      route.fulfill({ json: party ? entries.filter((e) => e.party === party) : entries });
    });
    await page.route("**/api/months", (route) => route.fulfill({ json: [{ month: "2026-11", entries: entries.length }] }));
    await page.route("**/api/masters", async (route) => {
      const response = await route.fetch();
      const masters = await response.json();
      masters.parties = [...masters.parties.filter((p) => p.name !== "THOMAS MILLS"), { name: "THOMAS MILLS", active: true }];
      route.fulfill({ json: masters });
    });
    await page.goto(BASE);
    await page.waitForFunction(() => document.activeElement.id === "party");
    await page.locator('[data-view="partywise"]').click();
    const partyRows = page.locator("#partyTable tr.group");
    await partyRows.first().waitFor();
    assert.equal(await partyRows.count(), 2);

    await page.locator("#partyFilter").fill("THOMAS MILLS");
    await page.locator("#partyFilter").press("Enter");
    await page.waitForFunction(() => document.querySelectorAll("#partyTable tr.group").length === 1);

    await page.locator("#partyFilter").fill("");
    await page.waitForFunction(() => document.querySelectorAll("#partyTable tr.group").length === 2);
    assert.equal(await page.locator("#partyCount").textContent(), "2 entries");

    await page.locator("#partyFilter").fill("THOMAS MILLS");
    await page.locator("#partyFilter").press("Enter");
    await page.waitForFunction(() => document.querySelectorAll("#partyTable tr.group").length === 1);
    await page.locator("#partyFilter").press("Backspace");
    await page.waitForFunction(() => document.querySelectorAll("#partyTable tr.group").length === 2);

    assert.deepEqual(errors, [], "no browser script errors");
    console.log("Passed Party-wise party filter clears as soon as the text no longer names the party.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
