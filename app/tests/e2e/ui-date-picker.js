// The app's own calendar for date and month boxes (datepicker.js). Read-only: nothing is saved.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
    await page.evaluate(() => localStorage.clear());

    const date = page.locator("#entryDate");
    const popup = page.locator(".picker:popover-open");
    const valueOf = (box) => box.evaluate((input) => input.value);
    const shown = () => date.evaluate((input) => input.dataset.picker + "|" + input.type);
    assert.equal(await shown(), "date|text", "the browser's own calendar is replaced");
    assert.match(await valueOf(date), /^\d{4}-\d{2}-\d{2}$/, "the value is still yyyy-mm-dd");
    assert.match(await date.evaluate((input) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").get.call(input)), /^\d{2}\/\d{2}\/\d{4}$/, "the box shows dd/mm/yyyy");

    // Clicking opens a large calendar; a day picks the date and closes it, with the usual input and change events.
    await page.evaluate(() => { window.events = []; for (const type of ["input", "change"]) $("entryDate").addEventListener(type, () => window.events.push(type)); });
    await date.evaluate((input) => { input.value = "2026-10-26"; });
    await date.click();
    await popup.waitFor();
    assert.equal(await popup.locator(".picker-jump").first().textContent(), "October");
    assert.equal(await popup.locator(".picker-day").count(), 42);
    assert.equal(await popup.locator(".picker-day.selected").textContent(), "26");
    assert.ok((await popup.locator(".picker-day").first().boundingBox()).height >= 40, "days are big enough to hit");
    assert.equal(await popup.getByRole("button", { name: "Clear" }).count(), 0, "a required box cannot be cleared");
    await popup.locator(".picker-day:not(.out)", { hasText: /^15$/ }).click();
    await popup.waitFor({ state: "detached" });
    assert.equal(await popup.count(), 0, "picking a day closes the calendar");
    assert.equal(await valueOf(date), "2026-10-15");
    assert.deepEqual(await page.evaluate(() => window.events), ["input", "change"]);

    // Month and year jumps, and the arrows.
    await date.click();
    await popup.locator(".picker-nav").last().click();
    assert.equal(await popup.locator(".picker-jump").first().textContent(), "November");
    await popup.locator(".picker-jump").first().click();
    await popup.locator(".picker-choice", { hasText: "Feb" }).click();
    assert.equal(await popup.locator(".picker-jump").first().textContent(), "February");
    await popup.locator(".picker-jump").nth(1).click();
    await popup.locator(".picker-choice", { hasText: "2027" }).click();
    await popup.locator(".picker-day:not(.out)", { hasText: /^28$/ }).click();
    assert.equal(await valueOf(date), "2027-02-28");
    await date.click();
    await popup.getByRole("button", { name: "Today" }).click();
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    assert.equal(await valueOf(date), today, "Today picks today");

    // Typing works in several ways, and text that is not a date goes back with a reason.
    for (const [typed, expected] of [["5/11/2026", "2026-11-05"], ["26102026", "2026-10-26"], ["7-3-2026", "2026-03-07"], ["4 Jan 2027", "2027-01-04"], ["2026-12-25", "2026-12-25"]]) {
      await date.fill(typed);
      assert.equal(await valueOf(date), expected, typed);
      await date.press("Tab");
      assert.equal(await valueOf(date), expected, `${typed} survives leaving the box`);
      assert.equal(await date.evaluate((input) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").get.call(input)), `${expected.slice(8)}/${expected.slice(5, 7)}/${expected.slice(0, 4)}`, `${typed} is tidied to dd/mm/yyyy`);
    }
    await date.fill("26/10/20");
    assert.equal(await valueOf(date), "", "a half-typed year is not a date yet");
    await date.fill("31/02/2026");
    assert.equal(await valueOf(date), "", "there is no 31 February");
    assert.ok(await date.evaluate((input) => !input.checkValidity()), "the browser explains it on save");
    await date.press("Tab");
    assert.equal(await valueOf(date), "2026-12-25", "text that is not a date goes back to the last date");
    await page.waitForSelector("#toasts .toast");

    // Keyboard: Down opens, arrows move the highlight, Enter picks it, Escape closes.
    await date.fill("26/10/2026");
    await date.focus();
    await date.press("ArrowDown");
    await popup.waitFor();
    await date.press("ArrowDown");
    await date.press("ArrowRight");
    await date.press("PageDown");
    await date.press("Enter");
    assert.equal(await valueOf(date), "2026-12-03", "a week down, a day right and a month on from 26 October");
    await date.press("ArrowDown");
    await popup.waitFor();
    await date.press("Escape");
    assert.equal(await popup.count(), 0);
    assert.equal(await valueOf(date), "2026-12-03");

    // A month box shows 3 × 4 months and a year; typing accepts names and numbers.
    await page.click(".tab[data-view=bills]");
    const month = page.locator("#billMonth");
    assert.equal(await month.evaluate((input) => input.dataset.picker), "month");
    await month.evaluate((input) => { input.min = "2026-04"; input.max = "2027-03"; input.value = "2026-11"; });
    assert.equal(await valueOf(month), "2026-11");
    await month.click();
    await popup.waitFor();
    assert.equal(await popup.locator(".picker-choice").count(), 12);
    assert.equal(await popup.locator(".picker-choice.selected").textContent(), "Nov");
    assert.equal(await popup.locator(".picker-choice:disabled").count(), 3, "months outside the financial year cannot be picked");
    await page.screenshot({ path: process.env.MPH_PICKER_SHOT || "/tmp/mph-picker-month.png" });
    await popup.locator(".picker-nav").last().click();
    assert.equal(await popup.locator(".picker-choice:disabled").count(), 9, "April to December 2027 are after the financial year");
    await popup.locator(".picker-choice", { hasText: "Jan" }).click();
    assert.equal(await valueOf(month), "2027-01", "January is in the next calendar year");
    for (const [typed, expected] of [["March 2027", "2027-03"], ["11/2026", "2026-11"], ["feb 2027", "2027-02"], ["2026-12", "2026-12"]]) {
      await month.fill(typed);
      assert.equal(await valueOf(month), expected, typed);
    }
    await month.press("Tab");

    // Every screen's boxes are ours, the other date boxes too, in both themes and in a narrow window.
    const left = await page.evaluate(() => [...document.querySelectorAll("input[type=date], input[type=month]")].map((input) => input.id));
    assert.deepEqual(left, [], "no browser calendars are left");
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await page.locator("#billDate").click();
      await popup.waitFor();
      const box = await popup.boundingBox();
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1366 && box.y + box.height <= 768, `the calendar fits the screen (${theme})`);
      await page.screenshot({ path: `${process.env.MPH_PICKER_SHOT_DIR || "/tmp"}/mph-picker-${theme}.png` });
      await page.locator("#billDate").press("Escape");
    }
    await page.setViewportSize({ width: 390, height: 800 });
    await page.locator("#periodFrom").click();
    await popup.waitFor();
    const narrow = await popup.boundingBox();
    assert.ok(narrow.x >= 0 && narrow.x + narrow.width <= 390, "the calendar fits a phone-wide window");
    console.log("date picker: all checks passed");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
