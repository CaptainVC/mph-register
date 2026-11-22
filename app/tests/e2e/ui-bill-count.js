// Run against a fresh test data directory; this scenario creates entries (nothing is saved as a bill).
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const MANY = "BILL COUNT MANY";
const ONE = "BILL COUNT ONE";

async function call(path, method = "GET", body) {
  const response = await fetch(BASE + path, {
    method, headers: { "X-MPH-Request": "1", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(json)}`);
  return json;
}

async function seed() {
  const settings = await call("/api/settings");
  await call("/api/settings", "PUT", { billRules: { ...settings.billRules, rowsPerBill: 5 } });
  await call("/api/masters/group", "POST", { name: "BILL COUNT GROUP", active: true });
  for (const name of ["COUNT FINISH", "COUNT OTHER"]) {
    await call("/api/masters/finish", "POST", { name, active: true, group: "BILL COUNT GROUP", color: "black" });
  }
  await call("/api/masters/style", "POST", {
    name: "BILL COUNT STYLE", gpnColumn: "gatePass", dnColumn: "designNo", lotColumn: "lotNo",
    lines: "onePerEntry", order: "inward", combineSmallEntries: false,
  });
  for (const name of [MANY, ONE]) {
    await call("/api/masters/party", "POST", { name, active: true, discount: 0, billingStyle: "BILL COUNT STYLE", color: "black" });
    for (const [finish, rate] of [["COUNT FINISH", 100], ["COUNT OTHER", 80]]) await call("/api/masters/party/rate", "PUT", { party: name, finish, rate });
  }
  const add = (inwardNo, party, finish) => call("/api/entries", "POST", {
    registerMonth: "2026-11", inwardNo, entryDate: "2026-11-02", party, designNo: `D${inwardNo}`, lotNo: `L${inwardNo}`, than: 10, finish,
    dispatches: [{ qty: 10, gatePass: `G${inwardNo}`, date: "2026-11-03" }],
  });
  for (let i = 1; i <= 9; i++) await add(9100 + i, MANY, i === 9 ? "COUNT OTHER" : "COUNT FINISH");
  await add(9201, ONE, "COUNT FINISH");
}

(async () => {
  await seed();
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1268, height: 768 } });
    await page.clock.install({ time: new Date("2026-11-21T12:00:00") });
    const errors = [];
    const candidateRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => request.url().includes("/api/billing/candidates?") && candidateRequests.push(request.url()));
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
    await page.locator('[data-view="bills"]').click();
    const choose = (party) => page.locator("#toBillList button").filter({ hasText: party }).click();
    const label = () => page.locator("#makeBills").textContent();

    // Candidates and the bill counts of the pre-ticked entries are fetched ahead for every party.
    await page.waitForFunction(() => document.querySelectorAll("#toBillList button").length >= 2);
    await page.waitForFunction((parties) => parties.every((p) => [...billCache.ready.keys()].some((k) => k.startsWith(`${p}|`))) && billCache.counts.size >= 2 && billCache.countRequests.size === 0, [MANY, ONE]);

    await choose(MANY);
    await page.waitForFunction(() => document.querySelectorAll("#candidateTable .cand").length === 9);
    assert.equal(await label(), "Make 3 bills");
    await choose(ONE);
    await page.waitForFunction(() => document.querySelectorAll("#candidateTable .cand").length === 1);
    assert.equal(await label(), "Make 1 bill");

    // Flipping between parties draws at once from memory: the entries and the count are there in the same task as the click.
    const requestsBefore = candidateRequests.length;
    const flips = await page.evaluate((parties) => parties.map((party) => {
      [...document.querySelectorAll("#toBillList button")].find((b) => b.textContent.includes(party)).click();
      return [document.querySelectorAll("#candidateTable .cand").length, document.getElementById("makeBills").textContent, document.getElementById("makeBills").disabled];
    }), [MANY, ONE, MANY]);
    assert.deepEqual(flips, [[9, "Make 3 bills", false], [1, "Make 1 bill", false], [9, "Make 3 bills", false]]);
    assert.equal(candidateRequests.length, requestsBefore, "flipping parties does not ask the server again");

    // Changing the ticked entries updates the number, and it matches the bills that are then made.
    await page.locator("#candidateTable .cand").first().uncheck();
    await page.waitForFunction(() => /^Make \d+ bills?$/.test(document.getElementById("makeBills").textContent) && document.getElementById("billSelectedCount").textContent.startsWith("8 of 9"));
    const expected = Number((await label()).match(/\d+/)[0]);
    assert.ok(expected >= 1);
    await page.locator("#makeBills").click();
    await page.locator("#draftArea .draft").first().waitFor();
    assert.equal(await page.locator("#draftArea .draft").count(), expected);
    await page.locator("#discardBills").click();
    assert.equal(await label(), `Make ${expected} ${expected === 1 ? "bill" : "bills"}`);

    await page.locator("#candNone").click();
    assert.equal(await label(), "Make bills");
    assert.equal(await page.locator("#makeBills").isDisabled(), true);

    assert.deepEqual(errors, []);
    console.log("PASS: Make bills shows the number of bills, and flipping through parties needs no new request.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
