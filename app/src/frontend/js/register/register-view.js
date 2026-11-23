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

// Each entry's search text, worked out once per loaded list (a saved cell clears it, see applySavedEntry).
let registerHaystacks = new WeakMap();
function registerHaystack(e) {
  let text = registerHaystacks.get(e);
  if (text === undefined) {
    text = normalize([e.inwardNo, e.party, e.designNo, e.lotNo, e.finish, ...e.dispatches.map((d) => d.gatePass)].join(" "));
    registerHaystacks.set(e, text);
  }
  return text;
}

function registerSearchMatcher(rawSearch) {
  const query = normalize(rawSearch);
  if (!query) return null;
  if (registerSearchPick?.text === rawSearch) {
    const valuesOf = SEARCH_SUGGESTION_FIELDS[registerSearchPick.order][1];
    return (e) => valuesOf(e).some((value) => normalize(value) === query);
  }
  const tokens = query.split(" ");
  return (e) => {
    const haystack = registerHaystack(e);
    return tokens.every((t) => haystack.includes(t));
  };
}

// The rows drawn for the loaded list, by entry id: a new search or filter puts the same rows back instead of drawing
// thousands of new ones. A new list (after a save elsewhere, an import or another period) or a new language starts afresh.
let registerRows = { loaded: null, byId: new Map() };
function registerRowOf(entry) {
  let tr = registerRows.byId.get(entry.id);
  if (!tr || rowEntry.get(tr) !== entry) {
    tr = entryRow(entry);
    registerRows.byId.set(entry.id, tr);
  } else {
    const pick = tr.cells[0].querySelector(":scope > .send-pick");
    if (pick) pick.checked = sendPicks.has(entry.id);
  }
  return tr;
}
document.addEventListener("mph-lang", () => {
  registerRows = { loaded: null, byId: new Map() };
  registerDrawn = null;
});
// What the table on screen was drawn from; the same again (as when coming back to the tab) draws nothing.
let registerDrawn = null;

async function renderRegister() {
  clearTimeout(registerSearchTimer);
  const version = ++registerRenderVersion;
  const year = registerPeriodFilter.year;
  const months = $("registerViewMonth").values;
  const loaded = await getEntriesOf(months, year);
  if (version !== registerRenderVersion) return;
  const periodKey = `${months}|${year}`;
  const rawSearch = $("registerSearch").value;
  const drawKey = [periodKey, rawSearch, registerSearchPick?.text === rawSearch ? registerSearchPick.order : "",
    registerRowFilter.signature(), state.entriesRevision, sendPicks.size].join("\u0001");
  const table = $("registerTable");
  if (registerDrawn?.loaded === loaded && registerDrawn.key === drawKey && table.tBodies.length) {
    if (registerJumpToNewest) scrollRegister("newest");
    registerJumpToNewest = false;
    return false;
  }
  const entries = loaded.filter((e) => registerPeriodFilter.matches(e.registerMonth));
  if (registerSearchPool.loaded !== loaded || registerSearchPool.key !== periodKey) {
    registerSearchPool = { loaded, key: periodKey, entries, index: null };
    prepareRegisterSearchIndex();
  }
  if (registerRows.loaded !== loaded) {
    registerRows = { loaded, byId: new Map() };
    registerHaystacks = new WeakMap();
  }
  $("clearRegisterSearch").classList.toggle("hidden", !rawSearch);
  const searchMatches = registerSearchMatcher(rawSearch);
  const searched = searchMatches ? entries.filter(searchMatches) : entries;
  const shown = registerRowFilter(searched);
  registerShown = shown;
  const listChanged = registerDrawn?.loaded !== loaded;
  table.replaceChildren(headerRow(), el("tbody", {}, shown.map(registerRowOf)));
  if (listChanged) pruneEntryRows();
  registerDrawn = { loaded, key: drawKey };
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
  return true;
}

// Typing in the search over a long list draws once the typing pauses, not on every key; a short list draws at once.
const REGISTER_SEARCH_DELAY_MS = 150;
const SEARCH_DELAY_FROM_ROWS = 1000;
let registerSearchTimer = 0;
function renderRegisterSoon(delay) {
  clearTimeout(registerSearchTimer);
  if (registerSearchPool.entries.length < SEARCH_DELAY_FROM_ROWS) renderRegister().catch(showFatal);
  else registerSearchTimer = setTimeout(() => renderRegister().catch(showFatal), delay);
}

let registerJumpToNewest = false;
let registerLastPeriod = null;
function scrollRegister(where) {
  const wrap = $("registerTable").parentElement;
  wrap.scrollTop = where === "newest" ? wrap.scrollHeight : 0;
}
$("registerTop").addEventListener("click", () => scrollRegister("top"));
$("registerNewest").addEventListener("click", () => scrollRegister("newest"));

$("registerSearch").addEventListener("input", () => {
  registerSearchPick = null;
  $("clearRegisterSearch").classList.toggle("hidden", !$("registerSearch").value);
  renderRegisterSoon(REGISTER_SEARCH_DELAY_MS);
});
$("registerViewMonth").addEventListener("input", () => renderRegister().catch(showFatal));
$("clearRegisterSearch").addEventListener("click", () => {
  $("registerSearch").value = "";
  registerSearchPick = null;
  renderRegister();
  $("registerSearch").focus();
});

// ---------- Register search suggestions ----------
// Typing offers the closest values from the entries in view, so every suggestion finds at least one row.
