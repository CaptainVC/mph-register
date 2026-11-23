// Run against a fresh test data directory; this scenario types Aawak rows and inward entries and follows the links both ways.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const PARTY = "Aawak UI PARTY";
const SISTER = "Aawak UI SISTER";
const LORRY = "UI LORRY";

async function call(path, method = "GET", body) {
  const response = await fetch(BASE + path, {
    method, headers: { "X-MPH-Request": "1", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  assert.ok(response.ok, `${method} ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function seed() {
  await call("/api/masters/group", "POST", { name: "Aawak UI GROUP F", active: true });
  await call("/api/masters/finish", "POST", { name: "Aawak UI FINISH", active: true, group: "Aawak UI GROUP F", color: "black" });
  await call("/api/masters/style", "POST", {
    name: "Aawak UI STYLE", gpnColumn: "gatePass", dnColumn: "designNo", lotColumn: "lotNo", lines: "onePerEntry", order: "inward", combineSmallEntries: false,
  });
  for (const name of [PARTY, SISTER]) {
    await call("/api/masters/party", "POST", { name, active: true, discount: 0, billingStyle: "Aawak UI STYLE", color: "black", sisterGroup: "Aawak UI FAMILY" });
  }
  await call("/api/masters/transporter", "POST", { name: LORRY, active: true, otherSpellings: [], ownVehicle: false });
  const entry = (inwardNo, party, than) => call("/api/entries", "POST", {
    registerMonth: "2026-11", inwardNo, entryDate: "2026-11-05", party, than, finish: "Aawak UI FINISH", dispatches: [],
  });
  await entry(501, PARTY, 10);
  await entry(502, SISTER, 20);
  await entry(503, PARTY, 7);
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

    // New Aawak: the next number is offered and the slips show while typing.
    await page.locator('[data-view="aawak"]').click();
    await page.locator("#aawak-new.active").waitFor();
    await page.waitForFunction(() => document.getElementById("arrivalNo").value === "1");
    await page.locator("#arrivalDate").fill("2026-11-05");
    await page.locator("#arrivalParty").fill(PARTY);
    await page.locator("#arrivalParty").press("Enter");
    assert.equal(await page.locator("#arrivalGroup").textContent(), "Aawak UI FAMILY");
    await page.locator("#arrivalNag").fill("30");
    await page.locator("#arrivalTransporter").fill(LORRY);
    await page.locator("#arrivalInward").fill("501-502");
    await page.locator("#arrivalSlips .slip-check.ok").waitFor();
    assert.match(await page.locator("#arrivalSlips .slip-check").textContent(), /Slips 30 = Aawak 30/);
    await page.locator("#arrivalSave").click();
    await page.locator("#arrivalRecentTable tbody tr").first().waitFor();
    assert.equal(await page.locator("#arrivalNo").inputValue(), "2", "the next number is ready");
    assert.equal(await page.locator("#arrivalTransporter").inputValue(), LORRY, "the lorry wala stays for the next row");

    // A second row whose slip is not in the register.
    await page.locator("#arrivalParty").fill(PARTY);
    await page.locator("#arrivalNag").fill("4");
    await page.locator("#arrivalInward").fill("999");
    await page.locator("#arrivalSave").click();
    await page.waitForFunction(() => document.querySelectorAll("#arrivalRecentTable tbody tr").length === 2);

    // Aawak register: statuses, and the slip links open the inward entry.
    await page.locator('.subtabs[data-group="aawak"] [data-sub="register"]').click();
    const rows = page.locator("#aawakTable tbody tr");
    await rows.nth(1).waitFor();
    assert.equal(await rows.count(), 2);
    const headers = await page.locator("#aawakTable th").allTextContents();
    const slipsColumn = headers.indexOf("SLIPS");
    assert.ok(slipsColumn > 0);
    assert.equal(await rows.nth(0).locator(".aawak-status").textContent(), "Linked");
    assert.equal(await rows.nth(1).locator("td").nth(slipsColumn).textContent(), "No inward found");
    // Row filters: the same chips as the inward register.
    const filters = page.locator("#aawakFilters");
    assert.equal(await filters.isVisible(), false, "Aawak filters start collapsed");
    await page.locator("#aawakFiltersToggle").click();
    assert.equal(await filters.locator(".filter-chip").count(), 11);
    await filters.locator('[data-filter="notLinked"]').click();
    await page.waitForFunction(() => document.querySelectorAll("#aawakTable tbody tr").length === 1);
    assert.equal(await rows.nth(0).locator("td").nth(slipsColumn).textContent(), "No inward found");
    assert.equal(await page.locator("#aawakFiltersToggle .filter-toggle-count").textContent(), "1");
    await filters.getByRole("button", { name: "Clear filters" }).click();
    await page.waitForFunction(() => document.querySelectorAll("#aawakTable tbody tr").length === 2);
    await filters.locator('[aria-controls="aawakFilters-notLinked-menu"]').click();
    await page.locator("#aawakFilters-notLinked-menu").getByRole("menuitemradio", { name: /^Exclude/ }).click();
    await page.waitForFunction(() => document.querySelectorAll("#aawakTable tbody tr").length === 1);
    assert.equal(await rows.nth(0).locator(".aawak-status").textContent(), "Linked");
    await filters.getByRole("button", { name: "Clear filters" }).click();
    await page.waitForFunction(() => document.querySelectorAll("#aawakTable tbody tr").length === 2);
    await page.locator("#aawakFiltersToggle").click();
    await rows.nth(0).locator("td").nth(slipsColumn).locator("a", { hasText: "501" }).click();
    await page.locator("#view-entry.active").waitFor();
    assert.match(await page.locator("#formTitle").textContent(), /Correcting INW\. NO\. 501/);
    await page.locator("#entryAawak", { hasText: "Came on Aawak 1" }).waitFor();
    await page.locator("#cancelEdit").click();
    await page.locator("#view-aawak.active #aawak-register.active").waitFor();

    // Inward register: the Aawak column links back; a slip with no Aawak says so.
    await page.locator('[data-view="register"]').click();
    await page.locator("#registerSearch").fill(PARTY);
    const inward = page.locator("#registerTable tbody tr");
    await inward.nth(1).waitFor();
    const inwardHeaders = await page.locator("#registerTable th").allTextContents();
    const aawakColumn = inwardHeaders.indexOf("Aawak");
    assert.equal(inwardHeaders.at(-1), "WARNINGS");
    assert.equal(aawakColumn, inwardHeaders.length - 2);
    const cellOf = async (inwardNo) => {
      for (let i = 0; i < await inward.count(); i++) {
        if ((await inward.nth(i).locator("td").first().textContent()) === String(inwardNo)) return inward.nth(i).locator("td").nth(aawakColumn);
      }
      throw new Error(`INW. NO. ${inwardNo} not shown`);
    };
    assert.equal(await (await cellOf(503)).textContent(), "No Aawak found");
    await (await cellOf(501)).locator("a.aawak-link").click();
    await page.locator("#arrivalDrawer[open]").waitFor();
    assert.match(await page.locator("#arrivalEditor h2").textContent(), /Aawak 1/);
    await page.locator("#view-aawak.active").waitFor();
    await page.keyboard.press("Escape");
    await page.locator("#view-register.active").waitFor();

    // The No Aawak filter.
    await page.locator("#registerFiltersToggle").click();
    await page.locator('#registerFilters [data-filter="aawakNone"]').click();
    assert.equal(await inward.count(), 1);
    await page.locator("#registerFilters .filter-clear").click();

    // Marking a slip as not needing an arrival doesn't change the register's "No Aawak found" wording.
    await page.locator('[data-view="aawak"]').click();
    await page.locator('.subtabs[data-group="aawak"] [data-sub="check"]').click();
    const notNeeded = page.getByRole("button", { name: "No Aawak needed" });
    await notNeeded.waitFor();
    await notNeeded.click();
    await notNeeded.waitFor({ state: "detached" });
    await page.locator('[data-view="register"]').click();
    await page.locator("#registerSearch").fill(PARTY);
    await inward.nth(1).waitFor();
    assert.equal(await (await cellOf(503)).textContent(), "No Aawak found");

    // Totals for the month.
    await page.locator('[data-view="aawak"]').click();
    await page.locator('.subtabs[data-group="aawak"] [data-sub="totals"]').click();
    await page.locator("#totalsResult .totals-table").first().waitFor();
    const groupLine = await page.locator("#totalsResult .totals-table").first().locator("tbody td").first().textContent();
    assert.match(groupLine, /Aawak UI FAMILY/);
    assert.equal(await page.locator("#totalsResult .totals-table").nth(1).locator("tfoot th").last().textContent(), "34");

    // Masters → Lorry walas.
    await page.locator('[data-view="masters"]').click();
    await page.locator('.subtabs[data-group="masters"] [data-sub="lorry"]').click();
    await page.locator("#lorryTable tbody tr").first().waitFor();
    assert.equal(await page.locator("#lorryTable tbody tr td").first().textContent(), LORRY);
    assert.equal(await page.locator("#lorryTable tbody tr td").nth(4).textContent(), "2");

    assert.deepEqual(errors, []);
    console.log("Aawak screens: typing, slip links both ways, No Aawak / No inward found, totals and lorry walas passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
