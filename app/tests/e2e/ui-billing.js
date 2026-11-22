// Real Edge: Masters + Bills screens, the way the operator uses them.
const { chromium } = require("playwright-core");
const { chooseDropdown, dropdownValue } = require("./dropdown-helpers");
const { load } = require("./private-data");

const { P, GSTIN, FIRM, workbooks } = load();
// Typed into search boxes the way the operator does: the first word, lower case.
const firstWord = (name) => name.split(/[\s.]+/)[0].toLowerCase();
const BASE = process.env.BASE || "http://127.0.0.1:5152";
let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => (ok ? passed++ : failures.push(`${name}${detail ? ` — ${detail}` : ""}`));

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const consoleErrors = [];
  // Edit windows are modal: close the open one (Escape) before using the page behind it.
  const closeWindow = async () => {
    for (let i = 0; i < 4 && (await page.$("dialog[open]")); i++) {
      if (await page.$("#appDialog[open]")) await page.click("#appDialogConfirm");
      else await page.keyboard.press("Escape");
      await page.waitForTimeout(50);
    }
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  };
  const bad = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  page.on("response", (r) => r.status() >= 400 && bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`));
  page.on("dialog", (d) => { consoleErrors.push(`unexpected browser dialog: ${d.message()}`); d.dismiss(); });

  await page.goto(BASE);
  await page.waitForFunction(() => document.getElementById("inwardNo").value !== "");

  // ---------- Masters: parties ----------
  await page.click(".tab[data-view=masters]");
  await page.waitForFunction(() => document.querySelectorAll("#partyMasterTable tbody tr").length > 0);
  check("party list shows active parties", (await page.textContent("#partyMasterCount")).includes("of 158 parties"), await page.textContent("#partyMasterCount"));
  await page.check("#onlyPartyProblems");
  const problemRows = await page.$$eval("#partyMasterTable tbody tr td:first-child", (t) => t.map((x) => x.textContent));
  check("problem filter shows the party with a bad GSTIN", problemRows.includes(P.badGstinParty), problemRows.slice(0, 8).join(","));
  await page.uncheck("#onlyPartyProblems");
  await page.fill("#partySearch", firstWord(P.styledParty));
  await page.click("#partyMasterTable tbody tr:first-child");
  await page.waitForSelector("#partyDrawer[open]");
  await page.waitForTimeout(400);
  const drawerBox = await page.$eval("#partyDrawer", (d) => { const r = d.getBoundingClientRect(); return { right: r.right, top: r.top, height: r.height, width: r.width, page: document.documentElement.clientWidth, tall: innerHeight }; });
  check("party opens in its own window at the right, full height", Math.abs(drawerBox.right - drawerBox.page) <= 1 && drawerBox.top === 0 && Math.abs(drawerBox.height - drawerBox.tall) <= 1 && drawerBox.width < drawerBox.page / 2 + 100, JSON.stringify(drawerBox));
  check("edit form loads party", (await page.inputValue("#pf-name")) === P.styledParty && (await page.inputValue("#pf-discount")) !== "");
  const partyStyle = await dropdownValue(page.locator("#pf-style"));
  check("billing style loaded", partyStyle === "LOT, same lot on one line (15+28), sorted by number" && (await page.textContent("#pf-style-text")).includes("same lot"), partyStyle);
  const billAs = await page.$$eval("#partyForm .map-table [data-dropdown]", (controls) => controls.map((x) => x.value).join(">"));
  check("bill-as finish loaded (SGZ → SGJ)", billAs === "SGZ>SGJ", billAs);
  const rateRows = await page.$$eval("#rateTable tbody tr", (rows) => rows.map((r) => r.dataset.finish));
  const sgjRate = await page.textContent('#rateTable tr[data-finish="SGJ"] td.num');
  check("rates table lists only the finishes with a rate", sgjRate === "₹87.00" && rateRows.length === 8 && !rateRows.includes("SGZ"), `${sgjRate} ${rateRows.join(",")}`);
  await page.fill("#pf-gstin", "08ABCDE1234F1ZX");
  check("GSTIN check shown while typing", (await page.textContent("#partyForm .hint.bad")).includes("not a valid"));
  await page.click("#pf-save");
  await page.waitForFunction(() => document.querySelector("#partyForm .form-message").classList.contains("err"));
  check("invalid GSTIN blocked with message", (await page.textContent("#partyForm .form-message")).includes("not valid"));
  await page.keyboard.press("Escape");
  await page.waitForSelector("#appDialog[open]");
  check("unsaved drawer shows custom confirmation modal", (await page.textContent("#appDialogBody")).includes("Close without saving"));
  await page.click("#appDialogCancel");
  await page.waitForFunction(() => !document.querySelector("#appDialog[open]"));
  check("keeping changes leaves the drawer open", Boolean(await page.$("#partyDrawer[open]")));
  await page.keyboard.press("Escape");
  await page.waitForSelector("#appDialog[open]");
  await page.click("#appDialogConfirm");
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  check("closing the window drops the unsaved GSTIN", !(await page.$("#partyDrawer[open]")));
  await page.click("#partyMasterTable tbody tr:first-child");
  await page.waitForSelector("#partyDrawer[open]");
  check("reopened party still has its saved GSTIN", (await page.inputValue("#pf-gstin")) !== "08ABCDE1234F1ZX");
  await page.click('#rateTable tr[data-finish="SGJ"] .rate-edit');
  await page.fill("#rate-value", "87.5");
  await page.press("#rate-value", "Enter");
  await page.waitForFunction(() => document.getElementById("toasts").textContent.includes("Saved"));
  check("rate edited in the table and saved at once", (await page.textContent('#rateTable tr[data-finish="SGJ"] td.num')) === "₹87.50");
  await page.click('#rateTable tr[data-finish="SGJ"] .rate-edit');
  await page.fill("#rate-value", "87");
  await page.click("#rate-save");
  await page.waitForFunction(() => document.querySelector('#rateTable tr[data-finish="SGJ"] td.num')?.textContent === "₹87.00");
  await page.click("#addRate");
  await chooseDropdown(page.locator("#rate-finish"), "SGZ");
  await page.fill("#rate-value", "86");
  await page.click("#rate-save");
  await page.waitForSelector('#rateTable tr[data-finish="SGZ"]');
  check("rate added from the table", (await page.$$("#rateTable tbody tr")).length === 9);
  await page.click('#rateTable tr[data-finish="SGZ"] .rate-delete');
  await page.waitForSelector("#appDialog[open]");
  check("deleting a rate uses custom confirmation modal", (await page.textContent("#appDialogBody")).includes("SGZ"));
  await page.click("#appDialogConfirm");
  await page.waitForFunction(() => !document.querySelector('#rateTable tr[data-finish="SGZ"]'));
  check("rate deleted from the table", (await page.$$("#rateTable tbody tr")).length === 8 && (await page.textContent("#toasts")).includes("Deleted"));

  await closeWindow();
  await page.fill("#partySearch", "");
  await page.click("#addParty");
  await page.waitForSelector("#partyDrawer[open]");
  check("new party: rates wait until it is added", (await page.textContent("#pf-rates")).includes("Add the party first"));
  await page.fill("#pf-name", "UI TEST PARTY");
  await page.fill("#pf-discount", "10");
  await page.click("#pf-save");
  await page.waitForFunction(() => document.getElementById("toasts").textContent.includes("Saved"));
  await page.click("#addRate");
  await chooseDropdown(page.locator("#rate-finish"), "SGZ");
  await page.fill("#rate-value", "90");
  await page.press("#rate-value", "Enter");
  await page.waitForSelector('#rateTable tr[data-finish="SGZ"]');
  await page.click("#pf-toggle");
  await page.waitForFunction(() => document.querySelector("#pf-toggle") && document.querySelector("#pf-toggle").textContent === "Mark active");
  check("add party, give it a rate, then mark inactive", true);
  await closeWindow();
  await page.check("#showInactiveParties");
  await page.fill("#partySearch", "ui test");
  check("inactive party shown greyed", await page.$eval("#partyMasterTable tbody tr", (tr) => tr.classList.contains("inactive")));

  // ---------- Masters: billing styles (hidden by default; enable from Settings via right-side menu) ----------
  check("billing styles subsection is hidden by default", await page.$eval(".subtab[data-sub=styles]", (b) => b.classList.contains("hidden")));
  check("firm and bill settings is no longer a Masters subtab", !(await page.$(".subtab[data-sub=firm]")));

  // ---------- Right-side menu: language, theme, settings & feature toggles ----------
  await page.click("#menuToggle");
  await page.waitForSelector("#sideMenu[open]");
  await page.waitForTimeout(300);
  const menuBox = await page.$eval("#sideMenu", (d) => { const r = d.getBoundingClientRect(); return { right: r.right, top: r.top, height: r.height, page: document.documentElement.clientWidth, tall: innerHeight }; });
  check("right-side menu opens at the right edge, full height", Math.abs(menuBox.right - menuBox.page) <= 1 && menuBox.top === 0 && Math.abs(menuBox.height - menuBox.tall) <= 1, JSON.stringify(menuBox));
  check("right-side menu has Hindi/English, Light/Dark and Settings", (await page.isVisible("#langEn")) && (await page.isVisible("#langHi")) && (await page.isVisible("#themeLight")) && (await page.isVisible("#themeDark")) && (await page.isVisible("#menuSettings")));

  await page.click("#langHi");
  await page.waitForFunction(() => document.documentElement.dataset.lang === "hi" && document.getElementById("langHi").getAttribute("aria-pressed") === "true");
  check("Hindi switch in right-side menu translates UI", (await page.textContent("#sideMenuTitle")) === "मेन्यू");
  await page.click("#langEn");
  await page.waitForFunction(() => document.documentElement.dataset.lang === "en" && document.getElementById("langEn").getAttribute("aria-pressed") === "true");

  await page.click("#menuSettings");
  await page.waitForSelector("#view-settings.active #firm-name");
  check("Settings opens from right-side menu and closes menu", !(await page.$("#sideMenu[open]")));
  check("firm settings loaded", (await page.inputValue("#firm-name")) === FIRM.name && (await page.inputValue("#rule-totalMustStayBelow")) === "200000"
    && (await page.textContent("#rule-limit-hint")) === "= ₹2,00,000.00" && (await page.inputValue("#firm-next")) === "279");
  check("rows per bill hint gives the paper limit", /Up to \d+ fit on Letter, \d+ on A4/.test(await page.textContent("#rule-rows-hint")), await page.textContent("#rule-rows-hint"));
  check("config file path shown", (await page.textContent("#config-file")).includes("mph-config.json"));
  check("billing styles feature checkbox is unchecked by default", !(await page.isChecked("#feature-billing-styles")));

  // Enable Billing styles in Settings and verify it appears under Masters.
  await page.check("#feature-billing-styles");
  await page.click("#firm-save");
  await page.waitForFunction(() => document.getElementById("toasts").textContent.includes("Settings saved"));
  await page.click(".tab[data-view=masters]");
  check("enabling billing styles in Settings unhides the Masters subsection", !(await page.$eval(".subtab[data-sub=styles]", (b) => b.classList.contains("hidden"))));

  await page.click(".subtab[data-sub=styles]");
  await page.waitForFunction(() => document.querySelectorAll("#styleTable tbody tr").length === 12);
  const styleLabels = await page.$$eval("#styleTable tbody tr td:first-child", (cells) => cells.map((c) => c.textContent));
  check("billing styles name the parties that use them", styleLabels.every((t) => /\(.+\)$/.test(t)) && styleLabels.some((t) => /\+\d+ more\)$/.test(t)), styleLabels.join(" | "));
  await page.click('#styleTable tbody tr[data-style="D.N. + LOT"]');
  await page.waitForSelector("#sf-preview table");
  check("style form shows a preview made by the bill maker", (await page.$$("#sf-preview tbody tr")).length >= 3 && (await page.textContent("#sf-preview")).includes("12409"));
  await chooseDropdown(page.locator("#sf-lines"), "sameLot");
  await page.check("#sf-breakdown");
  await page.waitForFunction(() => document.getElementById("sf-preview").textContent.includes("+"));
  check("preview follows the style being edited", true);
  check("style in use cannot be deleted", await page.isDisabled("#sf-delete"));
  await closeWindow();

  // Hide Billing styles again and verify it disappears.
  await page.click("#menuToggle");
  await page.waitForSelector("#sideMenu[open]");
  await page.click("#menuSettings");
  await page.waitForSelector("#feature-billing-styles");
  await page.uncheck("#feature-billing-styles");
  await page.click("#firm-save");
  await page.waitForFunction(() => document.getElementById("toasts").textContent.includes("Settings saved"));
  await page.click(".tab[data-view=masters]");
  check("disabling billing styles hides the subsection and returns to Parties", (await page.$eval(".subtab[data-sub=styles]", (b) => b.classList.contains("hidden"))) && (await page.$eval("#masters-parties", (v) => v.classList.contains("active"))));

  // ---------- Masters: finishes and colours ----------
  await page.click(".subtab[data-sub=finishes]");
  await page.waitForFunction(() => document.querySelectorAll("#finishMasterTable tbody tr").length > 20);
  check("finish list with groups", await page.$$eval("#finishMasterTable tbody tr", (rows) => rows.some((r) => r.cells[0].textContent === "SMG" && r.cells[2].textContent === "SGZ")));
  check("group list", (await page.$$("#groupMasterTable tbody tr")).length === 11);
  const finishBox = await page.$eval("#finishTableWrap", (w) => ({ bottom: w.getBoundingClientRect().bottom, height: innerHeight }));
  check("finish table fills the screen height", finishBox.bottom > finishBox.height - 60 && finishBox.bottom <= finishBox.height, JSON.stringify(finishBox));
  await page.click(".subtab[data-sub=colors]");
  await page.waitForFunction(() => document.querySelectorAll("#colorTable tbody tr").length === 33);
  check("colour list comes from the config file", (await page.textContent('#colorTable tr[data-color="dark blue"]')).includes("#00008b"));

  // ---------- Dark mode via right-side menu: kept in the config file ----------
  await page.click("#menuToggle");
  await page.waitForSelector("#sideMenu[open]");
  await page.click("#themeDark");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark" && document.getElementById("themeDark").getAttribute("aria-pressed") === "true");
  await page.waitForTimeout(500);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.getElementById("inwardNo").value !== "");
  check("dark mode survives a reload (read back from the config file)", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  await page.click("#menuToggle");
  await page.waitForSelector("#sideMenu[open]");
  await page.click("#themeLight");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light" && document.getElementById("themeLight").getAttribute("aria-pressed") === "true");
  await closeWindow();
  await page.waitForTimeout(300);

  // ---------- Bills: make ----------
  await page.click(".tab[data-view=bills]");
  check("Bills starts with a clear empty state and a disabled action", (await page.textContent("#candidateHead")).includes("Who are you billing?") && await page.isDisabled("#makeBills"));
  await page.fill("#billMonth", "2026-10");
  await page.dispatchEvent("#billMonth", "change");
  await page.waitForFunction(() => document.querySelectorAll("#toBillList li").length > 5);
  check("bill dates follow the month", (await page.inputValue("#billDate")) === "2026-10-31" && (await page.inputValue("#periodFrom")) === "2026-10-01");
  const toBill = await page.$$eval("#toBillList .pick-name", (n) => n.map((x) => x.textContent));
  check("parties to bill listed", toBill.includes(P.twoBillParty) && toBill.includes(P.bigParty), toBill.length + "");
  check("party choices are real keyboard-accessible buttons", (await page.$$("#toBillList button.party-choice")).length === toBill.length);
  await page.fill("#billParty", firstWord(P.twoBillParty));
  check("typing filters the party list immediately", (await page.$$("#toBillList .pick-name")).length === 1 && (await page.textContent("#toBillList")).includes(P.twoBillParty));
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll("#candidateTable tbody tr").length > 30);
  const twoBillHead = await page.textContent("#candidateHead");
  check("compact party header shows discount without billing style", !twoBillHead.includes("Billing style") && twoBillHead.includes("Discount") && twoBillHead.includes(GSTIN.twoBillParty) && !(await page.$("#candidateHead .bill-party-status")), twoBillHead);
  check("party search clears after choosing so all parties remain available", (await page.inputValue("#billParty")) === "" && (await page.$$("#toBillList .pick-name")).length === toBill.length);
  check("chosen party is identified accessibly", (await page.textContent('#toBillList button[aria-current="true"]')).includes(P.twoBillParty));
  check("GSTIN is available on demand rather than crowding the entry list", !(await page.$eval(".bill-party-details", (d) => d.open)));
  await page.click(".bill-party-details summary");
  check("party details disclosure shows GSTIN", await page.isVisible(".bill-gstin"));
  await page.click(".bill-party-details summary");
  check("extra columns are hidden by default", !(await page.isVisible('#candidateTable th.bill-extra-column')));
  await page.click("#billMoreColumns");
  check("extra columns can be shown for detailed checks", (await page.getAttribute("#billMoreColumns", "aria-pressed")) === "true" && await page.isVisible('#candidateTable th.bill-extra-column'));
  await page.click("#billMoreColumns");
  const octoberDates = await page.$$eval("#candidateTable tbody tr td:nth-child(4)", (cells) => cells.map((c) => c.textContent));
  check("October period lists only the party's slips dated in October", octoberDates.length === 35 && octoberDates.every((d) => d.endsWith("/Oct/26")), `${octoberDates.length}: ${[...new Set(octoberDates.map((d) => d.slice(3)))].join(",")}`);
  // Excel's October bills took the whole October register: inward from 26 Sep plus 2 slips carried over from 25 Sep.
  await page.fill("#periodFrom", "2026-09-25");
  await page.dispatchEvent("#periodFrom", "change");
  await page.waitForFunction(() => document.querySelectorAll("#candidateTable tbody tr").length === 41);
  await page.waitForFunction(() => document.querySelector("#toBillList li.current")?.textContent.includes("41 entries"));
  check("moving Period from back adds the September slips to the list and the party count", true);
  const counts = await page.$$eval("#candidateTable .cand", (b) => ({ all: b.length, ticked: b.filter((x) => x.checked).length }));
  check("dispatched-only party: undispatched entries unticked", counts.all === 41 && counts.ticked === 37, JSON.stringify(counts));
  check("fixed action bar shows selected quantity and count", (await page.textContent("#billSelectedCount")) === "37 of 41 entries selected" && (await page.textContent("#billSelectedThan")) === "2,709 THAN");
  check("select-all reflects a partial selection", await page.$eval("#candAll", (box) => box.indeterminate && !box.checked));
  await page.check("#candAll");
  check("select-all selects every entry and reports checked state", (await page.$eval("#candAll", (box) => box.checked && !box.indeterminate)) && (await page.$$eval("#candidateTable .cand", (boxes) => boxes.every((box) => box.checked))));
  await page.click("#candNone");
  check("clearing selection resets totals, checkbox, and action", await page.isDisabled("#makeBills") && (await page.textContent("#billSelectedThan")) === "0 THAN" && (await page.$eval("#candAll", (box) => !box.checked && !box.indeterminate)));
  await page.locator('#toBillList button[aria-current="true"]').press("Enter");
  await page.waitForFunction(() => document.getElementById("billSelectedCount").textContent === "37 of 41 entries selected");

  // On a 1366x768 laptop, once the one-time notes about the data folder are hidden like the operator does.
  if (await page.isVisible("#noticeBar")) await page.locator("#noticeBar button", { hasText: "Hide" }).click();
  await page.setViewportSize({ width: 1366, height: 768 });
  const workspaceBox = await page.evaluate(() => {
    const rect = document.getElementById("makeBills").getBoundingClientRect();
    const table = document.getElementById("candidateWrap").getBoundingClientRect();
    return { actionVisible: rect.top >= 0 && rect.bottom <= innerHeight, tableHeight: table.height, noPageOverflow: document.documentElement.scrollWidth <= innerWidth };
  });
  check("Make bills stays visible without scrolling at 1366x768", workspaceBox.actionVisible && workspaceBox.noPageOverflow && workspaceBox.tableHeight >= 200, JSON.stringify(workspaceBox));
  await page.$eval("#candidateWrap", (wrap) => { wrap.scrollTop = wrap.scrollHeight; });
  check("table scrolling leaves the action visible", await page.$eval("#makeBills", (button) => button.getBoundingClientRect().bottom <= innerHeight));
  await page.setViewportSize({ width: 900, height: 800 });
  check("tablet layout keeps the action visible without page overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById("makeBills").getBoundingClientRect().bottom <= innerHeight));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#makeBills").scrollIntoViewIfNeeded();
  check("narrow layout leaves room for entries and keeps controls reachable", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById("makeBills").getBoundingClientRect().bottom <= innerHeight && document.getElementById("candidateWrap").clientHeight >= 130));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.$eval("#bills-make", (view) => { view.scrollTop = 0; });

  await page.click("#makeBills");
  await page.waitForSelector(".draft");
  const drafts = await page.$$eval(".draft h2", (h) => h.map((x) => x.textContent));
  check("2 draft bills like Excel", drafts.length === 2 && drafts.every((t) => t.includes(P.twoBillParty)), drafts.join(" / "));
  check("draft totals match Excel bills (1,37,757 + 86,242)", drafts[0].includes("₹1,37,757.00") && drafts[1].includes("₹86,242.00"), drafts.join(" / "));
  check("amount in words shown", (await page.textContent(".draft .words")).startsWith("Rupees One Lakh Thirty Seven Thousand"));
  check("drafts replace the table and the save action is outside the scroll pane", !(await page.isVisible("#candidateWrap")) && await page.isVisible("#saveBills") && await page.$eval("#saveBills", (button) => button.closest(".bill-action-dock") !== null));
  await page.click("#discardBills");
  check("back to entries preserves selection without saving", await page.isVisible("#candidateWrap") && !(await page.$(".draft")) && (await page.textContent("#billSelectedCount")) === "37 of 41 entries selected");
  await page.click("#makeBills");
  await page.waitForSelector(".draft");
  await page.fill("#billDate", "2026-10-30");
  await page.dispatchEvent("#billDate", "change");
  check("changing bill date invalidates the old preview", !(await page.$(".draft")) && await page.isVisible("#candidateWrap") && !(await page.isVisible("#saveBills")));
  await page.fill("#billDate", "2026-10-31");
  await page.dispatchEvent("#billDate", "change");
  await page.click("#makeBills");
  await page.waitForSelector(".draft");

  // Edit a draft: change a rate, totals recompute.
  const rateBox = () => page.locator(".draft").first().locator("tr.k-priced .g-rate").first();
  await rateBox().fill("91");
  await rateBox().dispatchEvent("change");
  await page.waitForFunction(() => !document.querySelector(".draft h2").textContent.includes("1,37,757"));
  check("editing rate recomputes", (await page.textContent(".draft h2")).includes("₹1,39,287.00"), await page.textContent(".draft h2"));
  await rateBox().fill("90");
  await rateBox().dispatchEvent("change");
  await page.waitForFunction(() => document.querySelector(".draft h2").textContent.includes("1,37,757"));

  await page.click("#saveBills");
  await page.waitForFunction(() => document.getElementById("toasts").textContent.includes("Saved"));
  check("saved with numbers 279 and 280", (await page.textContent("#toasts")).includes("26-27\\JOB\\279, 26-27\\JOB\\280"), await page.textContent("#toasts"));
  await page.waitForFunction(() => document.querySelectorAll("#candidateTable .cand").length === 4);
  check("billed entries leave the list (4 undelivered left)", true);

  // Print view: drawn on the Excel bill grid (Letter, workbook margins, Indian digit grouping, exact Excel words).
  const [printPage] = await Promise.all([context.waitForEvent("page"), page.click("#printSaved")]);
  await printPage.addInitScript(() => { window.print = () => { window.__printed = true; }; });
  await printPage.waitForLoadState();
  await printPage.waitForFunction(() => document.body.dataset.ready === "1" && document.querySelectorAll(".sheet").length === 2, null, { timeout: 15000 });
  const printed = await printPage.$$eval(".sheet", (bills) => bills.map((b) => b.innerText.replace(/[ \t]+/g, " ")));
  check("print: firm header", printed[0].includes(FIRM.name) && printed[0].includes(`GSTN-${FIRM.gstin}`) && printed[0].includes("TAX INVOICE"));
  check("print: bill number, date, period", printed[0].includes("26-27\\JOB\\279") && printed[0].includes("31.10.26") && printed[0].includes("25.09.26 TO 31.10.26"));
  check("print: party block", printed[0].includes(P.twoBillParty) && printed[0].includes(`GSTIN: ${GSTIN.twoBillParty}`));
  check("print: totals and words", printed[0].includes("₹1,49,940.00") && printed[0].includes("₹18,743.00") && printed[0].includes("₹1,37,757.00") && printed[0].includes("Rupees One Lakh Thirty Seven Thousand Seven Hundred Fifty Seven Only"), printed[0].slice(-700));
  const words = await printPage.$$eval(".sheet:first-of-type .xc", (cells) => cells.map((c) => c.textContent).find((t) => t.includes("Rupees")));
  check("print: words exactly as the Excel macro writes them", words === " Rupees  One Lakh Thirty Seven Thousand  Seven Hundred Fifty Seven Only", JSON.stringify(words));
  check("print: bank and terms", printed[0].includes(FIRM.bankLine1) && printed[0].includes(`Subject to ${FIRM.jurisdiction} Jurisdiction only.`));
  const grid = await printPage.$eval(".sheet .area", (a) => [a.offsetWidth, a.offsetHeight]);
  check("print: Excel grid size (645 px × 744.25 pt)", grid[0] === 645 && Math.abs(grid[1] - 992) <= 1, grid.join("x"));
  const thick = await printPage.$$eval(".sheet:first-of-type .area > div:not(.xc)", (lines) => lines.filter((l) => l.style.height === "3px" || l.style.width === "3px").length);
  check("print: thick black box around priced THAN cells", thick >= 4, String(thick));
  await printPage.emulateMedia({ media: "print" });
  const printHeights = await printPage.$$eval(".sheet", (bills) => bills.map((b) => b.getBoundingClientRect().height));
  check("print: each bill fits one Letter page", printHeights.every((h) => h <= 996), printHeights.map(Math.round).join(","));
  await printPage.screenshot({ path: "/tmp/mph-ui-print.png", fullPage: false });
  const pdf = await printPage.pdf({ format: "Letter", printBackground: true, preferCSSPageSize: true });
  require("fs").writeFileSync("/tmp/mph-bills.pdf", pdf);
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  check("print: PDF has one page per bill", pages === 2, String(pages));
  await printPage.close();

  // Save as PDF from the app (headless Edge on the server side).
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#pdfSaved")]);
  const pdfPath = await download.path();
  const appPdf = require("fs").readFileSync(pdfPath);
  check("app PDF: two Letter pages", appPdf.toString("latin1").startsWith("%PDF") && (appPdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length === 2 && appPdf.toString("latin1").includes("612 792"), download.suggestedFilename());

  check("app PDF: named party_fy_month_Jobnumber", /^.+_\d{2}-\d{2}_[A-Z][a-z]{2}_Job\d+_and_1_more\.pdf$/.test(download.suggestedFilename()), download.suggestedFilename());

  await page.locator("#toBillList li", { hasText: P.bigParty }).click();
  await page.waitForFunction((name) => document.querySelector("#candidateHead h2")?.textContent === name, P.bigParty);
  const bigHead = await page.textContent("#candidateHead");
  check("bill-before-dispatch is explained without a large banner", !bigHead.includes("Billing style") && bigHead.includes("19.75%") && bigHead.includes(GSTIN.bigParty) && (await page.textContent("#candidateHint")).startsWith("Unsent entries are included."), bigHead);

  // Saved bills: edit + cancel
  await page.click(".subtab[data-sub=saved]");
  await page.waitForFunction(() => document.querySelectorAll("#invoiceTable tbody tr").length === 2);
  check("saved bill list totals", (await page.textContent("#savedTotals")).includes("₹2,23,999.00"), await page.textContent("#savedTotals"));
  await page.click("#invoiceTable tbody tr:nth-child(2)");
  await page.waitForSelector("#invoiceDrawer[open] #ie-save");
  await page.fill("#ie-notes", "checked by UI test");
  await page.click("#ie-save");
  await page.waitForFunction(() => document.getElementById("toasts").textContent.includes("Saved"));
  check("edit saved bill", true);
  await page.click("#ie-cancel");
  await page.waitForSelector("#appDialog[open]");
  check("cancel bill opens custom confirmation modal", (await page.textContent("#appDialogBody")).includes("CANCELLED"));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("#appDialog[open]"));
  check("Escape dismisses custom modal without closing the bill drawer", Boolean(await page.$("#invoiceDrawer[open]")));
  await page.click("#ie-cancel");
  await page.waitForSelector("#appDialog[open]");
  await page.click("#appDialogCancel");
  await page.waitForFunction(() => !document.querySelector("#appDialog[open]"));
  check("keeping the bill leaves it active", !(await page.textContent("#invoiceEditor h2")).includes("CANCELLED"));
  await page.click("#ie-cancel");
  await page.waitForSelector("#appDialog[open]");
  await page.click("#appDialogConfirm");
  await page.waitForFunction(() => document.querySelector("#invoiceEditor h2").textContent.includes("CANCELLED"));
  check("cancel bill", (await page.textContent("#invoiceTable")).includes("CANCELLED"));
  await closeWindow();

  // Register shows bill number
  await page.click(".tab[data-view=register]");
  await chooseDropdown(page.locator("#registerViewMonth"), "2026-10");
  await page.waitForFunction(() => document.getElementById("registerCount").textContent.startsWith("985"));
  const billCol = await page.$$eval("#registerTable tbody tr", (rows) => rows.filter((r) => [...r.cells].some((c) => c.textContent === "26-27\\JOB\\279")).length);
  check("register shows bill number on billed entries", billCol === 24, String(billCol));
  if ((await page.getAttribute("#registerFiltersToggle", "aria-expanded")) !== "true") await page.click("#registerFiltersToggle");
  await page.click('#registerFilters [data-filter="billNo"]');
  await page.waitForFunction(() => document.getElementById("registerCount").textContent.startsWith("24 of 985"));
  const billedRows = await page.$$eval("#registerTable tbody tr", (rows) => rows.map((r) => [...r.cells].some((c) => c.textContent === "26-27\\JOB\\279")));
  check("Bill no. filter shows exactly the rows on saved bills (cancelled bill 280 not counted)", billedRows.length === 24 && billedRows.every(Boolean), String(billedRows.length));
  await page.click('#registerFilters [data-filter="billNo"]');
  await page.waitForFunction(() => document.getElementById("registerCount").textContent.startsWith("985 of 985"));

  // Import Excel → Bills (the Excel bill import sits with the inward import, not under Bills): check only (dry run)
  await page.click(".tab[data-view=bills]");
  const billSubtabs = await page.$$eval(".subtabs[data-group=bills] .subtab", (b) => b.map((x) => x.dataset.sub).join(","));
  check("Bills tab has only Make bills and Saved bills", billSubtabs === "make,saved" && !(await page.$("#view-bills #billImportFile")), billSubtabs);
  await page.click(".tab[data-view=import]");
  const importSubtabs = await page.$$eval(".subtabs[data-group=import] .subtab", (b) => b.map((x) => x.dataset.sub).join(","));
  check("Import Excel tab has Inward register and Bills", importSubtabs === "inward,bills" && (await page.isVisible("#importFile")), importSubtabs);
  await page.click(".subtabs[data-group=import] .subtab[data-sub=bills]");
  check("bill import shown under Import Excel", (await page.isVisible("#import-bills #billImportFile")) && !(await page.isVisible("#importFile")));
  await page.setInputFiles("#billImportFile", require("path").join(workbooks, "MPH BILL--OCT.-26-27.xlsm"));
  await page.click("#billImportCheck");
  await page.waitForSelector("#billImportResult .report");
  const report = await page.textContent("#billImportResult");
  check("bill import refuses bills already made in the app", report.includes("already billed in the app") && report.includes("Problems found"), report.slice(0, 200));

  // Import Excel → Inward register: checking a month already in the app compares the workbook with its saved entries (dry run).
  await page.click(".subtabs[data-group=import] .subtab[data-sub=inward]");
  await page.setInputFiles("#importFile", require("path").join(workbooks, "INWARD REG.-OCT.-26-27.xlsm"));
  await page.click("#previewImport");
  await page.waitForSelector("#importResult .report");
  const inwardReport = await page.textContent("#importResult");
  check("inward check of an imported month compares with its saved entries",
    inwardReport.includes("Entries already saved") && inwardReport.includes("This exact file was already imported") && !inwardReport.includes("Import into an empty month")
      && (await page.isDisabled("#runImport")), inwardReport.slice(0, 300));

  // Bills changed while another tab shows (as after an Excel bill import) appear on coming back to an open Saved bills list.
  const liveBill = await page.$eval("#invoiceTable tbody tr:not(.inactive)", (r) => r.dataset.id);
  await page.evaluate((id) => api(`/api/invoices/${id}/cancel`, { method: "POST" }), liveBill);
  await page.click(".tab[data-view=bills]");
  const reread = await page.waitForFunction(() => document.querySelectorAll("#invoiceTable tbody tr.inactive").length === 2, null, { timeout: 5000 }).then(() => true, () => false);
  check("Saved bills list read again on coming back to Bills", reread, await page.textContent("#savedCount"));

  // A slow or failed request must never leave the previous party's entries actionable.
  await page.click(".subtabs[data-group=bills] .subtab[data-sub=make]");
  // Parties' entries are fetched ahead of time, so the cache is dropped to make the click ask the (failing) server.
  const unavailable = (route) => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ errors: ["Test: entries are unavailable."] }),
  });
  await page.route("**/api/billing/candidates?**", unavailable);
  await page.evaluate(() => clearBillCache());
  await page.locator("#toBillList button", { hasText: P.bigParty }).click();
  await page.waitForFunction(() => document.getElementById("billMessage").textContent.includes("Test: entries are unavailable."));
  const failedLoad = { stale: Boolean(await page.$("#candidateTable .cand")), makeDisabled: await page.isDisabled("#makeBills"), count: await page.textContent("#billSelectedCount") };
  check("failed party load clears stale entries and disables Make bills", !failedLoad.stale && failedLoad.makeDisabled && failedLoad.count === "No entries loaded", JSON.stringify(failedLoad));
  await page.unroute("**/api/billing/candidates?**", unavailable);
  await page.locator("#toBillList button", { hasText: P.bigParty }).click();
  await page.waitForSelector(".bill-party-header");
  check("failed party load can be retried", !(await page.isDisabled("#makeBills")));

  let releaseBuild;
  let startedBuild;
  const buildStarted = new Promise((resolve) => { startedBuild = resolve; });
  const delayedBuild = async (route) => {
    const response = await route.fetch();
    const gate = new Promise((resolve) => { releaseBuild = resolve; });
    startedBuild();
    await gate;
    await route.fulfill({ response });
  };
  await page.route("**/api/billing/build", delayedBuild);
  await page.click("#makeBills");
  await buildStarted;
  check("Make bills is disabled while building", await page.isDisabled("#makeBills"));
  await page.locator("#toBillList button", { hasText: P.twoBillParty }).press("Enter");
  await page.waitForFunction((name) => document.querySelector(".bill-party-identity h2")?.textContent === name, P.twoBillParty);
  const delivered = page.waitForResponse((response) => response.url().endsWith("/api/billing/build"));
  releaseBuild();
  await (await delivered).finished();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  check("late build response cannot overwrite a newly selected party", !(await page.$(".draft")) && await page.isVisible("#candidateWrap") && (await page.textContent(".bill-party-identity h2")) === P.twoBillParty);
  await page.unroute("**/api/billing/build", delayedBuild);

  // One switch hides both Excel imports.
  await page.evaluate(async () => { const s = await api("/api/settings"); await api("/api/settings", { method: "PUT", json: { display: { ...s.display, showExcelImport: false } } }); });
  await page.click(".tab[data-view=register]");
  const hidden = await page.waitForFunction(() => document.querySelector(".tab[data-view=import]").classList.contains("hidden"), null, { timeout: 5000 }).then(() => true, () => false);
  check("hiding the Excel import screens hides the Import Excel tab", hidden);

  const unexpected = consoleErrors.filter((m) => !m.includes("status of 400") && !m.includes("status of 503"));
  check("no browser errors", unexpected.length === 0, unexpected.join(" | "));
  check("only expected HTTP errors (validation and injected loading failure)", bad.every((b) => b.startsWith("400 POST /api/masters/party") || b.startsWith("400 POST /api/billing/import") || b.startsWith("503 GET /api/billing/candidates")), bad.join(" | "));
  await page.screenshot({ path: "/tmp/mph-ui-bills.png" });
  await browser.close();
  console.log(`PASSED ${passed}`);
  if (failures.length) { console.log(`FAILED ${failures.length}`); failures.forEach((f) => console.log("  " + f)); process.exit(1); }
  console.log("PASS: masters, bill making, printing, editing and cancelling in a real browser");
})().catch((e) => { console.error(e); process.exit(1); });
