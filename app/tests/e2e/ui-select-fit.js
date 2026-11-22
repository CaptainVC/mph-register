// Run against a fresh test data directory. Drop-downs and pickers must be wide enough to show their longest text without
// cutting off the last letters (the arrow reserves space inside the control, so a narrow box leaves very little for the text).
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const PARTY = "SELECT FIT TEST";
const SISTER = "SELECT FIT SISTER";

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
  await call("/api/settings", "PUT", { billRules: { ...settings.billRules, rowsPerBill: 5, totalMustStayBelow: 100000000 } });
  await call("/api/masters/group", "POST", { name: "SELECT FIT GROUP", active: true });
  await call("/api/masters/finish", "POST", { name: "FZX", active: true, group: "SELECT FIT GROUP", color: "black" });
  await call("/api/masters/style", "POST", {
    name: "SELECT FIT STYLE", gpnColumn: "gatePass", dnColumn: "designNo", lotColumn: "lotNo",
    lines: "onePerEntry", order: "inward", combineSmallEntries: false,
  });
  for (const [name, discount] of [[PARTY, 0], [SISTER, 10]]) {
    await call("/api/masters/party", "POST", { name, active: true, discount, billingStyle: "SELECT FIT STYLE", color: "black", sisterGroup: "FIT SISTERS" });
    await call("/api/masters/party/rate", "PUT", { party: name, finish: "FZX", rate: 100 });
  }
  // Big quantities, so the subtotal row has to show a six-digit THAN total.
  for (const [i, than] of [[1, 12345], [2, 20000], [3, 99999]]) {
    await call("/api/entries", "POST", {
      registerMonth: "2026-11", inwardNo: 8600 + i, entryDate: "2026-11-02", party: PARTY,
      designNo: `D${i}`, lotNo: `L${i}`, than, finish: "FZX",
      dispatches: [{ qty: than, gatePass: `G${i}`, date: "2026-11-03" }],
    });
  }
}

// Runs in the page: lists the visible drop-downs whose longest option is wider than the room left beside the arrow,
// month pickers too narrow for the longest month name and its calendar button, bill grid cells whose number or finish
// does not fit (the THAN subtotal is bold with a thick border, so it has the least room), and column headings that end in "…".
function clippedText() {
  const ruler = document.createElement("canvas").getContext("2d");
  const clipped = new Set();
  for (const select of document.querySelectorAll("[data-dropdown]")) {
    const box = select.getBoundingClientRect();
    const style = getComputedStyle(select);
    if (!box.width || !box.height || style.visibility === "hidden") continue;
    ruler.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const room = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const text = select.textContent;
    const need = ruler.measureText(text).width;
    if (need > room + 0.5) {
      clipped.add(`${select.id ? "#" + select.id : "dropdown." + (select.className || "?")} "${text}" needs ${Math.ceil(need)}px, has ${Math.floor(room)}px`);
    }
  }
  for (const input of document.querySelectorAll("input[type=month]")) {
    const style = getComputedStyle(input);
    if (!input.offsetWidth) continue;
    ruler.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 24;
    const need = ruler.measureText("September 2026").width;
    if (need > room) clipped.add(`#${input.id} month picker needs ${Math.ceil(need)}px, has ${Math.floor(room)}px`);
  }
  for (const cell of document.querySelectorAll("table.bill-grid input.g-qty, table.bill-grid input.g-rate, table.bill-grid input.g-finish")) {
    if (cell.offsetWidth && cell.scrollWidth > cell.clientWidth) clipped.add(`bill grid ${cell.className.split(" ")[0]} "${cell.value}" is cut off`);
  }
  for (const heading of document.querySelectorAll("table.bill-grid th")) {
    if (heading.offsetWidth && heading.scrollWidth > heading.clientWidth) clipped.add(`column heading "${heading.textContent}" is cut short`);
  }
  return [...clipped];
}

(async () => {
  await seed();
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1268, height: 768 } });
    await page.clock.install({ time: new Date("2026-11-21T12:00:00") });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));

    const problems = [];
    const check = async (screen) => {
      for (const width of [1268, 1024]) {
        await page.setViewportSize({ width, height: 768 });
        await page.waitForTimeout(250);
        for (const problem of await page.evaluate(clippedText)) problems.push(`${screen} at ${width}px: ${problem}`);
      }
      await page.setViewportSize({ width: 1268, height: 768 });
    };
    const open = async (view, sub) => {
      await page.locator(`[data-view="${view}"]`).click();
      if (sub) {
        const tab = page.locator(`.subtab[data-sub="${sub}"]:visible`);
        if (!(await tab.count())) return;
        await tab.click();
      }
      await check(sub ? `${view}/${sub}` : view);
    };

    await check("entry");
    await page.locator("#dispatchAdd, .dispatch-table button").first().click().catch(() => {});
    await check("entry with dispatch rows");
    await open("register");
    await open("partywise");
    await open("dashboard");
    for (const sub of ["parties", "sisters", "styles", "finishes", "colors"]) await open("masters", sub);
    for (const sub of ["inward", "bills"]) await open("import", sub);

    await open("bills", "make");
    await page.locator("#toBillList button").filter({ hasText: PARTY }).click();
    await page.locator("#makeBills").click();
    await page.locator("#draftArea .draft").first().waitFor();
    await check("bills draft");
    await open("bills", "saved");

    await page.locator("#menuSettings").evaluate((item) => item.click());
    await page.locator("#settingsNav a").first().waitFor();
    for (const link of await page.locator("#settingsNav a").all()) {
      await link.click();
      await check(`settings/${await link.textContent()}`);
    }

    assert.deepEqual(problems, [], `controls that cut off their text:\n${problems.join("\n")}`);
    assert.deepEqual(errors, []);
    console.log("PASS: drop-downs, month pickers and bill column headings show their text in full.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
