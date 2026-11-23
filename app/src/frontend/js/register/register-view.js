"use strict";

// The Register screen: drawing the chosen months, the column sets and scrolling.

const registerRowFilter = rowFilters($("registerFilters"), () => renderRegister(), $("registerFiltersToggle"));
let registerRenderVersion = 0;
// The rows on screen, so a cell saved in place can update the totals without redrawing the table.
let registerShown = [];
// The Columns switch on Register and Party-wise (COLUMN_SETS).
document.querySelectorAll(".colset").forEach((group) => {
  const table = $(group.dataset.table);
  showColumnSet(table, columnSetOf(table));
  group.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-set]");
    if (!button) return;
    try { localStorage.setItem(`mph-columns-${table.id}`, button.dataset.set); } catch { /* private mode */ }
    showColumnSet(table, button.dataset.set);
  });
});
// Until a choice is made, the columns follow the window: maximising or shrinking it switches between Main and All.
SHORT_WINDOW.addEventListener("change", () => document.querySelectorAll(".colset").forEach((group) => {
  const table = $(group.dataset.table);
  showColumnSet(table, columnSetOf(table));
}));

const SEARCH_SUGGESTION_LIMIT = 5;
const SEARCH_SUGGESTION_FIELDS = [
  ["PARTY", (e) => [e.party]],
  ["D.N.", (e) => [e.designNo]],
  ["LOT N.", (e) => String(e.lotNo ?? "").split(",")],
  ["FINISH", (e) => [e.finish]],
  ["GATE PASS", (e) => e.dispatches.map((d) => d.gatePass)],
  ["INW. NO.", (e) => [e.inwardNo]],
];
// The entries the search runs over, with their suggestion index built on first use and kept until the period changes.
let registerSearchPool = { loaded: null, key: null, entries: [], index: null };
// A picked suggestion searches only its own column (LOT N. 264 is not INW. NO. 1264) until the text is changed.
let registerSearchPick = null;

function registerSearchMatcher(rawSearch) {
  const query = normalize(rawSearch);
  if (!query) return null;
  if (registerSearchPick?.text === rawSearch) {
    const valuesOf = SEARCH_SUGGESTION_FIELDS[registerSearchPick.order][1];
    return (e) => valuesOf(e).some((value) => normalize(value) === query);
  }
  const tokens = query.split(" ");
  return (e) => {
    const haystack = normalize([e.inwardNo, e.party, e.designNo, e.lotNo, e.finish, ...e.dispatches.map((d) => d.gatePass)].join(" "));
    return tokens.every((t) => haystack.includes(t));
  };
}

async function renderRegister() {
  const version = ++registerRenderVersion;
  const year = registerPeriodFilter.year;
  const months = $("registerViewMonth").values;
  const loaded = await getEntriesOf(months);
  if (version !== registerRenderVersion) return;
  const entries = loaded.filter((e) => registerPeriodFilter.matches(e.registerMonth));
  const periodKey = `${months}|${year}`;
  if (registerSearchPool.loaded !== loaded || registerSearchPool.key !== periodKey) {
    registerSearchPool = { loaded, key: periodKey, entries, index: null };
  }
  const rawSearch = $("registerSearch").value;
  $("clearRegisterSearch").classList.toggle("hidden", !rawSearch);
  const searchMatches = registerSearchMatcher(rawSearch);
  const searched = searchMatches ? entries.filter(searchMatches) : entries;
  const shown = registerRowFilter(searched);
  registerShown = shown;
  const table = $("registerTable");
  table.replaceChildren(headerRow(), el("tbody", {}, shown.map(entryRow)));
  setTableEmpty(table, shown.length ? "" : entries.length ? "No entries match the search and filters."
    : months.length ? `No entries in ${months.length > 1 ? "these months" : "this month"}.` : year ? "No entries in this financial year." : "No entries yet.");
  const countEl = $("registerCount");
  countEl.textContent = `${num(shown.length)} of ${num(entries.length)} entries`;
  countEl.classList.toggle("filtered", shown.length !== entries.length);
  renderTotals($("registerTotals"), shown);
  updateSendFullBar();
  // Opening the Register, or another month or year, starts at the newest entries (the bottom), where the work is.
  if (registerJumpToNewest || periodKey !== registerLastPeriod) scrollRegister("newest");
  registerJumpToNewest = false;
  registerLastPeriod = periodKey;
}

let registerJumpToNewest = false;
let registerLastPeriod = null;
function scrollRegister(where) {
  const wrap = $("registerTable").parentElement;
  wrap.scrollTop = where === "newest" ? wrap.scrollHeight : 0;
}
$("registerTop").addEventListener("click", () => scrollRegister("top"));
$("registerNewest").addEventListener("click", () => scrollRegister("newest"));

["registerSearch", "registerViewMonth"].forEach((id) => $(id).addEventListener("input", renderRegister));
$("registerSearch").addEventListener("input", () => { registerSearchPick = null; });
$("clearRegisterSearch").addEventListener("click", () => {
  $("registerSearch").value = "";
  registerSearchPick = null;
  renderRegister();
  $("registerSearch").focus();
});

// ---------- Register search suggestions ----------
// Typing offers the closest values from the entries in view, so every suggestion finds at least one row.
