// Drives the real screen in Microsoft Edge with the keyboard, like the operator would.
const { chromium } = require("playwright-core");
const { chooseDropdown } = require("./dropdown-helpers");
const { load } = require("./private-data");

const { P } = load();
const BIG = P.bigParty;
const words = (name) => name.toLowerCase().split(/[\s.]+/).filter(Boolean);
// Searches typed like the operator: the twin names' words swapped, the big party's first word plus 3 letters of the next.
const twinSearch = `${words(P.twinNameA)[1]} ${words(P.twinNameA)[0]}`;
const bigSearch = `${words(BIG)[0]} ${words(BIG)[1].slice(0, 3)}`;

const BASE = "http://127.0.0.1:5152";
let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => (ok ? passed++ : failures.push(`${name}${detail ? ` — ${detail}` : ""}`));

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  const badResponses = [];
  page.on("response", (r) => r.status() >= 400 && badResponses.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`));
  page.on("dialog", (d) => { consoleErrors.push(`unexpected dialog: ${d.message()}`); d.dismiss(); });

  await page.goto(BASE);
  await page.waitForFunction(() => document.getElementById("inwardNo").value !== "");
  await page.waitForFunction(() => document.activeElement.id === "party", null, { timeout: 3000 }).catch(() => {});
  check("starts focused on PARTY", await page.evaluate(() => document.activeElement.id === "party"));
  check("top-right register month picker is removed", !(await page.$("#registerMonth")));
  check("inward number pre-filled", (await page.inputValue("#inwardNo")) === "5", await page.inputValue("#inwardNo"));
  check("title shows register month from date", (await page.textContent("#formTitle")).includes("Nov 2026"));

  // Changing entry date to another month updates the register title and next inward number.
  const initialDate = await page.inputValue("#entryDate");
  await page.fill("#entryDate", "2026-10-15");
  await page.dispatchEvent("#entryDate", "change");
  await page.waitForFunction(() => document.getElementById("inwardNo").value === "984");
  check("changing date to Oct updates title and inward number", (await page.textContent("#formTitle")).includes("Oct 2026") && (await page.inputValue("#inwardNo")) === "984");
  await page.fill("#entryDate", initialDate);
  await page.dispatchEvent("#entryDate", "change");
  await page.waitForFunction(() => document.getElementById("inwardNo").value === "5");
  await page.focus("#party");

  // Party search: words in any order, punctuation ignored, active first.
  await page.keyboard.type(twinSearch);
  const matches = await page.$$eval("#partyCombo .combo-list li", (li) => li.map((x) => x.textContent));
  check("search with the words swapped finds both twin-named parties", matches.includes(P.twinNameA) && matches.includes(P.twinNameB), matches.join(", "));
  await page.fill("#party", "");
  await page.keyboard.type(bigSearch);
  const first = await page.textContent("#partyCombo .combo-list li.highlight");
  check("best match highlighted", first === BIG, first);
  await page.keyboard.press("Enter");
  check("Enter picks party", (await page.inputValue("#party")) === BIG);
  check("Enter moves to D.N.", await page.evaluate(() => document.activeElement.id === "designNo"));

  // Full keyboard entry: Enter moves field to field and saves at the end.
  await page.keyboard.type("13600");
  await page.keyboard.press("Enter");
  await page.keyboard.type("L-88");
  await page.keyboard.press("Enter");
  check("REP. reached", await page.evaluate(() => document.activeElement.id === "repair"));
  await page.keyboard.press("Enter");
  await page.keyboard.type("24");
  await page.keyboard.press("Enter");
  await page.keyboard.type("1");
  check("NAG calculates live", (await page.textContent("#nag")) === "25");
  check("NETT THAN calculates live", (await page.textContent("#nett")) === "24");
  await page.keyboard.press("Enter");
  check("FINISH reached", await page.evaluate(() => document.activeElement.id === "finish"));
  await page.keyboard.type("s2g");
  const finishList = await page.$$eval("#finishCombo .combo-list li", (li) => li.map((x) => x.textContent));
  check("finish search exact first", finishList[0] === "S2G", finishList.join(", "));
  await page.keyboard.press("Enter");
  check("Enter moves to TWO PART", await page.evaluate(() => document.activeElement.id === "twoPart"));
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.getElementById("toasts").textContent.includes("Saved"));
  const message = await page.textContent("#toasts");
  check("saved message", message.includes("INW. NO. 5") && message.includes(BIG) && message.includes("24 THAN S2G"), message);
  check("form cleared and ready", (await page.inputValue("#party")) === "" && (await page.inputValue("#inwardNo")) === "6");
  check("focus back on PARTY", await page.evaluate(() => document.activeElement.id === "party"));
  check("recent list shows new entry first", (await page.textContent("#recentTable tbody tr td:nth-child(3)")) === BIG);

  // Errors are shown clearly and nothing is saved.
  await page.fill("#party", "NOBODY");
  await page.fill("#than", "5");
  await page.fill("#finish", "S2G");
  await page.click("#saveButton");
  await page.waitForFunction(() => document.getElementById("formMessage").classList.contains("err"));
  check("unknown party error shown", (await page.textContent("#formMessage")).includes("not in the party list"));
  check("party field highlighted red", await page.$eval("#party", (x) => x.classList.contains("invalid")));
  check("number not consumed by failed save", (await page.inputValue("#inwardNo")) === "6");

  // Script-like text from an earlier entry is displayed as text, not run.
  const injected = await page.$$eval("#recentTable td", (tds) => tds.some((t) => t.textContent === "<img src=x onerror=alert(1)>"));
  check("unusual text shown literally", injected);
  check("no image element injected", (await page.$$("#recentTable img")).length === 0);

  // Click a row to correct it; Esc cancels.
  await page.click("#recentTable tbody tr:first-child td.inward");
  check("row loads for correction", (await page.textContent("#formTitle")).includes("Correcting INW. NO. 5"));
  check("edit fields loaded", (await page.inputValue("#designNo")) === "13600" && (await page.inputValue("#lotNo")) === "L-88");
  await page.fill("#lotNo", "L-89");
  await page.click("#saveButton");
  await page.waitForFunction(() => document.getElementById("toasts").textContent.includes("Corrected"));
  check("correction saved", (await page.textContent("#recentTable tbody tr:first-child")).includes("L-89"));
  await page.click("#recentTable tbody tr:first-child td.inward");
  await page.keyboard.press("Escape");
  check("Esc cancels edit", !(await page.textContent("#formTitle")).includes("Correcting"));

  // Dispatch section: always open with an empty row ready to type in; empty rows are not saved.
  check("dispatch row ready on a new entry", (await page.$$("#dispatchRows tr")).length === 1 && await page.isVisible("#dispatchRows tr .d-qty"));
  await page.click("#recentTable tbody tr:first-child td.inward");
  check("correction shows one empty dispatch row", (await page.$$("#dispatchRows tr")).length === 1);
  await page.fill("#dispatchRows tr:first-child .d-qty", "10");
  await page.fill("#dispatchRows tr:first-child .d-gate", "901");
  await page.fill("#dispatchRows tr:first-child .d-date", "2026-11-25");
  await page.click("#addDispatch");
  check("+ Add another dispatch adds a row", (await page.$$("#dispatchRows tr")).length === 2 && await page.evaluate(() => document.activeElement.classList.contains("d-qty")));
  const dispatchStats = await page.evaluate(() => ["dispatchTotal", "dispatchSent", "dispatchBalance"].map((id) => document.getElementById(id).textContent).join("/"));
  check("dispatch summary live", dispatchStats === "25/10/15", dispatchStats);
  await page.click("#saveButton");
  await page.waitForFunction(() => document.getElementById("toasts").textContent.includes("Corrected"));
  check("dispatch saved, row partial colour", await page.waitForFunction(() => document.querySelector("#recentTable tbody tr:first-child")?.classList.contains("partial"), null, { timeout: 5000 }).then(() => true, () => false));
  await page.click("#recentTable tbody tr:first-child td.inward");
  check("saved dispatch loads with an empty row after it", (await page.$$("#dispatchRows tr")).length === 2 && (await page.inputValue("#dispatchRows tr:first-child .d-qty")) === "10" && (await page.inputValue("#dispatchRows tr:last-child .d-qty")) === "");
  await page.keyboard.press("Escape");

  // Register view: imported data, colours and search.
  await page.click(".tab[data-view=register]");
  await chooseDropdown(page.locator("#registerViewMonth"), "2026-10");
  await page.waitForFunction(() => document.getElementById("registerCount").textContent.startsWith("985"));
  check("register shows all 985 October rows", (await page.textContent("#registerCount")) === "985 of 985 entries");
  const totals = await page.textContent("#registerTotals");
  check("register totals match workbook (Indian digit grouping)", totals.includes("THAN: 39,184") && totals.includes("NETT THAN: 39,078") && totals.includes("JAWAK NAG: 39,030"), totals);
  const colours = await page.$$eval("#registerTable tbody tr", (rows) => ({
    pending: rows.filter((r) => r.classList.contains("pending")).length,
    partial: rows.filter((r) => r.classList.contains("partial")).length,
    over: rows.filter((r) => r.classList.contains("over")).length,
    carried: rows.filter((r) => r.classList.contains("carried")).length,
    allZero: rows.filter((r) => r.classList.contains("allZero")).length,
  }));
  check("status colours present", colours.pending > 0 && colours.carried === 2, JSON.stringify(colours));
  await page.fill("#registerSearch", "4306");
  await page.waitForFunction(() => document.getElementById("registerCount").textContent.startsWith("3 of"));
  const found = await page.$$eval("#registerTable tbody tr", (rows) => rows.map((r) => r.cells[0].textContent.trim()));
  check("register search 4306 = designs 846, 961 + gate pass on 177", JSON.stringify(found.sort()) === JSON.stringify(["177", "846", "961"]), found.join(","));
  check("clear search button appears and count badge highlights when filtered", !(await page.$eval("#clearRegisterSearch", (b) => b.classList.contains("hidden"))) && (await page.$eval("#registerCount", (c) => c.classList.contains("filtered"))));
  await page.click("#clearRegisterSearch");
  await page.waitForFunction(() => document.getElementById("registerCount").textContent === "985 of 985 entries");
  check("clear search button hides and resets search", (await page.inputValue("#registerSearch")) === "" && (await page.$eval("#clearRegisterSearch", (b) => b.classList.contains("hidden"))) && !(await page.$eval("#registerCount", (c) => c.classList.contains("filtered"))));

  // Filters; the colour chips double as the legend. Expectations come from the rows themselves, not from fixed numbers.
  const chip = (key) => `#registerFilters [data-filter="${key}"]`;
  const chipCount = async (key) => Number((await page.textContent(`${chip(key)} .chip-count`)).replace(/,/g, ""));
  const shownCount = async () => Number((await page.textContent("#registerCount")).split(" of ")[0].replace(/,/g, ""));
  const waitShown = (n) => page.waitForFunction((x) => document.getElementById("registerCount").textContent.startsWith(`${x.toLocaleString("en-IN")} of`), n);
  const shownRows = () => page.$$eval("#registerTable tbody tr", (rows) => rows.map((r) => [...r.classList]));
  // What each row is, read from its own cells: REP., THAN and BILL NO. are found by their headings.
  const rowFacts = () => page.$$eval("#registerTable", ([table]) => {
    const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent);
    const at = (name) => heads.indexOf(name);
    return [...table.querySelectorAll("tbody tr")].map((r) => ({
      classes: [...r.classList], repair: r.cells[at("REP.")].textContent === "Yes",
      than: Number(r.cells[at("THAN")].textContent.replace(/,/g, "")), bill: r.cells[at("BILL NO.")].textContent,
    }));
  });
  const facts = await rowFacts();
  const expected = {
    pending: colours.pending, partial: colours.partial, over: colours.over, allZero: colours.allZero, carried: colours.carried,
    done: facts.filter((f) => f.classes.includes("done")).length,
    warning: facts.filter((f) => f.classes.includes("has-warning")).length,
    repair: facts.filter((f) => f.repair).length,
    billNo: facts.filter((f) => f.bill !== "").length,
    billBlank: facts.filter((f) => f.bill === "").length,
  };
  // The filters start collapsed; the toggle shows them.
  await page.click("#registerFiltersToggle");
  await page.waitForSelector("#registerFilters", { state: "visible" });
  const counts = {};
  for (const key of Object.keys(expected)) counts[key] = await chipCount(key);
  check("every filter chip counts its rows", JSON.stringify(counts) === JSON.stringify(expected), JSON.stringify({ counts, expected }));
  check("dispatch chips cover every row once", expected.pending + expected.partial + expected.done + expected.over + expected.allZero === 985, JSON.stringify(expected));
  const allZeroRows = await page.$$eval("#registerTable tbody tr.allZero", (rows) => rows.map((r) => ({ no: r.cells[0].textContent, warned: r.classList.contains("has-warning"), tip: r.title })));
  check("all-zero slips (84, 85: billed in September) are faded, explained and not warned",
    JSON.stringify(allZeroRows.map((r) => r.no)) === JSON.stringify(["84", "85"]) && allZeroRows.every((r) => !r.warned && r.tip.startsWith("All zero:")), JSON.stringify(allZeroRows));
  check("the old warnings checkbox is gone", !(await page.$("#onlyWarnings")));
  const bar = await page.$eval("#registerFilters", (b) => ({
    height: b.getBoundingClientRect().height,
    // Each group keeps its chips on one line; whole groups wrap when the window is narrow.
    splitGroups: [...b.querySelectorAll(".filter-group")].filter((g) =>
      new Set([...g.querySelectorAll(".filter-split")].map((c) => Math.round(c.getBoundingClientRect().top))).size > 1).length,
    pressed: b.querySelectorAll('[aria-pressed="true"]').length,
    clear: getComputedStyle(b.querySelector(".filter-clear")).visibility,
    captions: [...b.querySelectorAll(".filter-caption")].map((c) => c.textContent),
  }));
  check("filters in 4 groups that wrap whole, none ticked, Clear hidden", bar.splitGroups === 0 && bar.pressed === 0 && bar.clear === "hidden" && bar.captions.join() === "Dispatch,Bill,Other,Last import", JSON.stringify(bar));

  await page.click(chip("pending"));
  await waitShown(counts.pending);
  check("Nothing dispatched shows only those rows", (await shownRows()).every((c) => c.includes("pending")) && (await page.getAttribute(chip("pending"), "aria-pressed")) === "true");
  check("totals follow the ticked colours", (await page.textContent("#registerTotals")).includes(`Entries: ${counts.pending.toLocaleString("en-IN")}`), await page.textContent("#registerTotals"));
  await page.click(chip("partial"));
  await waitShown(counts.pending + counts.partial);
  check("two dispatch colours show rows of either", (await shownRows()).every((c) => c.includes("pending") || c.includes("partial")));
  const carriedOpen = await chipCount("carried");
  check("chip counts follow the other ticked chips", carriedOpen <= counts.carried, `${carriedOpen} of ${counts.carried}`);
  await page.click(chip("carried"));
  await waitShown(carriedOpen);
  check("Carryover narrows to carryovers of the ticked dispatch states", (await shownRows()).every((c) => c.includes("carried") && (c.includes("pending") || c.includes("partial"))));
  await page.click("#registerFilters .filter-clear");
  await waitShown(985);
  check("Clear shows every row and unticks all", (await page.$$('#registerFilters [aria-pressed="true"]')).length === 0 && (await shownCount()) === 985);

  const chipsAt = () => page.$$eval("#registerFilters .filter-chip", (b) => b.map((x) => x.getBoundingClientRect().left));
  const before = await chipsAt();
  await page.click(chip("done"));
  await waitShown(expected.done);
  check("Completed shows only fully dispatched rows", (await shownRows()).every((c) => c.includes("done")));
  const bar2 = await page.$eval("#registerFilters", (b) => b.getBoundingClientRect().height);
  const after = await chipsAt();
  const moved = Math.max(...after.map((x, i) => Math.abs(x - before[i])));
  check("ticking a chip moves no chip (counts change, places do not)", bar2 === bar.height && moved < 1, `${bar2}/${bar.height}, moved up to ${moved.toFixed(2)} px`);
  await page.click(chip("done"));
  await page.click(chip("repair"));
  await waitShown(expected.repair);
  const repairs = await rowFacts();
  check("Repair shows only repair rows (REP. Yes)", repairs.length === expected.repair && repairs.every((f) => f.repair), String(repairs.length));
  check("Bill no. chip counts the repair rows that have a bill", (await chipCount("billNo")) === repairs.filter((f) => f.bill !== "").length);
  await page.click(chip("repair"));
  await page.click(chip("billBlank"));
  await waitShown(expected.billBlank);
  check("Blank shows rows without a bill", (await rowFacts()).every((f) => f.bill === ""));
  await page.click(chip("pending"));
  await waitShown(facts.filter((f) => f.bill === "" && f.classes.includes("pending")).length);
  check("Blank + Nothing dispatched narrows to both", (await rowFacts()).every((f) => f.bill === "" && f.classes.includes("pending")));
  await page.click("#registerFilters .filter-clear");
  await waitShown(985);
  await page.fill("#registerSearch", "4306");
  await waitShown(3);
  const searched = await shownRows();
  const searchedPending = searched.filter((c) => c.includes("pending")).length;
  check("chip counts follow the search", (await chipCount("pending")) === searchedPending && (await chipCount("partial")) === searched.filter((c) => c.includes("partial")).length);
  await page.click(chip("pending"));
  await waitShown(searchedPending);
  check("search and colour filters work together", (await shownRows()).length === searchedPending && (await shownRows()).every((c) => c.includes("pending")), String(await shownCount()));
  await page.click(chip("pending"));
  await page.fill("#registerSearch", "");
  await waitShown(985);

  await page.click(chip("warning"));
  await waitShown(counts.warning);
  check("Has warning shows exactly the 6 flagged rows", (await page.textContent("#registerCount")).startsWith("6 of"), await page.textContent("#registerCount"));
  const flagged = await page.$$eval("#registerTable tbody tr", (rows) => rows.map((r) => r.cells[0].textContent.trim()));
  check("flagged inward numbers (182: SHORT THAN 4461 > THAN 55)", JSON.stringify(flagged.sort((a, b) => a - b)) === JSON.stringify(["76", "182", "502", "827", "861", "919"]), flagged.join(","));

  // Party-wise view.
  await page.click(".tab[data-view=partywise]");
  await chooseDropdown(page.locator("#partyViewMonth"), "2026-10");
  await page.fill("#partyFilter", bigSearch);
  await page.keyboard.press("Enter");
  await page.waitForFunction((name) => document.getElementById("partyCount").textContent.includes(name), BIG);
  check("party-wise filtered to the big party", (await page.textContent("#partyCount")) === `284 entries for ${BIG}`);
  const groups = await page.$$eval("#partyTable tr.subgroup .group-name", (els) => els.map((n) => n.textContent.trim()));
  check("grouped by finish", JSON.stringify(groups) === JSON.stringify(["2S2G", "S2G", "SG"]), groups.join(","));
  const partyGroupSummary = await page.$eval("#partyTable tr.group", (tr) => ({
    kicker: tr.querySelector(".group-kicker")?.textContent.trim(),
    name: tr.querySelector(".group-name")?.textContent.trim(),
    count: tr.querySelector(".group-count")?.textContent.trim(),
    labels: [...tr.querySelectorAll(".group-stat-label")].map((n) => n.textContent.trim()),
  }));
  check("party summary row shows structured labels and totals",
    partyGroupSummary.kicker === "Party"
    && partyGroupSummary.name === BIG
    && partyGroupSummary.count === "284 entries"
    && JSON.stringify(partyGroupSummary.labels) === JSON.stringify(["THAN", "NETT THAN", "NAG", "JAWAK", "BALANCE"]),
    JSON.stringify(partyGroupSummary));
  const partyColours = await page.$$eval("#partyTable tbody tr:not(.group):not(.subgroup)", (rows) => ["pending", "partial", "over"].map((k) => [k, rows.filter((r) => r.classList.contains(k)).length]));
  const [state, stateRows] = partyColours.find(([, n]) => n > 0) || ["pending", 0];
  if ((await page.getAttribute("#partyFiltersToggle", "aria-expanded")) !== "true") await page.click("#partyFiltersToggle");
  check("party-wise shows the same colour chips", Number((await page.textContent(`#partyFilters [data-filter="${state}"] .chip-count`)).replace(/,/g, "")) === stateRows && stateRows > 0, JSON.stringify(partyColours));
  await page.click(`#partyFilters [data-filter="${state}"]`);
  await page.waitForFunction((n) => document.getElementById("partyCount").textContent.startsWith(`${n.toLocaleString("en-IN")} of 284 entries`), stateRows);
  check("party-wise colour filter keeps the party and its groups", (await page.$$eval("#partyTable tbody tr:not(.group):not(.subgroup)", (rows, k) => rows.every((r) => r.classList.contains(k)), state)) && (await page.$$("#partyTable tr.group")).length === 1);
  await page.click(`#partyFilters [data-filter="${state}"]`);
  await page.waitForFunction((name) => document.getElementById("partyCount").textContent === `284 entries for ${name}`, BIG);

  // Clicking from Register switches to the edit form.
  const dateBeforeCorrection = await page.inputValue("#entryDate");
  await page.click(".tab[data-view=register]");
  await page.click('#registerFilters [data-filter="warning"]');
  await page.waitForFunction(() => document.getElementById("registerCount").textContent === "985 of 985 entries");
  await page.click("#registerTable tbody tr:first-child td.inward");
  check("register row opens for correction", await page.$eval("#view-entry", (v) => v.classList.contains("active")) && (await page.textContent("#formTitle")).includes("Correcting"));
  check("old row's date shown while correcting", (await page.inputValue("#entryDate")) === "2026-09-26", await page.inputValue("#entryDate"));
  await page.keyboard.press("Escape");
  check("new-entry date restored after cancel", (await page.inputValue("#entryDate")) === dateBeforeCorrection, `${await page.inputValue("#entryDate")} vs ${dateBeforeCorrection}`);
  const dbCount = (await (await page.request.get(`${BASE}/api/info`)).json()).entries;
  check("footer count is live", (await page.textContent("#appInfo")).includes(`${dbCount.toLocaleString("en-IN")} entries`), `${await page.textContent("#appInfo")} vs ${dbCount}`);
  check("footer names the data folder and both files", (await page.textContent("#appInfo")).includes("mph-data.db + config file mph-config.json"), await page.textContent("#appInfo"));

  // An all-zero slip asks first, can be taken back, and then saves without a finish.
  await page.click(".tab[data-view=entry]");
  await page.fill("#party", BIG);
  await page.fill("#designNo", "INW 983");
  await page.fill("#than", "0");
  await page.fill("#finish", "");
  // Toasts of earlier steps may still be fading out: only a new one would mean this save went through.
  await page.$$eval("#toasts .toast", (toasts) => toasts.forEach((t) => { t.dataset.before = "1"; }));
  const entriesBeforeZero = (await (await page.request.get(`${BASE}/api/info`)).json()).entries;
  await page.click("#saveButton");
  await page.waitForSelector("#appDialog[open]");
  check("all-zero save asks first", (await page.textContent("#appDialogTitle")) === "Save an all-zero entry?", await page.textContent("#appDialogTitle"));
  await page.click("#appDialogCancel");
  await page.waitForTimeout(500);
  const newToasts = await page.$$eval("#toasts .toast:not([data-before])", (toasts) => toasts.map((t) => t.textContent));
  const entriesAfterZero = (await (await page.request.get(`${BASE}/api/info`)).json()).entries;
  check("going back saves nothing and keeps the form", (await page.inputValue("#party")) === BIG && entriesAfterZero === entriesBeforeZero
    && !newToasts.some((t) => t.includes("Saved")), `party=${await page.inputValue("#party")} entries ${entriesBeforeZero}→${entriesAfterZero} new toasts=${JSON.stringify(newToasts)}`);
  await page.click("#saveButton");
  await page.click("#appDialogConfirm");
  await page.waitForFunction(() => document.getElementById("toasts").textContent.includes("all zero"));
  check("all-zero slip saved and shown faded", (await page.textContent("#toasts")).includes("all zero (slip number only)")
    && (await page.$eval("#recentTable tbody tr:first-child", (r) => r.classList.contains("allZero") && !r.classList.contains("has-warning"))), await page.textContent("#toasts"));

  await page.screenshot({ path: "/tmp/mph-ui-entry.png" });
  await page.click(".tab[data-view=register]");
  // The Register Month is a multi-select: only tick October if an earlier step has not already.
  if (!(await page.locator("#registerViewMonth").evaluate((control) => control.values)).includes("2026-10")) await chooseDropdown(page.locator("#registerViewMonth"), "2026-10");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/mph-ui-register.png" });

  const unexpectedConsole = consoleErrors.filter((m) => !m.includes("status of 400"));
  check("no browser console errors", unexpectedConsole.length === 0, unexpectedConsole.join(" | "));
  check("only HTTP error is the deliberate rejected save", JSON.stringify(badResponses) === JSON.stringify(["400 POST /api/entries"]), badResponses.join(" | "));
  await browser.close();

  console.log(`PASSED ${passed}`);
  if (failures.length) {
    console.log(`FAILED ${failures.length}`);
    failures.forEach((f) => console.log("  " + f));
    process.exit(1);
  }
  console.log("PASS: real-browser keyboard entry, search, correction, dispatch, register and party-wise checks");
})().catch((e) => { console.error(e); process.exit(1); });
