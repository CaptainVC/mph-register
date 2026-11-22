// Run against a fresh test data directory; this scenario creates a party that needs no bill, a party that does, and entries.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const BILLED = "NOBILL PAYS";
const SKIPPED = "NOBILL PARKER";

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
  await call("/api/masters/group", "POST", { name: "NO BILL GROUP", active: true });
  await call("/api/masters/finish", "POST", { name: "NO BILL FINISH", active: true, group: "NO BILL GROUP", color: "black" });
  await call("/api/masters/style", "POST", {
    name: "NO BILL STYLE", gpnColumn: "gatePass", dnColumn: "designNo", lotColumn: "lotNo",
    lines: "onePerEntry", order: "inward", combineSmallEntries: false,
  });
  await call("/api/masters/party", "POST", { name: BILLED, active: true, discount: 0, billingStyle: "NO BILL STYLE", color: "black" });
  await call("/api/masters/party/rate", "PUT", { party: BILLED, finish: "NO BILL FINISH", rate: 100 });
  await call("/api/masters/party", "POST", { name: SKIPPED, active: true, billingStyle: "NO BILL STYLE", color: "black", noBillNeeded: true });
  for (const [inward, party] of [[8301, BILLED], [8302, SKIPPED], [8303, SKIPPED]]) {
    await call("/api/entries", "POST", {
      registerMonth: "2026-11", inwardNo: inward, entryDate: "2026-11-02", party,
      designNo: `NB${inward}`, lotNo: `L${inward}`, than: 10, finish: "NO BILL FINISH",
      dispatches: [{ qty: 10, gatePass: `GP${inward}`, date: "2026-11-03" }],
    });
  }
}

(async () => {
  await seed();
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.clock.install({ time: new Date("2026-11-21T12:00:00") });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));

    // Register: the party's rows say so, and the Bill filter tells them apart from rows still waiting for a bill.
    await page.locator('[data-view="register"]').click();
    await page.locator("#registerSearch").fill("NOBILL");
    const rows = page.locator("#registerTable tbody tr");
    await rows.nth(2).waitFor();
    assert.equal(await rows.count(), 3);
    const billCell = (row) => rows.nth(row).locator("td").nth(24);
    assert.equal(await billCell(0).textContent(), "", "a party that needs bills is blank until billed");
    assert.equal(await billCell(1).textContent(), "No bill needed");
    assert.equal(await billCell(2).textContent(), "No bill needed");
    await page.locator("#registerFiltersToggle").click();
    const chip = (key) => page.locator(`#registerFilters [data-filter="${key}"]`);
    for (const [key, expected] of [["billBlank", 1], ["billNone", 2]]) {
      assert.equal(await chip(key).locator(".chip-count").textContent(), String(expected), `${key} count`);
      await chip(key).click();
      assert.equal(await rows.count(), expected, `${key} rows`);
      await chip(key).click();
    }

    // Make bills: the party is not listed as work to bill, and choosing it explains why nothing can be billed.
    await page.locator('[data-view="bills"]').click();
    await page.locator("#toBillList .party-choice", { hasText: BILLED }).waitFor();
    assert.equal(await page.locator("#toBillList .party-choice", { hasText: SKIPPED }).count(), 0);
    await page.locator("#billParty").fill(SKIPPED);
    await page.locator("#billParty").press("Enter");
    await page.locator("#candidateHead .bill-party-alert").waitFor();
    assert.match(await page.locator("#candidateHead .bill-party-alert").textContent(), /No bill needed/);
    assert.equal(await page.locator("#candidateTable .cand").count(), 0);
    assert.equal(await page.locator("#makeBills").isDisabled(), true);

    // Masters: the party form shows the setting and clearing it puts the party back into Make bills.
    await page.locator('[data-view="masters"]').click();
    await page.locator("#partyMasterTable tbody tr", { hasText: SKIPPED }).waitFor();
    await page.locator("#partySearch").fill(SKIPPED);
    await page.locator("#partyMasterTable tbody tr", { hasText: SKIPPED }).click();
    await page.locator("#pf-no-bill").waitFor();
    assert.equal(await page.locator("#pf-no-bill").isChecked(), true);
    assert.equal(await page.locator("#pf-before-dispatch").isDisabled(), true);
    assert.match(await page.locator("#partyMasterTable tbody tr", { hasText: SKIPPED }).textContent(), /no bill needed/);
    await page.locator("#pf-no-bill").uncheck();
    await page.locator("#pf-save").click();
    await page.waitForFunction(async (name) => (await (await fetch("/api/masters/full")).json()).parties.some((p) => p.name === name && !p.noBillNeeded), SKIPPED);
    assert.equal((await call("/api/masters/full")).parties.find((p) => p.name === SKIPPED).noBillNeeded, false);
    assert.deepEqual(errors, []);
    console.log("PASS: A party that needs no bill is marked in the register, left out of Make bills and editable in Masters.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
