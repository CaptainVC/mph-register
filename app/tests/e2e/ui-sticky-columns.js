// Register and Party-wise: sticky columns stay put, D.N. and LOT N. stay compact, and BILL NO. expands on click.
// Read-only, against deterministic API responses.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const LONG_BILL = "Billed outside app: entered in the old Excel register under bill 1234, 1235, 1236 and 1237 by the previous clerk";
const LONG_DN = "208,209,215,216,217";
const LONG_LOT = "1370,1371,1372,1373";
const entries = [1, 2].map((id) => ({
  id, inwardNo: id, party: id === 1 ? "A VERY LONG PARTY NAME TRADING COMPANY PRIVATE LIMITED" : "ABC", finish: "S2G", status: "pending", than: 5,
  nettThan: 5, nag: 5, registerMonth: "2026-10", entryDate: "2026-10-15", designNo: LONG_DN, lotNo: LONG_LOT, repair: false, tp: 0, twoPart: 0,
  shortThan: null, carriedOver: false, dispatched: 0, balance: 5, dispatches: [], warnings: [],
  billedIn: id === 1 ? LONG_BILL : "INV-1, INV-2",
}));

async function checkSticky(page, table) {
  const box = async (selector) => page.locator(`${selector}:visible`).first().evaluate((node) => {
    const { left, right } = node.getBoundingClientRect();
    return { left, right, position: getComputedStyle(node).position };
  });
  const wrapLeft = await page.locator(`${table}`).locator("..").evaluate((node) => {
    node.scrollLeft = 900;
    return node.getBoundingClientRect().left + node.clientLeft;
  });
  assert.ok(await page.locator(`${table}`).locator("..").evaluate((node) => node.scrollLeft) > 0, `${table} scrolls sideways`);
  for (const part of ["thead th", "tbody tr[data-entry-id] td"]) {
    const [inw, date, party] = [1, 2, 3].map((n) => `${table} ${part}:nth-child(${n})`);
    const [a, b, c] = [await box(inw), await box(date), await box(party)];
    for (const cell of [a, b, c]) assert.equal(cell.position, "sticky", `${table} ${part} is sticky`);
    assert.ok(Math.abs(a.left - wrapLeft) < 1.5, `${table} ${part}: INW. NO. pinned at the left edge (${a.left} vs ${wrapLeft})`);
    assert.ok(Math.abs(b.left - a.right) < 1.5, `${table} ${part}: DATE pinned right after INW. NO.`);
    assert.ok(Math.abs(c.left - b.right) < 1.5, `${table} ${part}: PARTY pinned right after DATE`);
  }
  const headers = await page.locator(`${table} thead th`).allTextContents();
  assert.equal(headers.slice(0, 3).join("|"), "INW. NO.|DATE|PARTY");
  assert.equal(headers[headers.indexOf("NETT THAN") + 1], "BILL NO.", `${table}: BILL NO. follows NETT THAN`);
  assert.equal(headers.at(-1), "WARNINGS");
  assert.equal(headers.filter((h) => h === "BILL NO.").length, 1);
  for (const [index, expected] of [[4, LONG_DN], [5, LONG_LOT]]) {
    const cell = page.locator(`${table} tr[data-entry-id]`).first().locator(`td:nth-child(${index})`);
    const dimensions = await cell.evaluate((node) => ({
      width: node.getBoundingClientRect().width,
      whiteSpace: getComputedStyle(node).whiteSpace,
      overflowWrap: getComputedStyle(node).overflowWrap,
    }));
    assert.ok(Math.abs(dimensions.width - 112) < 1.5, `${table} column ${index} is compact (${dimensions.width}px)`);
    assert.equal(dimensions.whiteSpace, "normal", `${table} column ${index} wraps long identifiers`);
    assert.equal(dimensions.overflowWrap, "normal", `${table} column ${index} keeps numbers intact`);
    assert.equal((await cell.textContent()).trim(), expected);
    const lineTops = await cell.evaluate((node) => {
      const tops = [];
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode) {
        const range = document.createRange();
        range.selectNodeContents(textNode);
        tops.push(...[...range.getClientRects()].map((rect) => Math.round(rect.top)));
        textNode = walker.nextNode();
      }
      return [...new Set(tops)];
    });
    assert.ok(lineTops.length > 1, `${table} column ${index} wraps between comma-separated values`);
    const number = index === 4 ? "215" : "1370";
    const numberLineTops = await cell.evaluate((node, token) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode) {
        const start = textNode.textContent.indexOf(token);
        if (start >= 0) {
          const range = document.createRange();
          range.setStart(textNode, start);
          range.setEnd(textNode, start + token.length);
          return [...new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)))];
        }
        textNode = walker.nextNode();
      }
      return [];
    }, number);
    assert.equal(numberLineTops.length, 1, `${table} keeps ${number} together on one line`);
  }
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/partywise?**", (route) => route.fulfill({ json: entries }));
    await page.route(/\/api\/entries(\?.*)?$/, (route) => route.fulfill({ json: entries }));
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));

    await page.locator('[data-view="register"]').click();
    await page.locator("#registerTable tbody tr[data-entry-id]").nth(1).waitFor();
    await checkSticky(page, "#registerTable");

    // BILL NO.: two lines at most, the whole text on hover (title) and on click.
    const cell = page.locator("#registerTable tbody tr[data-entry-id]").nth(0).locator("td.bill-cell");
    const text = cell.locator(".bill-text");
    assert.equal(await cell.getAttribute("title"), LONG_BILL, "hover shows the full text");
    const clipped = await text.evaluate((node) => ({ shown: node.clientHeight, full: node.scrollHeight }));
    assert.ok(clipped.full > clipped.shown, `long text is clipped (${JSON.stringify(clipped)})`);
    assert.ok((await cell.evaluate((node) => node.getBoundingClientRect().width)) <= 191, "BILL NO. stays narrow");
    await cell.click();
    assert.ok(await cell.evaluate((node) => node.classList.contains("expanded")), "click opens the cell out");
    const opened = await text.evaluate((node) => ({ shown: node.clientHeight, full: node.scrollHeight }));
    assert.ok(opened.shown >= opened.full, "the whole text is visible once clicked");
    assert.equal((await text.textContent()).trim(), LONG_BILL);
    await cell.click();
    assert.ok(!(await cell.evaluate((node) => node.classList.contains("expanded"))), "a second click closes it again");
    assert.equal(await page.locator("#registerTable td.cell-editing").count(), 0, "clicking BILL NO. edits nothing");

    // Bill links in a short list still work and keep their own tooltip.
    const links = page.locator("#registerTable tbody tr[data-entry-id]").nth(1).locator("td.bill-cell a.bill-link");
    assert.deepEqual(await links.allTextContents(), ["INV-1", "INV-2"]);

    await page.locator('[data-view="partywise"]').click();
    await page.locator("#partyTable tr.group").first().waitFor();
    for (const button of await page.locator("#partyTable tr.group button").all()) await button.click();
    await page.locator("#partyTable tbody tr[data-entry-id]").first().waitFor({ state: "visible" });
    await checkSticky(page, "#partyTable");

    assert.deepEqual(errors, []);
    console.log("PASS: D.N. and LOT N. stay 112px wide without splitting numbers; sticky columns and BILL NO. behavior hold.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
