"use strict";

// Dashboard: drawing the screen, its side panel and the shared cards, tables and CSV downloads.

function renderDashboard() {
  if (!dashState.model) return;
  if (!dashboardActive()) return;
  const main = $("main");
  const scroll = main.scrollTop;
  const focused = document.activeElement?.id;
  const typed = $("dashParty")?.value ?? "";
  const view = dashView();
  $("dashRoot").replaceChildren(
    el("aside", { class: "dash-side", id: "dashSide", "aria-label": L("Choose what to see", "क्या देखना है चुनें") },
      [periodBlock(view), partiesBlock(view), compareBlock(view), statusBlock()]),
    el("div", { class: "dash-main", id: "dashMain" }, [headCard(view), tabsBlock(view), ...SECTION_VIEWS[dashState.sel.section](view)]),
  );
  // A refresh while a name is being typed keeps the text (picking a party empties the box before drawing again).
  if (focused === "dashParty" && typed && !$("dashParty").value) $("dashParty").value = typed;
  if (focused === "dashParty" || focused === "dashPartyFilter") {
    const input = $(focused);
    input?.focus({ preventScroll: true });
    if (input) input.selectionStart = input.selectionEnd = input.value.length;
  }
  main.scrollTop = scroll;
  if ($("dashPartyPanel")?.open) renderPartyPanel();
  if ($("dashPicker")?.open) renderPicker();
}

// The dashboard's own tabs; they stay at the top while the figures scroll.
function tabsBlock(view) {
  const u = unbilledFor(view.partySet, view.monthSet);
  return el("nav", { class: "dash-tabs", id: "dashTabs", "aria-label": L("Dashboard sections", "Dashboard के भाग") }, sectionList().map(([key, icon, title, note]) => {
    const active = dashState.sel.section === key;
    const props = { type: "button", class: `dash-tab${active ? " active" : ""}`, "data-section": key, title: note, onclick: () => goSection(key) };
    if (active) props["aria-current"] = "page";
    const badge = key === "unbilled" && u.ready.entries
      ? el("span", { class: `dash-badge${u.old.entries ? " warn" : ""}`, title: L(`${entriesText(u.ready.entries)} waiting`, `${entriesText(u.ready.entries)} बाक़ी`), text: num(u.ready.entries) })
      : "";
    return el("button", props, [el("span", { class: "dash-tab-icon", "aria-hidden": "true", text: icon }), el("span", { text: title }), badge]);
  }));
}

function blockTitle(text, extra = "") {
  return el("h2", { class: "dash-block-title" }, [text, extra]);
}

function periodBlock(view) {
  const m = dashState.model;
  const viewFy = m.years.includes(dashState.ui.fy) ? dashState.ui.fy : fyOf(view.months.at(-1));
  const presets = el("div", { class: "dash-presets", role: "group", "aria-label": L("Quick periods", "जल्दी चुनें") }, presetList().map(([key, label]) => {
    const months = presetMonths(key);
    const on = months.length > 0 && sameMonths(months, view.months);
    const props = { type: "button", class: `dash-pill${on ? " active" : ""}`, "data-preset": key, "aria-pressed": String(on), title: periodWords(months), onclick: () => dashSelect({ preset: key, months: [] }) };
    if (!months.length) props.disabled = "";
    return el("button", props, [label]);
  }));
  const year = dropdownOf(m.years.map((fy) => [fy, fyText(fy)]), viewFy, { id: "dashYear", "aria-label": L("Financial year", "Financial Year"), title: L("April to March", "April से March") });
  year.addEventListener("change", () => pickYear(year.value));
  const fyMonths = fyMonthsOf(viewFy);
  const scale = Math.max(0, ...fyMonths.filter(inData).map((month) => billsIn(view, month).taxable));
  const grid = el("div", { class: "dash-months", id: "dashMonths", role: "group", "aria-label": L(`Months of ${fyText(viewFy)}`, `${fyText(viewFy)} के Month`) },
    fyMonths.map((month) => monthButton(month, view, scale)));
  const multi = el("input", { type: "checkbox", id: "dashMulti" });
  multi.checked = dashState.sel.multi;
  multi.addEventListener("change", () => dashSelect({ multi: multi.checked }));
  const outside = view.months.filter((month) => fyOf(month) !== viewFy).length;
  return el("section", { class: "dash-block", id: "dashPeriod" }, [
    blockTitle(L("Period", "समय")),
    presets,
    el("div", { class: "dash-year-field" }, [el("label", { for: "dashYear", text: L("Financial year", "Financial Year") }), year]),
    grid,
    el("label", { class: "check dash-check", title: L("Shift+click a month picks every month from the last one clicked", "Shift+क्लिक से पिछले क्लिक किए Month से यहाँ तक सब चुने जाते हैं") },
      [multi, L("Pick several months", "कई Month चुनें")]),
    el("p", { class: "dash-hint", text: dashState.sel.multi
      ? L("Click months to add or remove them.", "Month जोड़ने या हटाने के लिए क्लिक करें।")
      : L("Click a month to see it.", "Month देखने के लिए क्लिक करें।") }),
    el("p", { class: "dash-picked", id: "dashPicked" }, [
      el("b", { text: periodWords(view.months) }), ` · ${monthsText(view.months.length)}`,
      outside ? el("span", { class: "muted", text: L(` (${outside} in another year)`, ` (${outside} दूसरे साल में)`) }) : "",
    ]),
  ]);
}

function monthButton(month, view, scale) {
  const index = monthIndexOf(month);
  const on = view.months.includes(month);
  const compared = view.shownCompare.includes(month);
  const billed = index === undefined ? 0 : billsIn(view, month).taxable;
  const props = {
    type: "button", class: `dash-month${on ? " on" : ""}${compared && !on ? " cmp" : ""}`, "data-month": month, "aria-pressed": String(on),
    title: `${longMonth(month)}${billed ? ` · ${L("billed", "बिल")} ${rs(billed)}` : ""}${compared ? ` · ${L("compared with", "तुलना में")}` : ""}`,
    onclick: (event) => pickMonth(month, event),
  };
  if (index === undefined) props.disabled = "";
  return el("button", props, [el("span", { text: shortMonth(month) }), el("i", { class: "dash-month-bar", "aria-hidden": "true", style: `width: ${scale ? Math.round((billed / scale) * 100) : 0}%` })]);
}

/** A click picks one month; with "Pick several months" (or Ctrl) it adds or removes it; Shift picks the range from the last click. */
function pickMonth(month, event = {}) {
  if (!inData(month)) return;
  const view = dashView();
  let months;
  if (event.shiftKey && dashState.ui.anchor) {
    const [from, to] = [dashState.ui.anchor, month].sort();
    months = monthRange(from, to).filter(inData);
  } else if (dashState.sel.multi || event.ctrlKey || event.metaKey) {
    months = view.months.includes(month) ? view.months.filter((m) => m !== month) : [...view.months, month];
    if (!months.length) months = [month];
  } else {
    months = [month];
  }
  dashState.ui.anchor = month;
  dashState.ui.fy = fyOf(month);
  dashSelect({ preset: "custom", months: months.sort() });
}

/** Another financial year: the same months in it (or that whole year when a whole year was shown). */
function pickYear(fy) {
  const view = dashView();
  const from = fyOf(view.months.at(-1));
  dashState.ui.fy = fy;
  if (fy === from) {
    renderDashboard();
    return;
  }
  const whole = view.months.length === 12 && view.months[0].endsWith("-04");
  const shift = (Number(fy.slice(0, 2)) - Number(from.slice(0, 2))) * 12;
  let months = (whole ? fyMonthsOf(fy) : view.months.map((month) => addMonths(month, shift))).filter(inData);
  if (!months.length) months = fyMonthsOf(fy).filter(inData).slice(-1);
  dashSelect({ preset: "custom", months });
}

function compareBlock(view) {
  return el("section", { class: "dash-block", id: "dashCompare" }, [
    blockTitle(L("Compare with", "तुलना किससे")),
    el("div", { class: "dash-radios", role: "radiogroup", "aria-label": L("Compare with", "तुलना किससे") }, compareOptions().map(([key, label]) => {
      const on = dashState.sel.compare === key;
      const months = comparisonOf(view.measured.length ? view.measured : view.months, key);
      return el("button", { type: "button", role: "radio", "aria-checked": String(on), class: `dash-radio${on ? " active" : ""}`, "data-compare": key, onclick: () => dashSelect({ compare: key }) }, [
        el("span", { class: "dash-radio-dot", "aria-hidden": "true" }),
        el("span", { class: "dash-radio-text" }, [el("b", { text: label }), months.length ? el("span", { text: periodWords(months) }) : ""]),
      ]);
    })),
    view.compareGap ? el("p", { class: "dash-hint warn", id: "dashCompareGap", text: view.compareGap }) : el("p", { class: "dash-hint", text: partialNote(view) }),
  ]);
}

function setParties(list) {
  dashSelect({ parties: [...new Set(list)].map(partyName) });
}

function addParties(list) {
  setParties([...dashView().parties, ...list]);
}

function removeParty(i) {
  setParties(dashView().parties.filter((p) => p !== i));
}

/** The parties with the most billing in the period (or the most cloth when nothing was billed). */
function topParties(view, count) {
  const m = dashState.model;
  const billed = rollup(m.f.bills, { months: view.monthSet, by: (row) => row[0] });
  const inward = rollup(m.f.inward, { months: view.monthSet, by: (row) => row[0] });
  return [...new Set([...billed.keys(), ...inward.keys(), ...m.order])]
    .sort((a, b) => (billed.get(b)?.[4] ?? 0) - (billed.get(a)?.[4] ?? 0) || (inward.get(b)?.[1] ?? 0) - (inward.get(a)?.[1] ?? 0) || m.order.indexOf(a) - m.order.indexOf(b))
    .slice(0, count);
}

// Type part of a party's (or sister group's) name; Enter or a click adds it. Every word typed must appear in the name.
function partyInput(view) {
  const m = dashState.model;
  const chosen = new Set(view.parties);
  const billed = rollup(m.f.bills, { months: view.monthSet, by: (row) => row[0] });
  const input = el("input", { type: "text", id: "dashParty", placeholder: L("Type a party name to add it…", "पार्टी का नाम लिखकर जोड़ें…"), "aria-label": L("Add a party", "पार्टी जोड़ें"), autocomplete: "off" });
  const matches = (text) => {
    const tokens = normalize(text).split(" ").filter(Boolean);
    const joined = tokens.join(" ");
    const fits = (name) => tokens.every((token) => name.includes(token));
    const parties = m.order.filter((i) => !chosen.has(i) && fits(m.norm[i]))
      .map((i, rank) => ({ i, rank: (joined && m.norm[i].startsWith(joined) ? 0 : 1e6) + rank }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 60)
      .map(({ i }) => {
        const value = billOf(billed.get(i)).taxable;
        return { value: `p:${i}`, label: partyName(i), hint: value ? rs(value) : "" };
      });
    const groups = tokens.length ? [...m.groups.values()].filter((g) => fits(normalize(g.name)) && g.parties.some((i) => !chosen.has(i)))
      .map((g) => ({ value: `g:${partyKey(g.name)}`, label: L(`${g.name} (sister firms)`, `${g.name} (सिस्टर फ़र्म)`), hint: partiesText(g.parties.length) })) : [];
    return [...groups, ...parties];
  };
  const add = (value) => {
    input.value = "";
    if (value.startsWith("g:")) addParties(m.groups.get(value.slice(2))?.parties ?? []);
    else addParties([Number(value.slice(2))]);
  };
  attachSuggestions(input, matches, { onPick: ({ value }) => add(value) });
  input.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.key === "Enter") {
      event.preventDefault();
      const [first] = input.value.trim() ? matches(input.value) : [];
      if (first) add(first.value);
    } else if (event.key === "Escape") {
      input.value = "";
    }
  });
  return input;
}

function partiesBlock(view) {
  const chips = view.parties.length
    ? view.parties.map((i) => el("span", { class: "dash-chip" }, [
      el("button", { type: "button", class: "dash-chip-name", title: L(`Open ${partyName(i)}`, `${partyName(i)} खोलें`), text: partyName(i), onclick: () => openPartyPanel(i) }),
      el("button", { type: "button", class: "dash-chip-x", title: L("Remove", "हटाएँ"), "aria-label": L(`Remove ${partyName(i)}`, `${partyName(i)} हटाएँ`), text: "×", onclick: () => removeParty(i) }),
    ]))
    : [el("span", { class: "dash-chip all", text: L("All parties", "सभी पार्टियाँ") })];
  return el("section", { class: "dash-block", id: "dashParties" }, [
    blockTitle(L("Parties", "पार्टियाँ"), view.parties.length ? el("span", { class: "dash-count", text: num(view.parties.length) }) : ""),
    partyInput(view),
    el("div", { class: "dash-chips", id: "dashChips" }, chips),
    el("div", { class: "dash-side-actions" }, [
      el("button", { type: "button", id: "dashPartyList", class: "secondary small", text: L("Choose from list", "List से चुनें"), onclick: openPicker }),
      el("button", { type: "button", id: "dashTop5", class: "secondary small", title: L("The 5 parties billed most in the period", "इस अवधि में सबसे ज़्यादा बिल वाली 5 पार्टियाँ"), text: L("Top 5", "शीर्ष 5"), onclick: () => setParties(topParties(view, 5)) }),
      view.parties.length ? el("button", { type: "button", id: "dashPartyClear", class: "ghost small", text: L("All parties", "सभी पार्टियाँ"), onclick: () => setParties([]) }) : "",
    ]),
  ]);
}

function statusBlock() {
  return el("div", { class: "dash-status", id: "dashStatus" }, statusChildren());
}

function statusChildren() {
  const time = new Date(dashState.loadedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const props = { type: "button", id: "dashRefresh", class: "secondary small", text: dashState.busy ? L("Checking…", "जाँच रहे हैं…") : L("↻ Refresh", "↻ Refresh करें"), onclick: () => loadDashboard().catch(showFatal) };
  if (dashState.busy) props.disabled = "";
  return [
    el("p", { class: dashState.error ? "err" : "", text: dashState.error
      ? L(`Could not refresh just now (${dashState.error}). Showing the figures from ${time}.`, `अभी Refresh नहीं हो सका (${dashState.error})। ${time} के आँकड़े दिख रहे हैं।`)
      : L(`Worked out from your register and bills at ${time}. It updates on its own.`, `आपके रजिस्टर और बिलों से ${time} पर तैयार किया गया। यह अपने-आप अपडेट होता है।`) }),
    el("button", props),
  ];
}

function updateStatus() {
  $("dashStatus")?.replaceChildren(...statusChildren());
}

function setRefreshBusy(busy) {
  const button = $("dashRefresh");
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? L("Checking…", "जाँच रहे हैं…") : L("↻ Refresh", "↻ Refresh करें");
}

function partyListText(view) {
  if (!view.parties.length) return L("All parties", "सभी पार्टियाँ");
  const names = view.parties.map(partyName);
  if (names.length <= 2) return names.join(L(" and ", " और "));
  return L(`${names[0]}, ${names[1]} and ${names.length - 2} more`, `${names[0]}, ${names[1]} और ${names.length - 2} और`);
}

function coverageText(view) {
  const m = dashState.model;
  let { lastInward, lastDispatch, lastBill } = m.f.coverage;
  if (view.partySet) {
    const latest = (key) => view.parties.map((i) => m.f.parties[i][key]).filter(Boolean).sort().at(-1) ?? null;
    [lastInward, lastDispatch, lastBill] = [latest("lastInward"), latest("lastDispatch"), latest("lastBill")];
  }
  return [
    [L("Last inward", "आख़िरी आवक"), lastInward],
    [L("Last dated dispatch", "आख़िरी तारीख़ वाली जावक"), lastDispatch],
    [L("Last saved bill", "आख़िरी सेव किया बिल"), lastBill],
  ].map(([label, date]) => `${label}: ${date ? niceDate(date) : L("none recorded", "दर्ज नहीं")}`).join(" · ");
}

function headCard(view) {
  const [, icon, title, note] = sectionList().find(([key]) => key === dashState.sel.section);
  const live = dashState.sel.section === "unbilled";
  const tags = [
    el("span", { class: "dash-tag", title: L("Period", "समय") }, [el("span", { "aria-hidden": "true", text: "📅" }), el("span", { text: periodWords(view.months) })]),
    el("span", { class: "dash-tag", title: L("Parties", "पार्टियाँ") }, [el("span", { "aria-hidden": "true", text: "👥" }), el("span", { text: partyListText(view) })]),
    (view.billChangeOk || view.inwardChangeOk) && !live ? el("span", { class: "dash-tag cmp", title: L("Compared with", "तुलना") }, [el("span", { "aria-hidden": "true", text: "⚖" }), el("span", { text: L(`vs ${view.compareText}`, `${view.compareText} से तुलना`) })]) : "",
  ];
  return el("header", { class: "card dash-head" }, [
    el("div", { class: "dash-title" }, [
      el("h1", { text: L("Business dashboard", "व्यापार Dashboard") }),
      el("p", { class: "dash-section-name" }, [el("span", { "aria-hidden": "true", text: `${icon} ` }), el("b", { text: title }), el("span", { class: "muted", text: ` · ${note}` })]),
      el("span", { class: "dash-sub", id: "dash-coverage", text: coverageText(view) }),
    ]),
    el("div", { class: "dash-tags", id: "dashSummary" }, tags),
  ]);
}

// ---------- Building blocks ----------
function card(id, title, note, children, { actions = [], cls = "" } = {}) {
  return el("section", { class: `card dash-card ${cls}`.trim(), id }, [
    el("div", { class: "card-head" }, [
      el("div", { class: "card-title" }, [el("h2", { text: title }), note ? el("p", { class: "muted", text: note }) : ""]),
      actions.length ? el("div", { class: "card-actions" }, actions) : "",
    ]),
    ...children,
  ]);
}

function kpi({ id, label, value, title = "", lines = [], tone = "", action = null, spark = "" }) {
  return el("div", { class: `kpi ${tone}`.trim(), id }, [
    el("div", { class: "kpi-top" }, [el("div", { class: "kpi-label", text: label }), spark]),
    el("div", { class: "kpi-value", title, text: value }),
    ...lines.filter(Boolean).map((line) => (typeof line === "string" ? el("div", { class: "kpi-line", text: line }) : line)),
    action ? el("button", { type: "button", class: "secondary small kpi-action", text: action[0], onclick: action[1] }) : "",
  ]);
}

function trendLine(value, against, options) {
  return value === null ? "" : el("div", { class: `kpi-line trend ${changeTone(value, options)}`, text: changeText(value, against) });
}

function th(text, cls = "num", props = {}) {
  return el("th", { class: cls, scope: "col", ...props, text });
}

function td(text, cls = "num", props = {}) {
  return el("td", { class: cls, ...props, text: String(text) });
}

function moneyCell(value, cls = "num strong") {
  return td(rs(value), cls, { title: rsFull(value) });
}

/** ▲ 12.0% / ▼ 4.5% / New / Stopped, coloured; "—" when there is nothing to compare. */
function changeCell(now, before, on, { goodWhenUp = true } = {}) {
  if (!on || (!now && !before)) return td("—", "num muted-cell");
  if (!before) return el("td", { class: "num" }, [el("span", { class: "chg good", text: L("New", "नई") })]);
  if (!now) return el("td", { class: "num" }, [el("span", { class: "chg bad", text: L("Stopped", "रुका") })]);
  const c = change(now, before);
  return el("td", { class: "num", title: `${rsFull(before)} → ${rsFull(now)}` }, [
    el("span", { class: `chg ${changeTone(c, { goodWhenUp })}`, text: `${c >= 0 ? "▲" : "▼"} ${ONE_DECIMAL.format(Math.abs(c))}%` }),
  ]);
}

function dashTable(heads, rows, { id = "", foot = null, cls = "" } = {}) {
  const props = { class: `dash-table ${cls}`.trim() };
  if (id) props.id = id;
  return el("div", { class: "table-scroll" }, [el("table", props, [
    el("thead", {}, [el("tr", {}, heads)]),
    el("tbody", {}, rows),
    ...(foot ? [el("tfoot", {}, foot)] : []),
  ])]);
}

function emptyNote(text) {
  return el("p", { class: "dash-empty", text });
}

function moreButton(key, total, shown, label) {
  if (total <= shown && !dashState.ui.more.has(key)) return "";
  const open = dashState.ui.more.has(key);
  return el("button", { type: "button", class: "secondary small dash-more", "data-more": key, text: open ? L("Show fewer", "कम दिखाएँ") : label,
    onclick: () => { if (open) dashState.ui.more.delete(key); else dashState.ui.more.add(key); renderDashboard(); } });
}

function barCell(text, share, max, onClick) {
  const name = onClick ? el("button", { type: "button", class: "bar-name link-btn", text, onclick: onClick }) : el("span", { class: "bar-name", text });
  return el("td", { class: "left name-cell" }, [
    name,
    el("span", { class: "bar-track", "aria-hidden": "true" }, [el("i", { style: `width: ${max > 0 ? Math.max(1, (share / max) * 100) : 0}%` })]),
  ]);
}

function partyButton(i, cls = "link-btn") {
  return el("button", { type: "button", class: cls, title: L("Open this party", "यह पार्टी खोलें"), text: partyName(i), onclick: () => openPartyPanel(i) });
}

// ---------- Excel (CSV) ----------
function csvCell(value) {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(name, rows) {
  const text = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" }));
  const link = el("a", { href: url, download: `${name}.csv` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function csvButton(id, name, rows) {
  return el("button", { type: "button", id, class: "secondary small dash-csv", title: L("Download this table to open in Excel", "Excel में खोलने के लिए यह Table डाउनलोड करें"),
    text: L("⬇ Excel", "⬇ Excel"), onclick: () => downloadCsv(`MPH ${name} ${periodWords(dashView().months)}`.replace(/[\\/:*?"<>|]+/g, "-"), rows()) });
}
