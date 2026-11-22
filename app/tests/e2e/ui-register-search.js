// Register search: typing offers the 5 closest values from the entries in view; picking one searches only its column.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const rows = [
  [1, "MAROON FAB TEX", "D-1", "264,265", "FIN-A", "7653"],
  [2, "MAROON FAB TEX", "D-2", "268", "FIN-A", "7654"],
  [3, "MAROON FAB TEX", "D-3", "272", "FIN-B", ""],
  [4, "MAPLE TRADERS", "LOOSE", "11", "FIN-A", ""],
  [5, "MANGO SILK", "LOOSE", "12", "FIN-C", ""],
  [6, "MARBLE MILLS", "", "13", "FIN-A", ""],
  [7, "MAGNET TEX", "", "14", "FIN-A", ""],
  [8, "MATCHBOX PRINTS", "", "15", "FIN-A", ""],
  [264, "ZEBRA TEXTILE", "", "2640", "FIN-A", "2641"],
];
const entries = rows.map(([inwardNo, party, designNo, lotNo, finish, gatePass]) => ({
  id: inwardNo, inwardNo, party, designNo, lotNo, finish, registerMonth: "2026-10", entryDate: "2026-10-15",
  status: "pending", repair: false, billedIn: "", than: 10, nettThan: 10, nag: 10, tp: 0, twoPart: 0, balance: 10,
  dispatched: 0, dispatches: gatePass ? [{ qty: 1, gatePass, date: "2026-10-16", dateText: null }] : [],
  warnings: [], carriedOver: false,
}));

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/\/api\/(?:entries|partywise)(?:\?|$)/, (route) => route.fulfill({ json: entries }));
    await page.route("**/api/months", (route) => route.fulfill({ json: [{ month: "2026-10", entries: entries.length }] }));
    await page.goto(BASE);
    await page.waitForFunction(() => document.activeElement.id === "party");
    await page.locator('[data-view="register"]').click();
    await page.waitForFunction((n) => document.querySelectorAll("#registerTable tbody tr").length === n, entries.length);

    const search = page.locator("#registerSearch");
    const list = page.locator(".combo-list:popover-open");
    const options = () => list.locator('[role="option"]').evaluateAll((items) =>
      items.map((li) => [li.firstChild.textContent, li.querySelector(".hint").textContent]));
    const count = () => page.locator("#registerCount").textContent();

    await search.click();
    assert.equal(await list.count(), 0, "an empty search offers nothing");

    await search.fill("ma");
    const many = await options();
    assert.equal(many.length, 5, "never more than 5 suggestions");
    assert.deepEqual(many[0], ["MAROON FAB TEX", "PARTY · 3 entries"], "the most used match comes first");
    assert.equal(await search.getAttribute("aria-activedescendant"), null, "nothing is chosen until arrowed to");
    assert.equal(await count(), "8 of 9 entries", "the table still filters while typing");

    await search.fill("mroon fab");
    assert.deepEqual((await options())[0], ["MAROON FAB TEX", "PARTY · 3 entries"], "a typo still finds the closest party");
    await search.fill("mft");
    assert.deepEqual((await options())[0], ["MAROON FAB TEX", "PARTY · 3 entries"], "initials find a party");
    await search.fill("7653");
    assert.deepEqual(await options(), [["7653", "GATE PASS · 1 entry"]], "numbers are not typo-matched");
    await search.fill("qqqq");
    assert.equal(await list.count(), 0, "no list when nothing is close");
    assert.equal(await count(), "0 of 9 entries");

    await search.fill("264");
    assert.deepEqual(await options(), [
      ["264", "LOT N. · 1 entry"], ["264", "INW. NO. · 1 entry"], ["2640", "LOT N. · 1 entry"], ["2641", "GATE PASS · 1 entry"],
    ], "lot numbers are suggested one by one, exact matches first");
    assert.equal(await count(), "2 of 9 entries", "plain text matches every column");
    await search.press("ArrowDown");
    await search.press("Enter");
    assert.equal(await list.count(), 0, "picking closes the list");
    assert.equal(await search.inputValue(), "264");
    await page.waitForFunction(() => document.getElementById("registerCount").textContent === "1 of 9 entries");
    assert.equal(await page.locator("#registerTable tbody td:first-child").textContent(), "1", "a picked lot searches only LOT N.");
    await search.press("Backspace");
    await search.pressSequentially("4");
    await page.waitForFunction(() => document.getElementById("registerCount").textContent === "2 of 9 entries");

    await search.fill("maro");
    await search.press("Enter");
    assert.equal(await list.count(), 0, "Enter puts the list away");
    assert.equal(await search.inputValue(), "maro", "Enter keeps what was typed");
    await search.press("ArrowDown");
    assert.equal(await list.count(), 1, "ArrowDown brings the list back");
    await search.press("Escape");
    assert.equal(await list.count(), 0, "Escape closes the list");
    assert.equal(await search.inputValue(), "maro", "Escape with the list open keeps the text");

    await search.fill("mapl");
    await list.locator('[role="option"]').first().click();
    assert.equal(await search.inputValue(), "MAPLE TRADERS");
    await page.waitForFunction(() => document.getElementById("registerCount").textContent === "1 of 9 entries");

    await page.locator("#clearRegisterSearch").click();
    await page.waitForFunction(() => document.getElementById("registerCount").textContent === "9 of 9 entries");
    assert.deepEqual(errors, []);
    console.log("ui-register-search: ok");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
