"use strict";

// Totals, cached entry lists and the financial year / month pickers shared by the screens.

function totalsText(entries) {
  const sum = (f) => entries.reduce((s, e) => s + f(e), 0);
  return [
    ["Entries", entries.length], ["THAN", sum((e) => e.than)], ["TP", sum((e) => e.tp)], ["NAG", sum((e) => e.nag)],
    ["NETT THAN", sum((e) => e.nettThan)], ["TWO PART", sum((e) => e.twoPart)], ["JAWAK NAG", sum((e) => e.dispatched)],
    ["Balance", sum((e) => e.balance)], ["Warnings", entries.filter((e) => e.warnings.length).length],
  ];
}

function renderTotals(node, entries) {
  node.replaceChildren(...totalsText(entries).map(([k, v]) => {
    let tone = "";
    if (k === "Balance" && v > 0) tone = " stat-balance";
    else if ((k === "Warnings" && v > 0) || (k === "Balance" && v < 0)) tone = " stat-warn";
    return el("div", { class: `stat${tone}` }, [
      el("span", { class: "stat-label" }, [k, el("span", { class: "sr-only", text: ": " })]),
      el("b", { class: "stat-value", text: num(v) }),
    ]);
  }));
}

async function getEntries(month) {
  const key = month || "all";
  if (!state.entriesCache.has(key)) {
    state.entriesCache.set(key, await api(`/api/entries${month ? `?month=${encodeURIComponent(month)}` : ""}`));
  }
  return state.entriesCache.get(key);
}

// Several months at once: each month is fetched (and cached) on its own, then put back in register order.
async function getEntriesOf(months) {
  if (months.length < 2) return getEntries(months[0] ?? "");
  const key = months.join(",");
  if (!state.entriesCache.has(key)) {
    const lists = await Promise.all(months.map((month) => getEntries(month)));
    state.entriesCache.set(key, lists.flat().sort((a, b) => a.id - b.id));
  }
  return state.entriesCache.get(key);
}

async function refreshRecent() {
  const recent = await api("/api/entries/recent?limit=30");
  const table = $("recentTable");
  table.replaceChildren(headerRow(), el("tbody", {}, recent.map(entryRow)));
  setTableEmpty(table, recent.length ? "" : "Nothing has been entered in the app yet.");
}

async function fillMonthSelect(select, includeAll) {
  const months = await api("/api/months");
  if (select.id === "registerViewMonth") registerPeriodFilter.fill(months);
  else if (select.id === "partyViewMonth") partyPeriodFilter.fill(months);
  else fillMonthOptions(select, months, includeAll);
}

function fillMonthOptions(select, months, includeAll) {
  const previous = select.value;
  const options = months.map((m) => [m.month, `${formatMonth(m.month)}${m.entries === undefined ? "" : ` (${num(m.entries)})`}`]);
  if (includeAll) options.unshift(["", "All months"]);
  // A multi-select keeps whichever of its ticked months still exist; none left means all months.
  if ("values" in select) {
    setDropdownOptions(select, options, previous);
    return;
  }
  const currentMonth = todayIso().slice(0, 7);
  const selected = [previous, currentMonth].find((value) => options.some(([v]) => v === value));
  setDropdownOptions(select, options, selected);
}

function fillFinancialYearOptions(select, months, year, emptyLabel = "All financial years") {
  const current = financialYearOf(todayIso());
  const selected = year ?? current;
  const years = [...new Set([current, ...months.map((m) => financialYearOf(m.month)), ...(selected ? [selected] : [])])]
    .sort((a, b) => Number(b) - Number(a));
  setDropdownOptions(select, [
    ...(emptyLabel ? [["", emptyLabel]] : []),
    ...years.map((value) => [value, formatFinancialYear(value)]),
  ], selected);
  return selected;
}

function financialYearMonthFilter(yearSelect, monthSelect, onChange) {
  let year = null;
  let months = [];
  const fillMonths = () => {
    const scoped = months.filter((m) => !year || financialYearOf(m.month) === year);
    if (!("values" in monthSelect) && !scoped.some((m) => m.month === monthSelect.value)) monthSelect.value = "";
    fillMonthOptions(monthSelect, scoped, true);
  };
  yearSelect.addEventListener("change", () => {
    year = yearSelect.value;
    fillMonths();
    Promise.resolve(onChange()).catch(showFatal);
  });
  return {
    get year() { return year; },
    matches: (month) => !year || financialYearOf(month) === year,
    fill: (available) => {
      months = available;
      year = fillFinancialYearOptions(yearSelect, months, year);
      fillMonths();
    },
    // Picks one month (and its financial year), as when the import report opens the Register.
    show: (available, month) => {
      months = available;
      year = fillFinancialYearOptions(yearSelect, months, financialYearOf(month));
      fillMonths();
      monthSelect.value = month;
    },
  };
}

// Date-entry screens need one concrete month, not an "All months" choice.
function financialYearMonthInput(yearSelect, monthInput, onChange, { automatic = false } = {}) {
  let months = [];
  const sync = () => {
    const year = monthInput.value ? financialYearOf(monthInput.value) : automatic ? "" : null;
    fillFinancialYearOptions(yearSelect, months, year, automatic ? "From workbook" : null);
    if (yearSelect.value) {
      monthInput.min = `${yearSelect.value}-04`;
      monthInput.max = `${Number(yearSelect.value) + 1}-03`;
    } else {
      monthInput.removeAttribute("min");
      monthInput.removeAttribute("max");
    }
  };
  yearSelect.addEventListener("change", () => {
    const year = yearSelect.value;
    if (!year) monthInput.value = "";
    else {
      const number = (monthInput.value || todayIso()).slice(5, 7);
      monthInput.value = `${Number(year) + (Number(number) < 4 ? 1 : 0)}-${number}`;
    }
    sync();
    Promise.resolve(onChange()).catch(showFatal);
  });
  monthInput.addEventListener("change", sync);
  return {
    sync,
    fill: (available) => { months = available; sync(); },
  };
}

const registerPeriodFilter = financialYearMonthFilter($("registerFinancialYear"), $("registerViewMonth"), () => renderRegister());
const partyPeriodFilter = financialYearMonthFilter($("partyFinancialYear"), $("partyViewMonth"), () => renderPartywise({ reuse: true }));
