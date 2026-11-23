// Real Edge: the Dashboard tab, the way the owner uses it. Run against a throwaway copy of the data (it saves an entry).
const { chromium } = require("playwright-core");
const { chooseDropdown, dropdownValues } = require("./dropdown-helpers");
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
  const facts = () => page.evaluate(() => dashState.model.f);
  const openDashboard = async () => {
    await page.click(".tab[data-view=dashboard]");
    await page.waitForSelector("#view-dashboard.active #dashMain");
  };
  const section = async (name) => {
    await page.click(`.dash-tab[data-section=${name}]`);
    await page.waitForSelector(`.dash-tab.active[data-section=${name}]`);
  };

  await page.goto(BASE);
  await page.waitForFunction(() => document.getElementById("inwardNo").value !== "");
  await page.evaluate(() => setLanguageChoice("en"));

  // ---------- Opens with figures, insights and charts ----------
  check("dashboard tab is shown", await page.isVisible(".tab[data-view=dashboard]"));
  await openDashboard();
  const f = await facts();
  check("heading", (await page.textContent("#dashRoot h1")) === "Business dashboard");
  const years = await page.evaluate(() => dashState.model.years);
  const yearOptions = await dropdownValues(page.locator("#dashYear"));
  check("year select lists the years in the data", yearOptions.join() === years.join(), `${yearOptions} vs ${years}`);
  check("month grid lists the 12 months of the year", (await page.$$eval("#dashMonths [data-month]", (b) => b.length)) === 12);
  check("big figures shown", (await page.$$eval(".kpi", (k) => k.length)) >= 7);
  const kpis = await page.textContent("#dashMain");
  check("billing and GST say what is measured", kpis.includes("Billed before GST") && kpis.includes("not net GST payable") && kpis.includes("not profit"));
  check("data coverage shown separately from refresh time", (await page.textContent("#dash-coverage")).includes("Last dated dispatch"));
  check("insights shown", (await page.$$eval(".insight", (i) => i.length)) >= 3);
  const categories = await page.$$eval("#dash-monthly text.cat", (t) => t.length);
  check("income chart has one bar per month", (await page.$$eval("#dash-monthly rect.bar", (b) => b.length)) % categories === 0 && categories > 0);
  check("amounts in lakh / crore", /₹[\d,.]+ (lakh|crore)/.test(await page.textContent(".kpis")));

  await section("cloth");
  const stock = (await page.locator("#dash-stock tfoot td").allTextContents()).slice(1).map((v) => Number(v.replaceAll(",", "")));
  const total = f.stock.reduce((sum, s) => [sum[0] + s.total.entries, sum[1] + s.total.pieces, sum[2] + s.total.undispatchedThan, sum[3] + s.total.partialEntries], [0, 0, 0, 0]);
  check("stock table shows the total for all billing statuses", stock.join() === total.join(), `${stock} vs ${total}`);
  const cats = await page.$$eval("#dash-than text.cat", (t) => t.length);
  check("THAN chart has received and billed bars", (await page.$$eval("#dash-than rect.bar", (b) => b.length)) === cats * 2);
  await section("parties");
  const partyRows = await page.evaluate(() => partyRows(dashView()).length);
  check("party table lists parties", (await page.$$eval("#dashPartyTable tbody tr", (r) => r.length)) === Math.min(30, partyRows));
  await section("gst");
  check("GST table has a total for the picked months", (await page.textContent("#dash-gst tfoot")).includes("Picked"));
  const ready = f.unbilled.reduce((sum, u) => sum + u.ready.value, 0);
  await section("unbilled");
  if (ready > 0) {
    check("queue shows the exact estimate and avoids implying that links prove billing status", (await page.locator("#dash-unbilled .unbilled-big .kpi-value").getAttribute("title")) === await page.evaluate((v) => rsFull(v), ready) &&
      (await page.textContent("#dash-unbilled")).includes("No bill link is not proof"));
  }

  // ---------- Picking a month, a year ----------
  await section("overview");
  const target = await page.$eval("#dash-monthly rect.hit", (hit) => hit.getAttribute("aria-label"));
  await page.locator("#dash-monthly rect.hit").first().click();
  check("clicking a bar picks that month", (await page.evaluate(() => dashView().months.length)) === 1 && (await page.textContent("#dashPicked")).startsWith(await page.evaluate((m) => MONTHS_LONG[MONTHS.indexOf(m)], target)));
  if (years.length > 1) {
    await chooseDropdown(page.locator("#dashYear"), years.at(-1));
    check("year select changes the months", (await page.getAttribute("#dashMonths [data-month]", "data-month")).startsWith(`20${years.at(-1).slice(0, 2)}-04`));
    await chooseDropdown(page.locator("#dashYear"), years[0]);
  }

  // ---------- Follows the data: a new entry shows up when the tab is opened again ----------
  const before = await page.evaluate(() => thisMonthFor(null).than);
  const party = (await page.evaluate(() => state.masters.parties.find((p) => p.active).name));
  const finish = (await page.evaluate(() => state.masters.finishes.find((x) => x.active).name));
  const today = await page.evaluate(() => todayIso());
  await page.click(".tab[data-view=entry]");
  await page.fill("#entryDate", today);
  await page.fill("#party", party);
  await page.fill("#than", "37");
  await page.fill("#finish", finish);
  await page.click("#saveButton");
  await page.waitForFunction(() => document.getElementById("toasts").textContent.includes("Saved"));
  await openDashboard();
  await page.waitForFunction((than) => thisMonthFor(null).than === than, before + 37);
  check("new entry counted in cloth received this month", (await page.evaluate(() => thisMonthFor(null).than)) === before + 37);
  await page.click("#dashRefresh");
  await page.waitForFunction(() => document.querySelector("#dashStatus")?.textContent.includes("updates on its own"));
  check("refresh button reloads", true);

  // ---------- Make bill jumps to Bills with that party ----------
  const unbilled = await page.evaluate(() => dashState.model.f.unbilled.filter((u) => u.ready.entries > 0).map((u) => ({ party: partyName(u.party), oldest: u.oldest, entries: u.ready.entries }))[0]);
  if (unbilled) {
    // A period left over from making older bills must not hide what the dashboard counted.
    await page.evaluate(() => { $("billMonth").value = "2026-04"; applyMonthDates(); });
    await section("unbilled");
    await page.locator("#dashUnbilledTable tbody tr", { hasText: unbilled.party }).first().locator("button.small").click();
    await page.waitForFunction(() => document.getElementById("view-bills").classList.contains("active") && billsState.candidates);
    check("make bill opens Bills for the party", (await page.evaluate(() => billsState.candidates.billParty)) === unbilled.party);
    check("period starts at the oldest unbilled entry", (await page.$eval("#periodFrom", (box) => box.value)) <= unbilled.oldest, await page.$eval("#periodFrom", (box) => box.value));
    check("period runs to the end of this month", (await page.$eval("#periodTo", (box) => box.value)) >= today, await page.$eval("#periodTo", (box) => box.value));
    check("its unbilled entries are listed", (await page.evaluate(() => billsState.candidates.entries.length)) >= unbilled.entries);
    await openDashboard();
  }

  // ---------- Hindi ----------
  await page.evaluate(() => setLanguageChoice("hi"));
  await page.waitForFunction(() => document.querySelector("#dashRoot h1")?.textContent === "व्यापार Dashboard");
  check("Hindi heading", true);
  check("Hindi tab name", (await page.textContent(".tab[data-view=dashboard]")) === "Dashboard");
  check("Hinglish keywords", (await page.textContent("#dashRoot")).includes("Entries"));
  await section("overview");
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
