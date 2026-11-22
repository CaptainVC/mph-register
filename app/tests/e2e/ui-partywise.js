// Read-only collapse regressions against the real screen with deterministic API responses.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const { chooseDropdown } = require("./dropdown-helpers");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const entries = [
  [1, "ABC", "S2G", "pending", 5],
  [2, "ASHLEY PRINTS", "", "done", 3],
  [3, "ASHLEY PRINTS", "S2G", "pending", 10],
  [4, "ASHLEY PRINTS", "S2G", "done", 6],
  [5, "ASHLEY PRINTS", "SGZ", "pending", 8],
].map(([id, party, finish, status, than]) => ({
  id, inwardNo: id, party, finish, status, than, nettThan: than, nag: than,
  registerMonth: "2026-10", entryDate: "2026-10-15", designNo: "", lotNo: "",
  repair: false, tp: 0, twoPart: 0, shortThan: null, carriedOver: false,
  dispatched: status === "done" ? than : 0, balance: status === "done" ? 0 : than,
  dispatches: [], warnings: [], billedIn: "",
}));

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    const writes = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.url().startsWith(`${BASE}/api/`) && request.method() !== "GET") writes.push(request.url());
    });
    await page.route("**/api/partywise?**", (route) => route.fulfill({ json: entries }));
    await page.route("**/api/months", (route) => route.fulfill({ json: [
      { month: "2026-10", entries: entries.length },
      { month: "2026-11", entries: entries.length },
    ] }));
    await page.goto(BASE);
    await page.waitForFunction(() => document.activeElement.id === "party");
    await page.locator('[data-view="partywise"]').click();
    const partyRows = page.locator("#partyTable tr.group");
    const finishRows = page.locator("#partyTable tr.subgroup");
    const entryRows = page.locator("#partyTable tbody tr:not(.group):not(.subgroup)");
    const ashley = partyRows.filter({ has: page.getByText("ASHLEY PRINTS", { exact: true }) });
    const abc = partyRows.filter({ has: page.getByText("ABC", { exact: true }) });
    const ashleyS2G = finishRows.filter({ has: page.getByText("S2G", { exact: true }) }).nth(1);
    const sgz = finishRows.filter({ has: page.getByText("SGZ", { exact: true }) });
    const blank = finishRows.filter({ has: page.getByText("(no finish)", { exact: true }) });
    const visible = (rows) => rows.filter({ visible: true }).count();
    await partyRows.first().waitFor();
    assert.equal(await partyRows.count(), 2);
    assert.equal(await visible(partyRows), 2, "all party summaries remain visible");
    assert.equal(await visible(finishRows), 0, "parties start collapsed");
    assert.equal(await visible(entryRows), 0, "collapsed parties hide their entries");
    assert.deepEqual(await partyRows.locator("button").evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-expanded"))), ["false", "false"]);
    assert.deepEqual(await finishRows.locator("button").evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-expanded"))), ["true", "true", "true", "true"],
    "finishes start expanded, including a blank finish");
    const totals = await page.locator("#partyTotals").textContent();
    const summary = await ashley.textContent();
    assert.equal(await page.locator("#partyCount").textContent(), "5 entries");
    assert.equal(await ashley.locator(".group-count").textContent(), "4 entries");
    assert.deepEqual(await ashley.locator(".group-stat-value").allTextContents(), ["27", "27", "27", "9", "18"]);

    await ashley.locator(".party-name").click();
    assert.equal(await ashley.locator("button").getAttribute("aria-expanded"), "true");
    assert.equal(await visible(finishRows), 3);
    assert.equal(await visible(entryRows), 4, "opening Ashley reveals all its finishes and entries");
    assert.equal(await abc.locator("button").getAttribute("aria-expanded"), "false");
    await ashleyS2G.locator(".finish-name").click();
    assert.equal(await ashleyS2G.locator("button").getAttribute("aria-expanded"), "false");
    assert.equal(await visible(entryRows), 2, "only this finish's entries collapse");
    assert.equal(await sgz.locator("button").getAttribute("aria-expanded"), "true");
    await abc.locator("button").click();
    assert.equal(await visible(entryRows), 3, "same finish under another party is independent");
    await ashley.locator(".group-stat-value").first().click();
    assert.equal(await visible(finishRows), 1, "clicking anywhere on the party bar collapses it");
    assert.equal(await visible(entryRows), 1);
    await ashley.locator("button").focus();
    await page.keyboard.press("Enter");
    assert.equal(await visible(entryRows), 3, "party reopening remembers the collapsed finish");
    assert.equal(await ashleyS2G.locator("button").getAttribute("aria-expanded"), "false");
    assert.equal(await ashley.locator("button").evaluate((button) => button === document.activeElement), true);
    await ashleyS2G.locator("button").focus();
    await page.keyboard.press("Space");
    assert.equal(await visible(entryRows), 5, "Space expands the finish");
    assert.equal(await ashleyS2G.locator("button").evaluate((button) => button === document.activeElement), true);
    await ashleyS2G.locator("button").click();
    await page.locator("#collapseAllParties").click();
    assert.equal(await visible(entryRows), 0, "Collapse all closes every party");
    assert.equal(await visible(finishRows), 0);
    assert.deepEqual(await partyRows.locator("button").evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-expanded"))), ["false", "false"]);
    await page.locator("#expandAllParties").click();
    assert.equal(await visible(finishRows), 4, "Expand all opens every party");
    assert.equal(await visible(entryRows), 5, "Expand all also reopens collapsed finishes");
    assert.deepEqual(await partyRows.locator("button").evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-expanded"))), ["true", "true"]);
    assert.equal(await page.locator("#partyTotals").textContent(), totals, "expand and collapse all never change totals");
    await blank.locator("button").click();
    assert.equal(await visible(entryRows), 4, "blank finishes also toggle");
    assert.equal(await page.locator("#partyTotals").textContent(), totals, "collapse never changes totals");
    assert.equal(await ashley.textContent(), summary, "collapse never changes summary values");

    await ashleyS2G.locator("button").click();
    await page.locator("#partyFiltersToggle").click();
    await page.locator('#partyFilters [data-filter="pending"]').click();
    await page.waitForFunction(() => document.getElementById("partyCount").textContent === "3 of 5 entries");
    assert.equal(await ashley.locator("button").getAttribute("aria-expanded"), "true");
    assert.equal(await ashleyS2G.locator("button").getAttribute("aria-expanded"), "false");
    assert.equal(await visible(entryRows), 2, "filter rerender preserves independent states");
    await page.locator('#partyFilters [data-filter="done"]').click();
    assert.equal(await visible(entryRows), 2, "multiple dispatch filters still work");
    await page.locator('#partyFilters [data-filter="pending"]').click();
    await page.waitForFunction(() => document.getElementById("partyCount").textContent === "2 of 5 entries");
    assert.equal(await visible(entryRows), 0);
    assert.equal(await page.locator("#partyTable").locator("..").locator(".table-empty").count(), 0,
      "collapsed entries are not reported as an empty result");
    await page.locator('#partyFilters [data-filter="done"]').click();
    await page.waitForFunction(() => document.getElementById("partyCount").textContent === "5 entries");
    await page.locator('[data-view="register"]').click();
    await page.locator('[data-view="partywise"]').click();
    await partyRows.first().waitFor();
    assert.equal(await ashleyS2G.locator("button").getAttribute("aria-expanded"), "false", "tab changes retain state");
    const monthResponse = page.waitForResponse((response) => response.url().includes("/api/partywise?month=2026-10"));
    await chooseDropdown(page.locator("#partyViewMonth"), "2026-10");
    await monthResponse;
    assert.equal(await ashleyS2G.locator("button").getAttribute("aria-expanded"), "false", "month changes retain state");
    await sgz.locator("button").focus();
    await page.keyboard.press("ArrowRight");
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      assert.equal(await sgz.locator("button").evaluate((button) => getComputedStyle(button).outlineStyle), "solid");
    }
    await sgz.locator("button").click();
    await sgz.locator("button").click();
    await entryRows.filter({ visible: true }).last().locator("td.inward").click();
    assert.match(await page.locator("#formTitle").textContent(), /Correcting INW\. NO\. 5/);
    await page.keyboard.press("Escape");
    await page.reload();
    await page.waitForFunction(() => document.activeElement.id === "party");
    await page.locator('[data-view="partywise"]').click();
    await partyRows.first().waitFor();
    assert.equal(await visible(entryRows), 0, "a new page starts with all parties collapsed again");

    // An all-zero slip (sorted last by the server) closes its party in an "All zero" group, not "(no finish)".
    const slip = { ...entries[1], id: 6, inwardNo: 6, status: "allZero", than: 0, nettThan: 0, nag: 0, dispatched: 0, balance: 0, designNo: "INW 547" };
    await page.unroute("**/api/partywise?**");
    await page.route("**/api/partywise?**", (route) => route.fulfill({ json: [...entries, slip] }));
    await chooseDropdown(page.locator("#partyViewMonth"), "2026-11");
    await page.waitForFunction(() => document.getElementById("partyCount").textContent === "6 entries");
    const groupsOfAshley = await finishRows.evaluateAll((rows) => rows.map((row) =>
      `${row.querySelector(".group-kicker").textContent}:${row.querySelector(".group-name").textContent}`));
    assert.deepEqual(groupsOfAshley, ["Finish:S2G", "Finish:(no finish)", "Finish:S2G", "Finish:SGZ", "Slips:All zero"]);
    assert.equal(await page.locator('#partyFilters [data-filter="allZero"] .chip-count').textContent(), "1");
    assert.deepEqual(errors, [], "no browser script errors");
    assert.deepEqual(writes, [], "collapse and edit-navigation tests never write data");
    console.log("Passed Party-wise collapse defaults, independent toggles, blank finishes, totals, filters, keyboard, focus, tab/month state, editing, and reload checks.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
