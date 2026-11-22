// Read-only regression checks (nothing is saved); no imported workbook or seeded database is required.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const { chooseDropdown, dropdownOption, dropdownValue } = require("./dropdown-helpers");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
    await page.waitForFunction(() => document.activeElement.id === "party");

    // R in LOT N. or D.N. marks a repair, which is not charged: leaving the box sets REP. to Yes once.
    const leave = async (id, text) => {
      await page.fill(`#${id}`, text);
      await page.locator(`#${id}`).press("Tab");
    };
    const rep = () => dropdownValue(page.locator("#repair"));
    await page.fill("#than", "6");
    await leave("lotNo", "RAJWADI");
    assert.equal(await rep(), "No", "a lot name starting with R is charged");
    await leave("lotNo", "R mix");
    assert.equal(await rep(), "No", "R mix is a lot name, not the repair mark");
    await leave("lotNo", "R,118");
    assert.equal(await rep(), "Yes", "R in LOT N. sets REP. Yes");
    assert.equal(await page.locator("#nett").textContent(), "0", "a repair has NETT THAN 0");
    await chooseDropdown(page.locator("#repair"), "No");
    await leave("lotNo", "R 146");
    assert.equal(await rep(), "No", "REP. set back to No stays No while the mark stays");
    await leave("lotNo", "543");
    await leave("designNo", "R  12980");
    assert.equal(await rep(), "Yes", "R in D.N. sets REP. Yes");
    await page.evaluate(() => resetForm());
    // Ctrl+S straight from LOT N. (before its change event) still saves it as a repair; the blank PARTY stops the save.
    await page.fill("#than", "6");
    await page.fill("#lotNo", "R");
    await page.locator("#lotNo").press("Control+s");
    await page.waitForFunction(() => document.getElementById("formMessage").textContent !== "");
    assert.equal(await rep(), "Yes", "Ctrl+S from LOT N. marks the repair before saving");
    await page.evaluate(() => resetForm());
    // Exercise the same shared selectors used by dynamically created Masters and bill editors.
    await page.evaluate(() => {
      const fixture = document.createElement("section");
      fixture.id = "control-fixture";
      const dropdown = dropdownOf([["First", "A long dropdown label"], ["Disabled", "Disabled", true], ["Second", "Second"]], "First", { id: "test-normal" });
      fixture.append(dropdown);
      document.querySelector("main").prepend(fixture);
    });

    let checked = 0;
    for (const width of [390, 1366, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) {
        const controls = await page.locator("[data-dropdown], [data-suggestions]").evaluateAll((elements, value) => {
          document.documentElement.dataset.theme = value;
          return elements.map((element) => {
            const style = getComputedStyle(element);
            return {
              id: element.id, image: style.backgroundImage,
              position: style.backgroundPosition, size: style.backgroundSize,
              repeat: style.backgroundRepeat, padding: parseFloat(style.paddingRight),
            };
          });
        }, theme);
        for (const control of controls) {
          assert.ok(control.image.includes(theme === "dark" ? "8995a3" : "66727f"), `${control.id}: arrow at ${width}px in ${theme}: ${control.image}`);
          const inset = /^calc\(100% - (\d+)px\) 50%$/.exec(control.position);
          assert.ok(inset, `${control.id}: inset and centered (${control.position})`);
          assert.equal(control.size, "16px 16px");
          assert.equal(control.repeat, "no-repeat");
          // Compact drop-downs may inset the arrow less, but the text must still stop before the arrow starts.
          assert.ok(Number(inset[1]) >= 4, `${control.id}: arrow inset from the edge`);
          assert.ok(control.padding >= Number(inset[1]) + 16 + 1, `${control.id}: text cannot overlap arrow`);
          checked++;
        }
        const swatches = await page.locator("#registerFilters .swatch, #partyFilters .swatch").evaluateAll((elements) =>
          elements.map((element) => {
            const chip = element.closest(".filter-split");
            const mode = chip.dataset.mode;
            const style = getComputedStyle(element);
            const normal = { background: style.backgroundColor, shadow: style.boxShadow };
            chip.dataset.mode = "include";
            const selected = { background: style.backgroundColor, shadow: style.boxShadow };
            chip.dataset.mode = mode;
            return { key: element.classList[1], normal, selected };
          }));
        const palette = theme === "dark" ? {
          pending: "rgb(183, 148, 246)", partial: "rgb(56, 200, 232)", over: "rgb(255, 212, 59)",
          carried: "rgb(163, 214, 92)", warning: "rgb(244, 112, 103)", done: "rgb(34, 39, 46)", allZero: "rgb(125, 135, 146)",
        } : {
          pending: "rgb(155, 110, 232)", partial: "rgb(22, 166, 199)", over: "rgb(238, 188, 22)",
          carried: "rgb(131, 187, 53)", warning: "rgb(180, 35, 24)", done: "rgb(255, 255, 255)", allZero: "rgb(167, 175, 184)",
        };
        assert.equal(swatches.length, 14, "Register and Party-wise both have all seven swatches");
        for (const swatch of swatches) {
          assert.equal(swatch.normal.background, palette[swatch.key], `${theme} ${swatch.key}: full color fill`);
          assert.equal(swatch.normal.shadow, "none", `${swatch.key}: no stripe-only fill`);
          assert.equal(swatch.selected.background, palette[swatch.key], `${swatch.key}: selected fill retained`);
          assert.ok(swatch.selected.shadow !== "none" && !swatch.selected.shadow.includes("inset"),
            `${swatch.key}: selected outline retained without a warning stripe`);
          checked++;
        }
      }
    }
    assert.equal(await page.locator("select, datalist, input[list]").count(), 0, "only app-owned dropdowns are present");
    const control = page.locator("#test-normal");
    await control.scrollIntoViewIfNeeded();
    await control.press("Space");
    assert.equal(await control.getAttribute("aria-expanded"), "true");
    assert.equal(await (await dropdownOption(control, "Disabled")).isDisabled(), true);
    await control.press("ArrowDown");
    assert.equal(await control.getAttribute("aria-activedescendant"), await (await dropdownOption(control, "Second")).getAttribute("id"));
    await control.press("Escape");
    assert.equal(await control.getAttribute("aria-expanded"), "false");
    assert.equal(await dropdownValue(control), "First", "escape does not commit a highlighted option");
    await control.press("ArrowDown");
    await control.press("s");
    await control.press("Enter");
    assert.equal(await dropdownValue(control), "Second", "keyboard typeahead selects an option");
    await control.click();
    await page.locator("#formTitle").click();
    assert.equal(await control.getAttribute("aria-expanded"), "false", "outside click dismisses the list");
    await page.emulateMedia({ forcedColors: "active" });
    const accessible = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor };
    });
    assert.notEqual(accessible.color, accessible.background, "high contrast keeps the label legible");
    console.log(`Passed REP. repair-mark checks and ${checked} dropdown and status-swatch layout checks, keyboard, and high-contrast checks.`);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
