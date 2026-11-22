const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const entries = [
  [1, "pending", false, "", 5, true],
  [2, "pending", true, "", 7, true],
  [3, "allZero", false, "", 0, false],
  [4, "allZero", true, "", 0, false],
  [5, "done", false, "MPH/26-27/0005", 12, true],
  [6, "done", false, "", 3, false],
].map(([id, status, repair, billedIn, than, alpha]) => ({
  id, inwardNo: id, party: "FILTER TEST", finish: status === "allZero" ? "" : "S2G",
  registerMonth: "2026-10", entryDate: "2026-10-15", designNo: alpha ? "ALPHA" : "BETA", lotNo: "",
  status, repair, billedIn, than, nettThan: repair ? 0 : than, nag: than, tp: 0, twoPart: 0,
  balance: status === "pending" ? than : 0, dispatched: status === "done" ? than : 0,
  dispatches: [], warnings: [], carriedOver: false,
}));

async function expectRows(page, view, ids) {
  const selector = `#${view}Table tbody tr:not(.group):not(.subgroup) td:first-child`;
  await page.waitForFunction(({ selector, ids }) =>
    Array.from(document.querySelectorAll(selector), (td) => Number(td.textContent)).join() === ids.join(), { selector, ids });
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/\/api\/(?:entries|partywise)(?:\?|$)/, (route) => route.fulfill({ json: entries }));
    await page.route("**/api/months", (route) => route.fulfill({ json: [{ month: "2026-10", entries: 6 }] }));
    await page.goto(BASE);
    await page.waitForFunction(() => document.activeElement.id === "party");

    const filters = (view) => page.locator(`#${view}Filters`);
    const chip = (view, key) => filters(view).locator(`[data-filter="${key}"]`);
    const trigger = (view, key) => filters(view).locator(`[aria-controls="${view}Filters-${key}-menu"]`);
    const menu = (view, key) => page.locator(`#${view}Filters-${key}-menu`);
    const pick = async (view, key, mode) => {
      await trigger(view, key).click();
      await menu(view, key).getByRole("menuitemradio", { name: new RegExp(`^${mode}`) }).click();
    };
    const clear = (view) => filters(view).getByRole("button", { name: "Clear filters" }).click();
    const expectTotals = async (view, entries, than) => {
      const totals = page.locator(`#${view}Totals .stat-value`);
      assert.deepEqual((await totals.allTextContents()).slice(0, 2), [String(entries), String(than)]);
    };

    await page.locator('[data-view="register"]').click();
    await expectRows(page, "register", [1, 2, 3, 4, 5, 6]);
    const toggle = (view) => page.locator(`#${view}FiltersToggle`);
    assert.equal(await filters("register").isVisible(), false, "register filters start collapsed");
    assert.equal(await toggle("register").getAttribute("aria-expanded"), "false");
    await toggle("register").click();
    assert.equal(await filters("register").isVisible(), true);
    assert.equal(await toggle("register").getAttribute("aria-expanded"), "true");
    assert.equal(await filters("register").locator(".filter-chip").count(), 13);
    const starts = () => filters("register").locator(".filter-split").evaluateAll((chips) => chips.map((chip) => chip.getBoundingClientRect().left));
    const positions = await starts();
    const repairArrow = trigger("register", "repair");
    await repairArrow.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement.textContent.startsWith("Any"));
    assert.equal(await repairArrow.getAttribute("aria-expanded"), "true");
    assert.equal(await menu("register", "repair").locator('[aria-checked="true"] .filter-option-label').textContent(), "Any");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expectRows(page, "register", [1, 3, 5, 6]);
    assert.equal(await repairArrow.evaluate((button) => button === document.activeElement), true);
    assert.equal(await repairArrow.getAttribute("aria-expanded"), "false");

    await pick("register", "allZero", "Exclude");
    await expectRows(page, "register", [1, 5, 6]);
    await expectTotals("register", 3, 20);
    assert.equal(await page.locator("#registerCount").textContent(), "3 of 6 entries");
    assert.equal(await filters("register").locator(".filter-summary").textContent(), "Excluding: All zero, Repair");
    assert.equal(await chip("register", "repair").getAttribute("aria-label"), "Repair: Exclude");
    assert.equal(await chip("register", "repair").locator(".chip-count").textContent(), "2");
    assert.deepEqual(await starts(), positions, "exclusions should not move the chips");

    await chip("register", "pending").click();
    await expectRows(page, "register", [1]);
    await chip("register", "done").click();
    await expectRows(page, "register", [1, 5, 6]);
    await chip("register", "billBlank").click();
    await expectRows(page, "register", [1, 6]);
    await chip("register", "allZero").click();
    await expectRows(page, "register", [1, 6]);
    assert.equal(await filters("register").locator(".filter-summary").textContent(), "Excluding: Repair");

    await page.locator("#registerSearch").fill("ALPHA");
    await expectRows(page, "register", [1]);
    await clear("register");
    await expectRows(page, "register", [1, 2, 5]);
    assert.equal(await page.locator("#registerSearch").inputValue(), "ALPHA");
    await page.locator("#registerSearch").fill("");
    await expectRows(page, "register", [1, 2, 3, 4, 5, 6]);

    await chip("register", "repair").click();
    await expectRows(page, "register", [2, 4]);
    await repairArrow.press("Space");
    await page.waitForFunction(() => document.activeElement.textContent.startsWith("Include"));
    await page.keyboard.press("Escape");
    assert.equal(await repairArrow.evaluate((button) => button === document.activeElement), true);
    assert.equal(await repairArrow.getAttribute("aria-expanded"), "false");
    await pick("register", "repair", "Any");
    await expectRows(page, "register", [1, 2, 3, 4, 5, 6]);
    await pick("register", "repair", "Exclude");
    await expectRows(page, "register", [1, 3, 5, 6]);

    await page.locator('[data-view="partywise"]').click();
    await expectRows(page, "party", [1, 2, 5, 6, 3, 4]);
    assert.equal(await filters("party").isVisible(), false, "party filters start collapsed");
    assert.equal(await toggle("party").getAttribute("aria-expanded"), "false");
    await toggle("party").click();
    await pick("party", "repair", "Exclude");
    await pick("party", "allZero", "Exclude");
    await expectRows(page, "party", [1, 5, 6]);
    await expectTotals("party", 3, 20);
    assert.equal(await page.locator("#partyCount").textContent(), "3 of 6 entries");
    await clear("party");
    await expectRows(page, "party", [1, 2, 5, 6, 3, 4]);
    await page.locator('[data-view="register"]').click();
    await expectRows(page, "register", [1, 3, 5, 6]);

    assert.deepEqual(errors, []);
    console.log("PASS: reverse row filters in Register and Party-wise, keyboard, counts, totals and clear");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
