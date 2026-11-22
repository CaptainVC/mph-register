const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const PARTY = "WARNINGS TEST PARTY";
const warning = "This is a deliberately long warning that wraps across multiple lines in the register and party-wise tables and should expand fully when clicked.";
const entry = {
  id: 1, inwardNo: 901, party: PARTY, finish: "WARNINGS TEST FINISH", status: "pending",
  than: 10, nettThan: 10, nag: 10, registerMonth: "2026-11", entryDate: "2026-11-02",
  designNo: "WARNINGS", lotNo: "W1", repair: false, tp: 0, twoPart: 0, shortThan: null,
  carriedOver: false, dispatched: 0, balance: 10, dispatches: [], warnings: [warning], billedIn: "",
};

async function checkExpandableCell(cell) {
  const text = cell.locator(".warning-text");
  assert.equal(await cell.evaluate((element) => element.getBoundingClientRect().width), 190);
  assert.equal(await text.evaluate((element) => getComputedStyle(element).webkitLineClamp), "2");
  assert.equal(await cell.getAttribute("title"), warning);
  const previewHeight = await text.evaluate((element) => element.getBoundingClientRect().height);
  await cell.click();
  assert.equal(await cell.evaluate((element) => element.classList.contains("expanded")), true);
  const expandedHeight = await text.evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(expandedHeight > previewHeight, "clicking the warning cell reveals its wrapped text");
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/entries**", async (route) => {
      if (new URL(route.request().url()).pathname === "/api/entries" && route.request().method() === "GET") {
        await route.fulfill({ json: [entry] });
      } else {
        await route.continue();
      }
    });
    await page.route("**/api/months", (route) => route.fulfill({ json: [{ month: "2026-11", entries: 1 }] }));
    await page.route("**/api/partywise?**", (route) => route.fulfill({ json: [entry] }));
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));

    await page.locator('[data-view="register"]').click();
    const registerWarning = page.locator("#registerTable tr[data-entry-id] .warning-cell");
    await registerWarning.waitFor();
    await checkExpandableCell(registerWarning);

    await page.locator('[data-view="partywise"]').click();
    await page.locator("#partyTable .party-name").click();
    const partyWarning = page.locator("#partyTable tr[data-entry-id] .warning-cell");
    await partyWarning.waitFor();
    await checkExpandableCell(partyWarning);
    assert.deepEqual(errors, [], "no browser script errors");
    console.log("PASS: Warnings cells wrap to a fixed-width preview and expand on click in Register and Party-wise.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
