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

function cachedEntries(key, path) {
  const cache = state.entriesCache;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (!cache.pending.has(key)) {
    const generation = cache.generation;
    const request = api(path).then((list) => {
      if (cache.generation === generation) cache.set(key, list);
      return list;
    }).finally(() => { if (cache.pending.get(key) === request) cache.pending.delete(key); });
    cache.pending.set(key, request);
  }
  return cache.pending.get(key);
}

function getEntries(month) {
  return month ? cachedEntries(month, `/api/entries?month=${encodeURIComponent(month)}`) : cachedEntries("all", "/api/entries");
}

// Several months at once: each month is fetched (and cached) on its own, then put back in register order. No month in a
// financial year asks for that year only, not for every year.
async function getEntriesOf(months, year) {
  if (!months.length && year) return cachedEntries(`fy:${year}`, `/api/entries?fy=${encodeURIComponent(year)}`);
  if (months.length < 2) return getEntries(months[0] ?? "");
  const key = months.join(",");
  if (!state.entriesCache.has(key)) {
    const generation = state.entriesCache.generation;
    const lists = await Promise.all(months.map((month) => getEntries(month)));
    const list = lists.flat().sort((a, b) => a.id - b.id);
    if (generation !== state.entriesCache.generation) return list;
    state.entriesCache.set(key, list);
  }
  return state.entriesCache.get(key);
}

// After one entry is saved, deleted or restored (pass it as it was and as it is now): only the lists that hold its months
// (and the financial years around them, where carryovers and repeated numbers can change too) are read again. An all-zero
// slip or an entry with a D.N. link can change entries in any earlier year, so then every list is read again.
function forgetEntriesOf(...entries) {
  const changed = entries.filter(Boolean);
  if (changed.some((e) => e.status === "allZero" || e.links?.length)) {
    state.entriesCache.clear();
    state.entriesRevision++;
    return;
  }
  const months = changed.map((e) => e.registerMonth);
  const years = new Set();
  for (const month of months.filter(Boolean)) {
    const year = Number(financialYearOf(month));
    years.add(String(year));
    if (month.endsWith("-03")) years.add(String(year + 1));
    if (month.endsWith("-04")) years.add(String(year - 1));
  }
  const cache = state.entriesCache;
  const touched = (key) => key === "all" || key.split(",").some((part) =>
    years.has(part.startsWith("fy:") ? part.slice(3) : financialYearOf(part)));
  for (const key of [...cache.keys()]) if (touched(key)) cache.delete(key);
  for (const key of [...cache.pending.keys()]) if (touched(key)) cache.pending.delete(key);
  cache.generation++;
  state.entriesRevision++;
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
