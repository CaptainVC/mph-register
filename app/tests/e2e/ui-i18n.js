// Read-only browser checks: locale changes here do not modify server settings or real data.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const { dropdownOption, dropdownValue } = require("./dropdown-helpers");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(BASE);
    await page.waitForSelector("#party");
    await page.waitForFunction(() => document.activeElement.id === "party");
    assert.equal(await page.locator("#langHi").textContent(), "हिन्दी (Hinglish)");
    await page.evaluate(() => window.applyLanguage("hi"));
    assert.equal(await page.locator("#saveButton").textContent(), "Entry Save करें (Enter)");
    assert.equal(await page.locator("#party").getAttribute("placeholder"), "पार्टी Search करने के लिए लिखें");
    assert.equal(await page.locator('[data-view="entry"]').textContent(), "नई Entry");
    assert.equal(await page.locator("#langHi").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("html").getAttribute("lang"), "hi");
    assert.equal(await page.locator("#menuToggle span").last().textContent(), "मेन्यू");
    assert.equal(await page.locator("#menuToggle").getAttribute("title"), "मेन्यू खोलें");
    assert.equal(await page.locator("#sideMenuTitle").textContent(), "मेन्यू");

    await page.evaluate(() => {
      const fixture = document.createElement("section");
      fixture.id = "i18n-fixture";
      fixture.innerHTML = `
        <button id="i18n-action" title="Save changes" aria-label="Save">Save changes</button>
        <input id="i18n-value" value="Save प्रविष्टियाँ दर" placeholder="Type to search finish">
        <div class="sheet" id="i18n-sheet"><h2>Save changes</h2><span>New Entry</span></div>
        <span class="config-path" id="i18n-path">/tmp/Save दर/mph-config.json</span>
        <span class="party-name" id="i18n-party">Save प्रविष्टियाँ दर</span>
        <span class="finish-name" id="i18n-finish">पंक्ति शैली Save</span>
        <span class="style-box" id="i18n-style">G.P.N.=gate pass · same lot on one line · small entries apart</span>
        <table class="register"><tbody>
          <tr class="group"><td><div class="group-bar"><div class="group-identity">
            <span class="group-name party-name">Save दर</span><span class="group-count" id="i18n-group-count">2 entries</span>
          </div><div class="group-stats"><span class="group-stat-label" id="i18n-balance-label">BALANCE</span>
            <b class="group-stat-value">30</b></div></div></td></tr>
          <tr class="subgroup"><td><span class="group-count" id="i18n-single-count">1 entry</span></td></tr>
          <tr><td class="party-name">New Entry</td><td id="i18n-status">Saved</td></tr>
        </tbody></table>
        <div class="combo-list"><li id="i18n-combo">Save changes</li></div>
        <div class="report"><table><tbody><tr><td id="i18n-month">Nov 2026</td></tr></tbody></table></div>
        <table class="register"><tbody><tr><td id="i18n-date">21/Nov/26</td></tr></tbody></table>`;
      // Drop-downs are the app's own controls: a data list (billing styles) and a month list keep their text.
      fixture.querySelector(".report").before(
        dropdownOf([["style", "प्रविष्टियाँ दर"]], "style", { id: "pf-style" }),
        dropdownOf([["2026-11", "Nov 2026 (1,200)"]], "2026-11", { id: "i18n-month-select" }));
      document.querySelector("main").append(fixture);
    });
    await page.waitForFunction(() => document.getElementById("i18n-action").textContent === "बदलाव Save करें");
    assert.equal(await page.locator("#i18n-action").getAttribute("title"), "बदलाव Save करें");
    assert.equal(await page.locator("#i18n-action").getAttribute("aria-label"), "Save करें");
    assert.equal(await page.locator("#i18n-value").inputValue(), "Save प्रविष्टियाँ दर");
    assert.equal(await page.locator("#i18n-value").getAttribute("placeholder"), "फ़िनिश Search करने के लिए लिखें");
    assert.equal(await page.locator("#i18n-status").textContent(), "Save हो गया");
    assert.equal(await page.locator("#i18n-group-count").textContent(), "2 Entries");
    assert.equal(await page.locator("#i18n-single-count").textContent(), "1 Entry");
    assert.equal(await page.locator("#i18n-balance-label").textContent(), "Balance");
    assert.equal(await page.locator("#i18n-style").textContent(),
      "G.P.N.=गेट पास · एक ही लॉट एक Line में · छोटी Entries अलग");
    assert.equal(await page.locator("#i18n-month").textContent(), "Nov 2026");
    assert.equal(await page.locator("#i18n-month-select .dropdown-value").textContent(), "Nov 2026 (1,200)");
    assert.equal(await (await dropdownOption(page.locator("#pf-style"), "style")).textContent(), "प्रविष्टियाँ दर",
      "an open data list keeps its names");
    await page.locator("#pf-style").press("Escape");
    assert.equal(await page.locator("#i18n-date").textContent(), "21/Nov/26");
    const dashboardMonths = await page.evaluate(() => {
      const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
      return months.map((month) => [longMonth(month), monthOnly(month), shortMonth(month), niceDate(`${month}-21`)]);
    });
    const shortNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const longNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    assert.deepEqual(dashboardMonths, shortNames.map((month, i) =>
      [`${longNames[i]} 2026`, longNames[i], month, `21 ${month} 2026`]));

    const unchanged = {
      "#i18n-sheet": "Save changesNew Entry",
      "#i18n-path": "/tmp/Save दर/mph-config.json",
      "#i18n-party": "Save प्रविष्टियाँ दर",
      "#i18n-finish": "पंक्ति शैली Save",
      "#i18n-combo": "Save changes",
      "#pf-style .dropdown-value": "प्रविष्टियाँ दर",
      "#i18n-fixture td.party-name": "New Entry",
      "#i18n-fixture .group-name": "Save दर",
      "#i18n-month": "Nov 2026",
      "#i18n-month-select .dropdown-value": "Nov 2026 (1,200)",
      "#i18n-date": "21/Nov/26",
    };
    for (const [selector, text] of Object.entries(unchanged)) {
      assert.equal(await page.locator(selector).textContent(), text, selector);
    }
    await page.evaluate(() => {
      document.getElementById("i18n-action").textContent = "Cancel";
      document.getElementById("i18n-action").title = "Delete rate";
    });
    await page.waitForFunction(() => document.getElementById("i18n-action").textContent === "Cancel करें");
    assert.equal(await page.locator("#i18n-action").getAttribute("title"), "Rate Delete करें");
    await page.evaluate(() => window.applyLanguage("hi"));
    assert.equal(await page.locator("#i18n-action").textContent(), "Cancel करें");

    await page.locator('[data-view="masters"]').click();
    await page.locator("#menuToggle").click();
    await page.locator("#menuSettings").click();
    const language = page.locator("#display-language");
    await language.waitFor();
    assert.equal(await (await dropdownOption(language, "hi")).textContent(), "हिन्दी (Hinglish)");
    await language.press("Escape");
    await page.evaluate(() => window.applyLanguage("hi"));
    assert.equal(await dropdownValue(language), "hi");
    await page.evaluate(() => window.applyLanguage("en"));
    assert.equal(await page.locator("#saveButton").textContent(), "Save entry (Enter)");
    assert.equal(await page.locator("#party").getAttribute("placeholder"), "Type to search party");
    assert.equal(await page.locator("#i18n-action").textContent(), "Cancel");
    assert.equal(await page.locator("#i18n-action").getAttribute("title"), "Delete rate");
    assert.equal(await page.locator("#i18n-action").getAttribute("aria-label"), "Save");
    assert.equal(await page.locator("#i18n-status").textContent(), "Saved");
    assert.equal(await dropdownValue(language), "en");
    assert.equal(await page.locator("#sideMenuTitle").textContent(), "Menu");
    assert.equal(await page.locator("#menuToggle").getAttribute("title"), "Open menu");
    for (const [selector, text] of Object.entries(unchanged)) {
      assert.equal(await page.locator(selector).textContent(), text, selector);
    }
    await page.evaluate(() => window.applyLanguage("hi"));
    await page.goto(`${BASE}/print.html`);
    await page.reload();
    await page.waitForFunction(() => typeof window.getLanguage === "function" && window.getLanguage() === "hi");
    assert.equal(await page.locator("html").getAttribute("lang"), "hi");
    assert.equal(await page.evaluate(() => localStorage.getItem("mph-lang")), "hi");
    assert.deepEqual(errors, []);
    console.log("Passed Hinglish UI, dynamic text, attributes, settings, data/print protection, reload and English round-trip checks.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
