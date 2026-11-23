// Deterministic report fixtures: never reads or changes the user's arrivals.
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright-core");
const { chooseDropdown } = require("./dropdown-helpers");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const ARTIFACTS = process.env.MPH_ARTIFACT_DIR;
const number = (n) => n.toLocaleString("en-IN");
const source = Array.from({ length: 48 }, (_, i) => ({
  party: i % 16 === 0 ? "Save" : `DEMO TEXTILES ${String(i % 16).padStart(2, "0")}`,
  transporter: `DEMO LORRY ${i % 4 + 1}`,
  date: `2026-11-${String(i % 7 + 1).padStart(2, "0")}`,
  nag: (i + 1) * 7,
}));

function fixture(query, rows = source) {
  const grouped = query.get("group") !== "false";
  const key = (r) => grouped && ["Save", "DEMO TEXTILES 01"].includes(r.party) ? "DEMO FAMILY" : r.party;
  const lines = (getKey, describe = () => ({})) => {
    const names = [...new Set(rows.map(getKey))];
    const result = names.map((name) => {
      const matches = rows.filter((r) => getKey(r) === name);
      return { name, isGroup: false, members: [], arrivals: matches.length, nag: matches.reduce((s, r) => s + r.nag, 0), ...describe(name, matches) };
    });
    return query.get("order") === "first" ? result : result.sort((a, b) => b.nag - a.nag || a.name.localeCompare(b.name));
  };
  const matrix = [];
  for (const r of rows) {
    let cell = matrix.find((c) => c.transporter === r.transporter && c.party === key(r));
    if (!cell) { cell = { transporter: r.transporter, party: key(r), nag: 0 }; matrix.push(cell); }
    cell.nag += r.nag;
  }
  return {
    from: query.get("from"), to: query.get("to"), groupSisters: grouped, order: query.get("order"),
    arrivals: rows.length, nag: rows.reduce((s, r) => s + r.nag, 0),
    parties: lines(key, (name, matches) => name === "DEMO FAMILY" ? { isGroup: true, members: [...new Set(matches.map((r) => r.party))] } : {}),
    transporters: lines((r) => r.transporter),
    days: [...new Set(rows.map((r) => r.date))].sort().map((date) => {
      const matches = rows.filter((r) => r.date === date);
      return { date, arrivals: matches.length, nag: matches.reduce((s, r) => s + r.nag, 0) };
    }),
    matrix,
  };
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install({ time: new Date("2026-11-21T12:00:00") });
    let mode = "normal";
    let pending;
    let captured;
    const held = new Promise((resolve) => { captured = resolve; });
    await context.route("**/api/arrivals/totals?*", async (route) => {
      const query = new URL(route.request().url()).searchParams;
      if (mode === "hold") { pending = { route, query }; captured(); return; }
      if (mode === "error") return route.fulfill({ status: 500, json: { errors: ["Report temporarily unavailable"] } });
      return route.fulfill({ json: fixture(query, query.get("from") < "2001" ? [] : source) });
    });
    await context.route("**/api/arrivals/statement?*", (route) => {
      const q = new URL(route.request().url()).searchParams;
      const rows = source.filter((r) => r.transporter === q.get("transporter"));
      return route.fulfill({ json: {
        transporter: q.get("transporter"), nag: rows.reduce((s, r) => s + r.nag, 0),
        arrivals: rows.map((r, i) => ({ number: String(i + 1), arrivalDate: r.date, party: r.party, nag: r.nag, inwardText: "101-102" })),
      } });
    });
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
    await page.locator('[data-view="aawak"]').click();
    await page.locator('.subtabs[data-group="aawak"] [data-sub="totals"]').click();
    const result = page.locator("#totalsResult");
    const ready = () => page.waitForFunction(() => !document.getElementById("totalsPrint").disabled);
    await ready();
    const total = source.reduce((s, r) => s + r.nag, 0);
    assert.deepEqual(await result.locator(".report-stat b").allTextContents(), [number(total), "48", "15", "4"]);
    for (const t of await result.locator(".totals-table").all()) {
      assert.equal(await t.locator("tfoot th").last().textContent(), number(total));
    }
    assert.match(await result.locator(".report-name small").first().textContent(), /Save/);
    const parties = result.locator(".report-breakdowns > .report-card");
    // Search does not alter period totals or printing.
    await parties.getByRole("searchbox").fill("Save");
    assert.equal(await parties.locator("tbody tr:visible").count(), 1);
    assert.equal(await parties.locator("tfoot th").last().textContent(), number(total));
    await parties.getByRole("searchbox").fill("no such party");
    assert.equal(await parties.locator(".report-no-match").isVisible(), true);
    await parties.getByRole("searchbox").fill("");
    await page.evaluate(() => window.applyLanguage("hi"));
    assert.equal(await parties.locator(".report-name small").first().textContent(), "Save, DEMO TEXTILES 01");
    await page.evaluate(() => window.applyLanguage("en"));

    await result.locator(".report-cross summary").click();
    const matrix = result.locator(".report-matrix");
    assert.equal(await matrix.locator("tbody tr").count(), 4);
    assert.equal(await matrix.locator("tfoot th").last().textContent(), number(total));
    assert.ok((await matrix.locator("tbody").textContent()).includes("\u2014"), "missing combinations show a dash, not a misleading zero");
    const reconciles = await matrix.evaluate((t) => {
      const value = (c) => Number(c.textContent.replaceAll(",", "").replace("\u2014", "0"));
      const rows = [...t.tBodies[0].rows];
      return rows.every((r) => [...r.cells].slice(1, -1).reduce((s, c) => s + value(c), 0) === value(r.cells[r.cells.length - 1])) &&
        [...t.tFoot.rows[0].cells].slice(1).every((c, i) => rows.reduce((s, r) => s + value(r.cells[i + 1]), 0) === value(c));
    });
    assert.ok(reconciles, "each matrix row and column reconciles, not just the grand total");
    await result.locator(".report-cross summary").click();

    for (const width of [1440, 1280, 768, 390]) {
      await page.setViewportSize({ width, height: width === 1280 ? 640 : 1000 });
      const layout = await page.locator("#aawak-totals").evaluate((n) => ({ scroll: n.scrollWidth, client: n.clientWidth, pageWidth: document.documentElement.scrollWidth }));
      assert.ok(layout.scroll <= layout.client + 1 && layout.pageWidth <= width + 1, `totals do not overflow at ${width}px: ${JSON.stringify(layout)}`);
      if (ARTIFACTS && [1440, 390].includes(width)) {
        await page.locator("#aawak-totals").evaluate((n) => { n.scrollTop = 0; });
        await page.screenshot({ path: path.join(ARTIFACTS, `aawak-totals-${width}.png`) });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => document.documentElement.dataset.theme = "dark");
    if (ARTIFACTS) await page.screenshot({ path: path.join(ARTIFACTS, "aawak-totals-dark.png") });
    await page.evaluate(() => document.documentElement.dataset.theme = "light");

    await page.locator("#totalsGroup").uncheck();
    await ready();
    assert.equal(await result.locator(".report-stat b").nth(2).textContent(), "16");
    await chooseDropdown(page.locator("#totalsOrder"), "first");
    await ready();
    assert.equal(await result.locator(".totals-table").first().locator("tbody td").first().textContent(), "Save");

    const newPage = context.waitForEvent("page");
    await page.locator("#totalsPrint").click();
    const print = await newPage;
    await print.locator("#printNow:enabled").waitFor();
    assert.equal(new URL(print.url()).searchParams.get("group"), "false");
    assert.equal(new URL(print.url()).searchParams.get("order"), "first");
    assert.match(await print.locator(".report-header .sub").textContent(), /Individual parties.*First arrival/);
    assert.equal(await print.locator(".totals-table").first().locator("tbody tr").count(), 16);
    assert.equal(await print.locator("#dailyReport").isVisible(), false);
    await print.locator("#includeDaily").check();
    assert.equal(await print.locator("#dailyReport").isVisible(), true);
    await print.emulateMedia({ media: "print" });
    assert.equal(await print.locator(".toolbar").isVisible(), false);
    await print.evaluate(() => document.fonts.ready);
    const pdf = await print.pdf({ preferCSSPageSize: true, ...(ARTIFACTS ? { path: path.join(ARTIFACTS, "aawak-totals.pdf") } : {}) });
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    assert.ok(pdf.length > 10000, "PDF contains the rendered report and fonts");
    await print.emulateMedia({ media: "screen" });
    if (ARTIFACTS) await print.screenshot({ path: path.join(ARTIFACTS, "aawak-print-preview.png"), fullPage: true });
    await print.close();

    const groupedPrint = await context.newPage();
    await groupedPrint.goto(`${BASE}/print-aawak.html?kind=totals&from=2026-11-01&to=2026-11-30&group=true&order=nag`);
    await groupedPrint.locator("#printNow:enabled").waitFor();
    assert.equal(await groupedPrint.locator(".totals-table").first().locator("tbody tr").count(), 15);
    assert.match(await groupedPrint.locator(".totals-table small").first().textContent(), /Save/);
    if (ARTIFACTS) await groupedPrint.pdf({ preferCSSPageSize: true, path: path.join(ARTIFACTS, "aawak-totals-simple.pdf") });
    await groupedPrint.close();

    const statementsPage = context.waitForEvent("page");
    await page.locator("#statementsPrint").click();
    const statements = await statementsPage;
    await statements.locator("#printNow:enabled").waitFor();
    assert.equal(await statements.locator(".statement").count(), 4);
    assert.equal(await statements.locator("#dailyOption").isVisible(), false);
    await statements.close();

    // An older request finishing last must not overwrite the latest grouping or enable stale printing.
    mode = "hold";
    await page.locator("#totalsGroup").check();
    await page.waitForFunction(() => document.getElementById("totalsResult").getAttribute("aria-busy") === "true");
    assert.ok(await page.locator("#totalsPrint").isDisabled());
    // Wait until the route is captured, then allow the next request to complete first.
    await held;
    mode = "normal";
    await page.locator("#totalsGroup").uncheck();
    await ready();
    assert.ok(pending);
    await pending.route.fulfill({ json: fixture(pending.query) });
    await page.waitForLoadState("networkidle");
    assert.equal(await result.locator(".report-stat b").nth(2).textContent(), "16");

    await page.locator("#totalsFrom").fill("");
    await page.locator("#totalsTo").focus();
    await result.getByRole("alert").waitFor();
    assert.equal(await page.locator("#totalsFrom").inputValue(), "", "an incomplete custom date is not silently replaced");
    assert.ok(await page.locator("#totalsPrint").isDisabled());
    await page.locator("#totalsFrom").fill("2026-12-01");
    await page.locator("#totalsTo").focus();
    assert.match(await page.locator("#totalsStatus").textContent(), /on or before/);
    await page.locator("#totalsFrom").fill("2000-01-01");
    await page.locator("#totalsTo").fill("2000-01-31");
    await result.getByRole("heading", { name: "No arrivals in this period" }).waitFor();
    assert.ok(await page.locator("#totalsPrint").isDisabled());

    mode = "error";
    await chooseDropdown(page.locator("#totalsPeriod"), "thisMonth");
    await result.getByRole("button", { name: "Try again" }).waitFor();
    assert.match(await page.locator("#totalsStatus").textContent(), /Report temporarily unavailable/);
    assert.ok(await page.locator("#totalsPrint").isDisabled());
    mode = "normal";
    await result.getByRole("button", { name: "Try again" }).click();
    await ready();

    // Long names and multi-page tables must stay inside the A4 content width.
    const longRows = Array.from({ length: 100 }, (_, i) => ({
      ...source[i % source.length], party: `LONG DEMO PARTY ${i} ${"TEXTILE ".repeat(9)}`,
    }));
    await context.route("**/api/arrivals/totals?*", (route) => route.fulfill({ json: fixture(new URL(route.request().url()).searchParams, longRows) }));
    const longPrint = await context.newPage();
    await longPrint.goto(`${BASE}/print-aawak.html?kind=totals&from=2026-11-01&to=2026-11-30&group=false&order=nag`);
    await longPrint.locator("#printNow:enabled").waitFor();
    await longPrint.emulateMedia({ media: "print" });
    const fits = await longPrint.locator("main").evaluate((n) => n.scrollWidth <= n.clientWidth + 1);
    assert.ok(fits, "long names wrap within the printable width");
    await longPrint.pdf({ preferCSSPageSize: true, ...(ARTIFACTS ? { path: path.join(ARTIFACTS, "aawak-totals-long.pdf") } : {}) });
    await longPrint.close();
    assert.deepEqual(errors, []);
    console.log("Aawak totals: summaries, grouping, search, matrix, responsive layouts, print/PDF, statements, stale requests, dates, empty/error recovery and long reports passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
