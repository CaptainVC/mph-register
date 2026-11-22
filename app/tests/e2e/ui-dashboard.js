// Real Edge: the Dashboard tab, the way the owner uses it. Run against a throwaway copy of the data (it saves an entry).
const { chromium } = require("playwright-core");
const { chooseDropdown, dropdownValue, dropdownValues } = require("./dropdown-helpers");
const BASE = process.env.BASE || "http://127.0.0.1:5152";
let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => (ok ? passed++ : failures.push(`${name}${detail ? ` — ${detail}` : ""}`));

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const consoleErrors = [];
  const bad = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  page.on("response", (r) => r.status() >= 400 && bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`));
  page.on("dialog", (d) => { consoleErrors.push(`unexpected browser dialog: ${d.message()}`); d.dismiss(); });
  const dashboard = () => page.evaluate(() => dashState.data);
  const openDashboard = async () => {
    await page.click(".tab[data-view=dashboard]");
    await page.waitForSelector("#view-dashboard.active #dash-insights");
  };

  await page.goto(BASE);
  await page.waitForFunction(() => document.getElementById("inwardNo").value !== "");
  await page.evaluate(() => setLanguageChoice("en"));

  // ---------- Opens with figures, insights and charts ----------
  check("dashboard tab is shown", await page.isVisible(".tab[data-view=dashboard]"));
  await openDashboard();
  const d = await dashboard();
  check("heading", (await page.textContent("#dashRoot h1")) === "Business dashboard");
  const yearOptions = await dropdownValues(page.locator("#dashYear"));
  check("year select lists the years in the data", yearOptions.length === d.years.length, `${yearOptions} vs ${d.years}`);
  const monthOptions = await dropdownValues(page.locator("#dashMonth"));
  check("month select lists the months of the year", monthOptions.length === d.months.length, `${monthOptions} vs ${d.months}`);
  check("big figures shown", (await page.$$eval(".kpi", (k) => k.length)) >= 7);
  const kpis = await page.textContent(".kpis");
  check("billing and GST say what is measured", kpis.includes("Billed before GST") && kpis.includes("not net GST payable") && kpis.includes("not profit"));
  check("data coverage shown separately from refresh time", (await page.textContent("#dash-coverage")).includes("Last dated dispatch"));
  const stock = (await page.locator("#dash-stock tfoot td").allTextContents()).slice(1);
  check("stock table shows the total for all billing statuses", stock.map((v) => Number(v.replaceAll(",", ""))).join(",") ===
    [d.stock.total.entries, d.stock.total.pieces, d.stock.total.undispatchedThan, d.stock.total.partialEntries].join(","));
  check("insights shown", (await page.$$eval(".insight", (i) => i.length)) >= 3);
  check("income chart has one bar per month", (await page.$$eval("#dash-monthly rect.bar", (b) => b.length)) === d.months.length);
  check("THAN chart has received and billed bars", (await page.$$eval("#dash-than rect.bar", (b) => b.length)) === d.months.length * 2);
  check("party table lists parties", (await page.$$eval("#dash-parties tbody tr", (r) => r.length)) === Math.min(10, d.parties.length));
  check("GST table has a year total", (await page.textContent("#dash-gst tfoot")).includes("total"));
  if (d.unbilled.readyEntries > 0) {
    check("queue shows the exact estimate and avoids implying that links prove billing status", (await page.locator("#dash-unbilled .unbilled-big .kpi-value").getAttribute("title")) === await page.evaluate((v) => rsFull(v), d.unbilled.readyValue) &&
      (await page.textContent("#dash-unbilled")).includes("No bill link is not proof"));
  }
  check("amounts in lakh / crore", /₹[\d,.]+ (lakh|crore)/.test(await page.textContent(".kpis")));

  // ---------- Picking a month, a year ----------
  const target = d.months[0];
  await page.locator("#dash-monthly rect.hit").first().click();
  await page.waitForFunction((m) => dashState.data.month === m, target);
  check("clicking a bar picks that month", (await dropdownValue(page.locator("#dashMonth"))) === target, await dropdownValue(page.locator("#dashMonth")));
  await chooseDropdown(page.locator("#dashMonth"), d.month);
  await page.waitForFunction((m) => dashState.data.month === m, d.month);
  check("month select picks a month", (await page.textContent("#dash-gst tr.picked td")).length > 0);
  await chooseDropdown(page.locator("#dashYear"), d.years[d.years.length - 1]);
  await page.waitForFunction((fy) => dashState.data.fy === fy, d.years[d.years.length - 1]);
  check("year select changes the year", (await page.textContent("#dash-monthly h2")).includes(`20${d.years[d.years.length - 1].slice(0, 2)}`));
  await chooseDropdown(page.locator("#dashYear"), d.fy);
  await page.waitForFunction((fy) => dashState.data.fy === fy, d.fy);

  // ---------- Follows the data: a new entry shows up when the tab is opened again ----------
  const before = (await dashboard()).thisMonth;
  const party = (await page.evaluate(() => state.masters.parties.find((p) => p.active).name));
  const finish = (await page.evaluate(() => state.masters.finishes.find((f) => f.active).name));
  const today = await page.evaluate(() => todayIso());
  await page.click(".tab[data-view=entry]");
  await page.fill("#entryDate", today);
  await page.fill("#party", party);
  await page.fill("#than", "37");
  await page.fill("#finish", finish);
  await page.click("#saveButton");
  await page.waitForFunction(() => document.getElementById("formMessage").textContent.includes("Saved"));
  await openDashboard();
  await page.waitForFunction((than) => dashState.data.thisMonth.than === than, before.than + 37);
  check("new entry counted in cloth received this month", (await dashboard()).thisMonth.than === before.than + 37);
  await page.click("#dashRefresh");
  await page.waitForFunction(() => document.querySelector("#dashRoot .dash-sub")?.textContent.includes("updates on its own"));
  check("refresh button reloads", true);

  // ---------- Make bill jumps to Bills with that party ----------
  const unbilled = (await dashboard()).unbilledParties.find((p) => p.entries > 0);
  if (unbilled) {
    // A period left over from making older bills must not hide what the dashboard counted.
    await page.evaluate(() => { $("billMonth").value = "2026-04"; applyMonthDates(); });
    await page.locator("#dash-unbilled tbody tr", { hasText: unbilled.party }).first().locator("button").click();
    await page.waitForFunction(() => document.getElementById("view-bills").classList.contains("active") && billsState.candidates);
    check("make bill opens Bills for the party", (await page.evaluate(() => billsState.candidates.billParty)) === unbilled.party);
    check("period starts at the oldest unbilled entry", (await page.inputValue("#periodFrom")) <= unbilled.oldest, await page.inputValue("#periodFrom"));
    check("period runs to the end of this month", (await page.inputValue("#periodTo")) >= today, await page.inputValue("#periodTo"));
    check("its unbilled entries are listed", (await page.evaluate(() => billsState.candidates.entries.length)) >= unbilled.entries);
    await openDashboard();
  }

  // ---------- Hindi ----------
  await page.evaluate(() => setLanguageChoice("hi"));
  await page.waitForFunction(() => document.querySelector("#dashRoot h1")?.textContent === "व्यापार Dashboard");
  check("Hindi heading", true);
  check("Hindi tab name", (await page.textContent(".tab[data-view=dashboard]")) === "Dashboard");
  check("Hinglish keywords", (await page.textContent("#dashRoot")).includes("Entries"));
  check("Hindi amounts in लाख / करोड़", /(लाख|करोड़)/.test(await page.textContent(".kpis")));
  await page.evaluate(() => setLanguageChoice("en"));
  await page.waitForFunction(() => document.querySelector("#dashRoot h1")?.textContent === "Business dashboard");

  // ---------- Can be hidden in Settings → Features ----------
  await page.evaluate(() => switchView("settings"));
  await page.waitForSelector("#feature-dashboard");
  await page.uncheck("#feature-dashboard");
  await page.click("#firm-save");
  await page.waitForFunction(() => document.querySelector(".tab[data-view=dashboard]").classList.contains("hidden"));
  check("hiding the dashboard hides its tab", true);
  await page.check("#feature-dashboard");
  await page.click("#firm-save");
  await page.waitForFunction(() => !document.querySelector(".tab[data-view=dashboard]").classList.contains("hidden"));
  check("showing it again brings the tab back", true);

  check("no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  check("no failed requests", bad.length === 0, bad.join(" | "));
  await browser.close();
  console.log(`DASHBOARD UI: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(failures.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
