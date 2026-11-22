"use strict";

// Business dashboard. One request (/api/dashboard/facts) brings every month's billing, finishes, inward and dispatch per
// party, plus today's billing queue and stock. The screen adds up whichever months and parties are picked by itself, so
// changing the selection never waits for the server. The figures are asked for again when the tab is opened, when the window
// comes back into view and every minute while it is shown; while nothing changed the server answers 304 (not modified), which
// costs next to nothing. Written in plain words, with big numbers in lakh / crore, in English or Hindi.
const DASH_REFRESH_MS = 60000;
const DASH_MIN_GAP_MS = 5000;
const DASH_PREFETCH_MS = 1500;
const DASH_STORE = "mph-dashboard";
const SVG_NS = "http://www.w3.org/2000/svg";
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const AGE_KEYS = ["0-30", "31-60", "61-90", "90+"];
const AGE_TEXT = {
  "0-30": ["Up to 30 days", "30 दिन तक"],
  "31-60": ["31 to 60 days", "31 से 60 दिन"],
  "61-90": ["61 to 90 days", "61 से 90 दिन"],
  "90+": ["Over 90 days", "90 दिन से ज़्यादा"],
};
const DASH_TOP = 8;
const DASH_ROWS = 30;
const DASH_COMPARE_TOP = 10;
const DASH_LINES = 8;
const DASH_INSIGHTS = 6;
const DASH_SECTIONS = ["overview", "parties", "compare", "unbilled", "cloth", "gst"];
const PRESET_KEYS = ["lastMonth", "thisMonth", "last3", "last6", "thisFy", "lastFy"];
const COMPARE_KEYS = ["previous", "lastYear", "none"];
const METRIC_KEYS = ["taxable", "than", "perThan", "inward", "bills"];
const WORK_KEYS = ["ready", "factory", "noRate", "old", "earlierInward", "missingRate", "dispatchIssue", "beforeDispatch"];
const STOCK_KEYS = ["total", "unbilled", "beforeDispatch", "billed", "repairs", "noBill"];
const ZERO_WORK = Object.freeze({ entries: 0, than: 0, value: 0 });
const ZERO_STOCK = Object.freeze({ entries: 0, pieces: 0, undispatchedThan: 0, partialEntries: 0 });
const BILL_ZERO = Object.freeze(new Array(9).fill(0));
const INWARD_ZERO = Object.freeze(new Array(7).fill(0));
const ONE_DECIMAL = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const TWO_DECIMALS = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dashHindi = () => typeof getLanguage === "function" && getLanguage() === "hi";
const L = (en, hi) => (dashHindi() ? hi : en);

// ---------- Words and numbers ----------
function dashMonthIdx(month) {
  return Number(month.slice(5, 7)) - 1;
}

function longMonth(month) {
  return `${MONTHS_LONG[dashMonthIdx(month)]} ${month.slice(0, 4)}`;
}

function monthOnly(month) {
  return MONTHS_LONG[dashMonthIdx(month)];
}

function shortMonth(month) {
  return MONTHS[dashMonthIdx(month)];
}

function niceDate(iso) {
  if (!iso) return "";
  return `${Number(iso.slice(8, 10))} ${shortMonth(iso.slice(0, 7))} ${iso.slice(0, 4)}`;
}

/** Financial year (April to March) of an ISO date or month, like "26-27". */
function fyOf(iso) {
  const year = Number(iso.slice(0, 4));
  const start = Number(iso.slice(5, 7)) >= 4 ? year : year - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function fyText(fy) {
  return `20${fy.slice(0, 2)}-${fy.slice(3, 5)}`;
}

/** ₹1.40 crore, ₹31.74 lakh, ₹45,300: the way amounts are said in the shop. */
function rs(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${TWO_DECIMALS.format(n / 1e7)} ${L("crore", "करोड़")}`;
  if (abs >= 1e5) return `₹${TWO_DECIMALS.format(n / 1e5)} ${L("lakh", "लाख")}`;
  return `₹${INDIAN.format(Math.round(n))}`;
}

function rsFull(value) {
  return `₹${INDIAN.format(Math.round(Number(value) || 0))}`;
}

/** Shorter amounts for chart labels: ₹30.2 lakh, ₹1.4 crore, ₹45,300. */
function rsChart(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${ONE_DECIMAL.format(n / 1e7)} ${L("cr", "करोड़")}`;
  if (abs >= 1e5) return `₹${ONE_DECIMAL.format(n / 1e5)} ${L("lakh", "लाख")}`;
  return `₹${INDIAN.format(Math.round(n))}`;
}

/** "1 entry" / "5 entries" (Hindi: Entry / Entries). */
function entriesText(count) {
  return count === 1 ? L("1 entry", "1 Entry") : L(`${num(count)} entries`, `${num(count)} Entries`);
}

function monthsText(count) {
  return count === 1 ? L("1 month", "1 Month") : L(`${num(count)} months`, `${num(count)} Month`);
}

function partiesText(count) {
  return count === 1 ? L("1 party", "1 पार्टी") : L(`${num(count)} parties`, `${num(count)} पार्टियाँ`);
}

function thanText(value) {
  return L(`${num(value)} THAN`, `${num(value)} थान`);
}

function daysText(value) {
  return value === 1 ? L("1 day", "1 दिन") : L(`${num(value)} days`, `${num(value)} दिन`);
}

function pct(value) {
  return `${ONE_DECIMAL.format(Number(value) || 0)}%`;
}

function perThan(value) {
  return `₹${TWO_DECIMALS.format(Number(value) || 0)}`;
}

/** Percent change, or null when there is nothing to compare with. */
function change(now, before) {
  if (!before) return null;
  return ((now - before) / Math.abs(before)) * 100;
}

function changeTone(value, { goodWhenUp = true, flat = 3 } = {}) {
  if (value === null) return "info";
  if (Math.abs(value) < flat) return "info";
  return (value > 0) === goodWhenUp ? "good" : "bad";
}

function changeText(value, against) {
  if (value === null) return "";
  const size = `${ONE_DECIMAL.format(Math.abs(value))}%`;
  if (Math.abs(value) < 0.05) return L(`same as ${against}`, `${against} के बराबर`);
  return value > 0 ? L(`▲ ${size} more than ${against}`, `▲ ${against} से ${size} ज़्यादा`) : L(`▼ ${size} less than ${against}`, `▼ ${against} से ${size} कम`);
}

function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  for (const child of children) node.append(child);
  return node;
}

function niceMax(value) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10]) if (step * magnitude >= value) return step * magnitude;
  return 10 * magnitude;
}

// ---------- Months (yyyy-MM) ----------
function addMonths(month, count) {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function monthsBetween(from, to) {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
}

function monthRange(from, to) {
  const months = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) months.push(month);
  return months;
}

function fyStartOf(month) {
  return `20${fyOf(month).slice(0, 2)}-04`;
}

function fyMonthsOf(fy) {
  const start = `20${fy.slice(0, 2)}-04`;
  return monthRange(start, addMonths(start, 11));
}

function sameMonths(a, b) {
  return a.length === b.length && a.every((month, i) => month === b[i]);
}

/** "October 2026", "Aug – Oct 2026", "FY 2026-27", "Apr, Jun 2026". */
function periodWords(months) {
  if (!months.length) return "—";
  const first = months[0];
  const last = months.at(-1);
  if (months.length === 1) return longMonth(first);
  if (monthsBetween(first, last) + 1 === months.length) {
    if (first.endsWith("-04") && months.length === 12) return `FY ${fyText(fyOf(first))}`;
    return first.slice(0, 4) === last.slice(0, 4)
      ? `${shortMonth(first)} – ${shortMonth(last)} ${last.slice(0, 4)}`
      : `${shortMonth(first)} ${first.slice(0, 4)} – ${shortMonth(last)} ${last.slice(0, 4)}`;
  }
  if (months.length <= 4) {
    const years = [...new Set(months.map((month) => month.slice(0, 4)))];
    return years.map((year) => `${months.filter((month) => month.startsWith(year)).map(shortMonth).join(", ")} ${year}`).join(" · ");
  }
  return L(`${months.length} months, ${shortMonth(first)} ${first.slice(0, 4)} to ${shortMonth(last)} ${last.slice(0, 4)}`,
    `${shortMonth(first)} ${first.slice(0, 4)} से ${shortMonth(last)} ${last.slice(0, 4)} तक ${months.length} Month`);
}

// ---------- What is picked (remembered on this computer between visits) ----------
const DASH_DEFAULTS = Object.freeze({ section: "overview", preset: "lastMonth", months: [], parties: [], compare: "previous", metric: "taxable", multi: false });

function loadSelection() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(DASH_STORE) || "{}") || {};
  } catch {
    saved = {};
  }
  const pick = (key, ok) => (ok(saved[key]) ? saved[key] : DASH_DEFAULTS[key]);
  return {
    section: pick("section", (v) => DASH_SECTIONS.includes(v)),
    preset: pick("preset", (v) => v === "custom" || PRESET_KEYS.includes(v)),
    months: pick("months", (v) => Array.isArray(v) && v.every((m) => typeof m === "string" && /^\d{4}-\d{2}$/.test(m))),
    parties: pick("parties", (v) => Array.isArray(v) && v.every((p) => typeof p === "string")),
    compare: pick("compare", (v) => COMPARE_KEYS.includes(v)),
    metric: pick("metric", (v) => METRIC_KEYS.includes(v)),
    multi: pick("multi", (v) => typeof v === "boolean"),
  };
}

function saveSelection() {
  try {
    localStorage.setItem(DASH_STORE, JSON.stringify(dashState.sel));
  } catch {
    // Private mode: the choice lasts until the page is closed.
  }
}

const dashState = {
  model: null,
  etag: "",
  loadedAt: 0,
  error: "",
  ticket: 0,
  busy: false,
  sel: loadSelection(),
  // Screen-only choices: the year shown in the month grid, table sorting and filters, open panels.
  ui: { fy: "", anchor: "", sort: { key: "taxable", dir: -1 }, filter: "", show: "all", more: new Set(), ticked: new Set(), panel: null, pick: null, pickFilter: "" },
  view: null,
};

function presetList() {
  return [
    ["lastMonth", L("Last month", "पिछला Month")],
    ["thisMonth", L("This month", "यह Month")],
    ["last3", L("Last 3 months", "पिछले 3 Month")],
    ["last6", L("Last 6 months", "पिछले 6 Month")],
    ["thisFy", L("This year (FY)", "यह साल (FY)")],
    ["lastFy", L("Last year (FY)", "पिछला साल (FY)")],
  ];
}

const inData = (month) => dashState.model.monthIdx.has(month);

/** Months of a quick period. Bills are made at the end of the month, so "last 3 months" are the last three finished ones. */
function presetMonths(key) {
  const now = dashState.model.current;
  const fy = fyStartOf(now);
  const months = {
    thisMonth: [now],
    lastMonth: [addMonths(now, -1)],
    last3: monthRange(addMonths(now, -3), addMonths(now, -1)),
    last6: monthRange(addMonths(now, -6), addMonths(now, -1)),
    thisFy: monthRange(fy, now),
    lastFy: monthRange(addMonths(fy, -12), addMonths(fy, -1)),
  }[key] ?? [addMonths(now, -1)];
  return months.filter(inData);
}

/** The months to compare with: the same number of months just before, or the same months a year before. */
function comparisonOf(months, mode) {
  if (mode === "none" || !months.length) return [];
  const shift = mode === "lastYear" ? 12 : monthsBetween(months[0], months.at(-1)) + 1;
  return months.map((month) => addMonths(month, -shift));
}

function compareOptions() {
  return [
    ["previous", L("Previous period", "पिछली अवधि")],
    ["lastYear", L("Same months last year", "पिछले साल के यही Month")],
    ["none", L("No comparison", "तुलना नहीं")],
  ];
}

// ---------- Loading (always from the server, so the figures follow the data) ----------
function dashboardActive() {
  return Boolean($("view-dashboard")?.classList.contains("active"));
}

function dashboardShown() {
  return dashboardActive() && document.visibilityState === "visible";
}

async function showDashboard() {
  if (dashState.model) renderDashboard();
  await loadDashboard({ quiet: Boolean(dashState.model) });
}

async function fetchFacts(etag) {
  const response = await fetch("/api/dashboard/facts", { cache: "no-store", headers: etag ? { "If-None-Match": etag } : {} });
  if (response.status === 304) return { facts: null, etag };
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) throw new Error(body?.errors ? body.errors.join(" ") : `Request failed (${response.status}).`);
  return { facts: body, etag: response.headers.get("ETag") || "" };
}

async function loadDashboard({ quiet = false } = {}) {
  const ticket = ++dashState.ticket;
  if (!dashState.model && !quiet && dashboardActive()) $("dashRoot").replaceChildren(dashLoading());
  dashState.busy = true;
  setRefreshBusy(true);
  try {
    const { facts, etag } = await fetchFacts(dashState.model ? dashState.etag : "");
    if (ticket !== dashState.ticket) return;
    dashState.etag = etag;
    dashState.loadedAt = Date.now();
    dashState.error = "";
    if (facts) {
      const model = buildModel(facts);
      keepPartyChoices(dashState.model, model);
      dashState.model = model;
      dashState.view = null;
      renderDashboard();
    } else {
      updateStatus();
    }
  } catch (error) {
    if (ticket !== dashState.ticket) return;
    dashState.error = error.message;
    if (dashState.model) updateStatus();
    else if (dashboardActive()) {
      $("dashRoot").replaceChildren(el("div", { class: "report err" }, [el("b", { text: L("Could not work out the dashboard.", "Dashboard नहीं बन सका।") }), el("p", { text: error.message })]));
    }
  } finally {
    if (ticket === dashState.ticket) {
      dashState.busy = false;
      setRefreshBusy(false);
    }
  }
}

/** Party numbers follow the names in alphabetical order, so ticks and open windows are carried over by name to new figures. */
function keepPartyChoices(before, after) {
  if (!before) return;
  const move = (i) => after.partyIdx.get(partyKey(before.f.parties[i]?.name));
  const moveAll = (set) => new Set([...set].map(move).filter((i) => i !== undefined));
  const ui = dashState.ui;
  ui.ticked = moveAll(ui.ticked);
  if (ui.pick) ui.pick = moveAll(ui.pick);
  if (ui.panel !== null) ui.panel = move(ui.panel) ?? null;
}

function dashLoading() {
  return el("div", { class: "dash-loading", role: "status", text: L("Working out the figures…", "आँकड़े तैयार हो रहे हैं…") });
}

function refreshIfShown() {
  if (!dashboardShown() || dashState.busy || Date.now() - dashState.loadedAt < DASH_MIN_GAP_MS) return;
  if (document.querySelector("dialog[open], #dashRoot [aria-expanded=true]")) return;
  loadDashboard({ quiet: true }).catch(() => {});
}

setInterval(refreshIfShown, DASH_REFRESH_MS);
window.addEventListener("focus", refreshIfShown);
document.addEventListener("visibilitychange", refreshIfShown);
// The worked-out view holds sentences, so a new language works it out again.
document.addEventListener("mph-lang", () => {
  dashState.view = null;
  if (dashState.model) renderDashboard();
});
document.addEventListener("mph-theme", () => { if (dashState.model) renderDashboard(); });
// Fetched once the app has settled, so the tab opens at once the first time too.
window.addEventListener("load", () => setTimeout(() => {
  const idle = window.requestIdleCallback || ((run) => setTimeout(run, 0));
  idle(() => {
    if (!dashState.model && !dashState.busy && state.info?.showDashboard !== false) loadDashboard({ quiet: true }).catch(() => {});
  }, { timeout: 5000 });
}, DASH_PREFETCH_MS));

// ---------- The figures, indexed once per answer ----------
function partyKey(name) {
  return String(name || "").replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * Adds up rows of the facts. Rows start with [party, month, ...numbers]; `from` is where the numbers start. Returns a map of
 * `by(row)` (one total when there is no `by`) to the sums, so any selection is one pass over the rows.
 */
function rollup(rows, { months = null, parties = null, by = null, from = 2 } = {}) {
  const out = new Map();
  for (const row of rows) {
    if (months && !months.has(row[1])) continue;
    if (parties && !parties.has(row[0])) continue;
    const key = by ? by(row) : 0;
    let sum = out.get(key);
    if (!sum) {
      sum = new Array(row.length - from).fill(0);
      out.set(key, sum);
    }
    for (let i = from; i < row.length; i++) sum[i - from] += row[i];
  }
  return out;
}

function billOf(sum) {
  const s = sum || BILL_ZERO;
  return { bills: s[0], than: s[1], gross: s[2], discount: s[3], taxable: s[4], cgst: s[5], sgst: s[6], igst: s[7], total: s[8], gst: s[5] + s[6] + s[7] };
}

function inwardOf(sum) {
  const s = sum || INWARD_ZERO;
  return { entries: s[0], than: s[1], pieces: s[2], repairEntries: s[3], repairThan: s[4], value: s[5], sent: s[6] };
}

function buildModel(f) {
  const monthIdx = new Map(f.months.map((month, i) => [month, i]));
  const partyIdx = new Map(f.parties.map((party, i) => [partyKey(party.name), i]));
  const byParty = (list) => new Map(list.map((row) => [row.party, row]));
  const groups = new Map();
  f.parties.forEach((party, i) => {
    if (!party.group) return;
    const key = partyKey(party.group);
    if (!groups.has(key)) groups.set(key, { name: party.group, parties: [] });
    groups.get(key).parties.push(i);
  });
  // Lists offer parties by what they were billed in the last 12 months, then by cloth sent, then by name.
  const current = f.today.slice(0, 7);
  const recent = new Set(monthRange(addMonths(current, -11), current).map((month) => monthIdx.get(month)).filter((i) => i !== undefined));
  const billed = rollup(f.bills, { months: recent, by: (row) => row[0] });
  const sent = rollup(f.inward, { months: recent, by: (row) => row[0] });
  const order = f.parties.map((_, i) => i).sort((a, b) => (billed.get(b)?.[4] ?? 0) - (billed.get(a)?.[4] ?? 0)
    || (sent.get(b)?.[1] ?? 0) - (sent.get(a)?.[1] ?? 0) || f.parties[a].name.localeCompare(f.parties[b].name));
  const firstOf = (rows, ok) => {
    let min = Number.POSITIVE_INFINITY;
    for (const row of rows) if (ok(row) && row[1] < min) min = row[1];
    return Number.isFinite(min) ? f.months[min] : null;
  };
  return {
    f,
    monthIdx,
    partyIdx,
    billsFrom: firstOf(f.bills, () => true),
    inwardFrom: firstOf(f.inward, (row) => row[2] > 0),
    unbilled: byParty(f.unbilled),
    stock: byParty(f.stock),
    quiet: byParty(f.quiet),
    groups,
    order,
    norm: f.parties.map((party) => normalize(party.name)),
    years: [...new Set(f.months.map(fyOf))].reverse(),
    current,
    first: f.months[0],
  };
}

const partyName = (i) => dashState.model.f.parties[i].name;

/** The picked months, comparison and parties with their totals, worked out once per change of selection or data. */
function dashView() {
  if (dashState.view) return dashState.view;
  const m = dashState.model;
  const s = dashState.sel;
  let months = (s.preset === "custom" ? [...new Set(s.months)] : presetMonths(s.preset)).filter(inData).sort();
  if (!months.length) months = [m.current];
  const includesCurrent = months.includes(m.current);
  // Bills are made at the end of the month, so a month still running is left out of every comparison.
  const measured = includesCurrent ? months.filter((month) => month !== m.current) : months;
  const compareMonths = comparisonOf(measured.length ? measured : months, s.compare);
  const compareIn = compareMonths.filter(inData);
  const parties = [...new Set(s.parties.map((name) => m.partyIdx.get(partyKey(name))).filter((i) => i !== undefined))];
  const toSet = (list) => new Set(list.map((month) => m.monthIdx.get(month)));
  const monthSet = toSet(months);
  const compareSet = toSet(compareIn);
  const partySet = parties.length ? new Set(parties) : null;
  const total = (rows, monthsSet, partiesSet) => rollup(rows, { months: monthsSet, parties: partiesSet }).get(0);
  const compareOn = compareIn.length > 0;
  const measuredSet = toSet(measured);
  const partial = includesCurrent && measured.length > 0;
  // Months before the first saved bill (or inward entry) were not recorded in the app: they are not compared.
  const recorded = (from) => compareOn && measured.length > 0 && from !== null && compareMonths[0] >= from;
  const billChangeOk = recorded(m.billsFrom);
  const inwardChangeOk = recorded(m.inwardFrom);
  dashState.view = {
    months,
    monthSet,
    compareMonths,
    compareSet,
    compareOn,
    compareText: periodWords(compareMonths),
    // The compared months, outlined in the month grid and the charts once a comparison is actually made.
    shownCompare: billChangeOk || inwardChangeOk ? compareMonths : [],
    parties,
    partySet,
    includesCurrent,
    onlyCurrent: months.length === 1 && months[0] === m.current,
    measured,
    measuredSet,
    partial,
    billChangeOk,
    inwardChangeOk,
    // Why a comparison that was asked for is not shown.
    compareGap: s.compare === "none" || (billChangeOk && inwardChangeOk) ? "" : compareGapText(m, measured, compareMonths, compareOn),
    billed: billOf(total(m.f.bills, monthSet, partySet)),
    allBilled: billOf(total(m.f.bills, monthSet, null)),
    inward: inwardOf(total(m.f.inward, monthSet, partySet)),
    priorBilled: billOf(compareOn ? total(m.f.bills, compareSet, partySet) : null),
    priorInward: inwardOf(compareOn ? total(m.f.inward, compareSet, partySet) : null),
    measuredBilled: billOf(total(m.f.bills, measuredSet, partySet)),
    measuredInward: inwardOf(total(m.f.inward, measuredSet, partySet)),
    byMonth: rollup(m.f.bills, { parties: partySet, by: (row) => row[1] }),
    inwardByMonth: rollup(m.f.inward, { parties: partySet, by: (row) => row[1] }),
    cache: {},
  };
  return dashState.view;
}

function compareGapText(m, measured, compareMonths, compareOn) {
  if (!measured.length) return L(`${monthOnly(m.current)} is still running: it is compared once it is over.`, `${monthOnly(m.current)} अभी चल रहा है: पूरा होने पर इसकी तुलना होगी।`);
  if (!compareOn || !m.billsFrom) return L("No figures recorded that far back yet.", "इतने पुराने आँकड़े अभी दर्ज नहीं हैं।");
  if (compareMonths[0] < m.billsFrom) {
    return L(`Saved bills start in ${longMonth(m.billsFrom)}, so ${periodWords(compareMonths)} is not fully recorded and is not compared.`,
      `सेव बिल ${longMonth(m.billsFrom)} से हैं, इसलिए ${periodWords(compareMonths)} पूरा दर्ज नहीं है और उसकी तुलना नहीं होती।`);
  }
  return m.inwardFrom && compareMonths[0] < m.inwardFrom
    ? L(`Inward entries start in ${longMonth(m.inwardFrom)}, so cloth is not compared.`, `आवक ${longMonth(m.inwardFrom)} से दर्ज है, इसलिए माल की तुलना नहीं होती।`)
    : "";
}

/** The note under a comparison when the period includes the month still running. */
function partialNote(view) {
  return view.partial && (view.billChangeOk || view.inwardChangeOk)
    ? L(`Change counts ${periodWords(view.measured)}; ${monthOnly(dashState.model.current)} is still running.`, `बदलाव ${periodWords(view.measured)} का है; ${monthOnly(dashState.model.current)} अभी चल रहा है।`)
    : "";
}

function dashSelect(patch, { top = false } = {}) {
  Object.assign(dashState.sel, patch);
  dashState.view = null;
  saveSelection();
  renderDashboard();
  if (top) $("main").scrollTop = 0;
}

const goSection = (section) => dashSelect({ section }, { top: true });
const monthIndexOf = (month) => dashState.model.monthIdx.get(month);
const billsIn = (view, month) => billOf(view.byMonth.get(monthIndexOf(month)));
const inwardIn = (view, month) => inwardOf(view.inwardByMonth.get(monthIndexOf(month)));

// ---------- Today's billing queue, stock and inward (not tied to the period) ----------
function unbilledFor(partySet) {
  const rows = dashState.model.f.unbilled.filter((u) => !partySet || partySet.has(u.party));
  const add = (a, b) => ({ entries: a.entries + b.entries, than: a.than + b.than, value: a.value + b.value });
  const total = Object.fromEntries(WORK_KEYS.map((key) => [key, rows.reduce((sum, u) => add(sum, u[key]), ZERO_WORK)]));
  total.ageing = AGE_KEYS.map((key, i) => ({ key, ...rows.reduce((sum, u) => add(sum, u.ageing[i]), ZERO_WORK) }));
  total.rows = rows;
  total.oldest = rows.map((u) => u.oldest).filter(Boolean).sort()[0] ?? null;
  total.daysWaiting = Math.max(0, ...rows.map((u) => u.daysWaiting));
  return total;
}

function stockFor(partySet) {
  const rows = dashState.model.f.stock.filter((row) => !partySet || partySet.has(row.party));
  const add = (a, b) => ({
    entries: a.entries + b.entries, pieces: a.pieces + b.pieces, undispatchedThan: a.undispatchedThan + b.undispatchedThan, partialEntries: a.partialEntries + b.partialEntries,
  });
  return Object.fromEntries(STOCK_KEYS.map((key) => [key, rows.reduce((sum, row) => add(sum, row[key]), ZERO_STOCK)]));
}

/** Cloth received this calendar month up to the last inward date entered, and in the same days of the month before. */
function thisMonthFor(partySet) {
  const m = dashState.model;
  const t = m.f.thisMonth;
  const now = inwardOf(rollup(m.f.inward, { months: new Set([monthIndexOf(t.month)]), parties: partySet }).get(0));
  const same = t.comparable ? t.sameDaysLastMonth.filter((c) => !partySet || partySet.has(c.party)).reduce((sum, c) => sum + c.than, 0) : null;
  return { ...now, month: t.month, upTo: t.upTo, sameDaysThan: same };
}

function quietFor(partySet) {
  return dashState.model.f.quiet.filter((q) => !partySet || partySet.has(q.party));
}

/** Each party in view with its billing in the period and the comparison, cloth received and work waiting. */
function partyRows(view) {
  if (view.cache.partyRows) return view.cache.partyRows;
  const m = dashState.model;
  const now = rollup(m.f.bills, { months: view.monthSet, parties: view.partySet, by: (row) => row[0] });
  const before = view.compareOn ? rollup(m.f.bills, { months: view.compareSet, parties: view.partySet, by: (row) => row[0] }) : new Map();
  const measured = view.partial ? rollup(m.f.bills, { months: view.measuredSet, parties: view.partySet, by: (row) => row[0] }) : now;
  const inward = rollup(m.f.inward, { months: view.monthSet, parties: view.partySet, by: (row) => row[0] });
  const ids = new Set([...now.keys(), ...before.keys(), ...inward.keys(), ...(view.partySet ?? [])]);
  for (const u of m.f.unbilled) if (u.ready.entries && (!view.partySet || view.partySet.has(u.party))) ids.add(u.party);
  const all = view.allBilled.taxable;
  view.cache.partyRows = [...ids].map((i) => {
    const b = billOf(now.get(i));
    const p = billOf(before.get(i));
    const counted = billOf(measured.get(i)).taxable;
    const w = inwardOf(inward.get(i));
    const u = m.unbilled.get(i);
    const party = m.f.parties[i];
    return {
      i, name: party.name, group: party.group, ...b, prior: p.taxable, priorThan: p.than, counted, delta: counted - p.taxable,
      change: view.billChangeOk ? change(counted, p.taxable) : null, share: all ? (b.taxable * 100) / all : 0,
      perThan: b.than ? b.taxable / b.than : 0, discountPct: b.gross ? (b.discount * 100) / b.gross : 0,
      inwardThan: w.than, inwardEntries: w.entries, waiting: u?.ready.value ?? 0, waitingEntries: u?.ready.entries ?? 0,
      lastBill: party.lastBill, lastInward: party.lastInward,
    };
  }).sort((a, b) => b.taxable - a.taxable || b.inwardThan - a.inwardThan || a.name.localeCompare(b.name));
  return view.cache.partyRows;
}

/** Job charges per finish for the period and parties in view, biggest first. */
function finishRows(view, partySet = view.partySet) {
  const m = dashState.model;
  const sums = rollup(m.f.finishLines, { months: view.monthSet, parties: partySet, by: (row) => row[2], from: 3 });
  const total = [...sums.values()].reduce((sum, [, amount]) => sum + amount, 0);
  return [...sums].map(([f, [than, amount]]) => ({ finish: m.f.finishes[f], than, amount, share: total ? (amount * 100) / total : 0, rate: than ? amount / than : 0 }))
    .filter((row) => row.amount || row.than)
    .sort((a, b) => b.amount - a.amount || b.than - a.than);
}

/** Months the charts show: the financial year of the period (or the period itself across years), with what it is compared with. */
function chartMonths(view) {
  const m = dashState.model;
  const first = view.months[0];
  const last = view.months.at(-1);
  let from;
  let to;
  if (fyOf(first) === fyOf(last)) {
    from = fyStartOf(last);
    to = addMonths(from, 11);
  } else {
    from = first;
    to = last;
    if (monthsBetween(from, to) < 11) from = addMonths(to, -11);
  }
  if (dashState.sel.compare === "previous" && (view.billChangeOk || view.inwardChangeOk) && view.compareMonths[0] < from) from = view.compareMonths[0];
  if (monthsBetween(from, to) > 23) from = addMonths(to, -23);
  const recorded = [m.billsFrom, m.inwardFrom].filter(Boolean).sort()[0] ?? m.first;
  return monthRange(from, to).filter((month) => month >= m.first && month <= m.current && (month >= recorded || view.months.includes(month)));
}

// ---------- Screen: a side panel to choose what to see, and the chosen section next to it ----------
function sectionList() {
  return [
    ["overview", "📊", L("Overview", "सारांश"), L("The main figures at a glance", "मुख्य आँकड़े एक नज़र में")],
    ["parties", "👥", L("Parties", "पार्टियाँ"), L("Every party's billing, ranked", "हर पार्टी की बिलिंग, क्रम से")],
    ["compare", "⚖", L("Compare", "तुलना"), L("Parties side by side, month by month", "पार्टियाँ आमने-सामने, Month-वार")],
    ["unbilled", "🧾", L("To be billed", "बिल बनाना बाक़ी"), L("Work with no bill yet, as of today", "आज तक जिस काम का बिल नहीं बना")],
    ["cloth", "📦", L("Cloth & stock", "माल और स्टॉक"), L("Cloth received, sent back and in the factory", "आया माल, भेजा माल और फ़ैक्ट्री में माल")],
    ["gst", "🏛", L("GST", "GST"), L("GST charged on your bills", "आपके बिलों पर लगा GST")],
  ];
}

const SECTION_VIEWS = {
  overview: overviewSection,
  parties: partiesSection,
  compare: compareSection,
  unbilled: unbilledSection,
  cloth: clothSection,
  gst: gstSection,
};

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
  const u = unbilledFor(view.partySet);
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
    el("span", { class: "dash-tag", title: L("Period", "समय") }, [el("span", { "aria-hidden": "true", text: "📅" }), el("span", { text: live ? L("Today", "आज तक") : periodWords(view.months) })]),
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

// ---------- Charts (plain SVG and HTML; nothing to download) ----------
/** Column chart. Each series is { name, values, className }; picked months are dark, compared months outlined; a click picks. */
function columnChart({ categories, labels, series, format, axisFormat, selected = [], compared = [], onPick, showValues = true, height = 300, width = 1000 }) {
  const padLeft = 86;
  const padRight = 10;
  const padTop = 30;
  const padBottom = 40;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const groupW = plotW / Math.max(1, categories.length);
  const barW = Math.min(58, (groupW * 0.74) / series.length);
  const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart", role: "img" });
  for (let i = 0; i <= 4; i++) {
    const y = padTop + plotH - (plotH * i) / 4;
    chart.append(svg("line", { x1: padLeft, x2: width - padRight, y1: y, y2: y, class: i ? "grid" : "axis" }));
    chart.append(svg("text", { x: padLeft - 8, y: y + 5, class: "tick", "text-anchor": "end" }, [document.createTextNode(axisFormat((max * i) / 4))]));
  }
  categories.forEach((category, ci) => {
    const x0 = padLeft + ci * groupW;
    const isSelected = selected.includes(category);
    const isCompared = !isSelected && compared.includes(category);
    if (isSelected) chart.append(svg("rect", { x: x0 + 2, y: padTop - 22, width: groupW - 4, height: plotH + 22, class: "chart-pick", rx: 6 }));
    series.forEach((s, si) => {
      const value = s.values[ci] || 0;
      const h = (value / max) * plotH;
      const x = x0 + (groupW - barW * series.length) / 2 + si * barW;
      chart.append(svg("rect", { x: x + 2, y: padTop + plotH - h, width: Math.max(1, barW - 4), height: Math.max(0, h), rx: 3, class: `bar ${s.className}${isSelected ? " on" : ""}${isCompared ? " cmp" : ""}` },
        [svg("title", {}, [document.createTextNode(`${labels[ci]} · ${s.name}: ${format(value)}`)])]));
      if (showValues && value > 0) {
        chart.append(svg("text", { x: x + barW / 2, y: padTop + plotH - h - 7, class: `bar-value${isSelected ? " on" : ""}`, "text-anchor": "middle" }, [document.createTextNode(s.short ? s.short(value) : format(value))]));
      }
    });
    chart.append(svg("text", { x: x0 + groupW / 2, y: height - 12, class: `cat${isSelected ? " on" : ""}`, "text-anchor": "middle" }, [document.createTextNode(labels[ci])]));
    if (onPick) {
      const hit = svg("rect", { x: x0, y: 0, width: groupW, height, class: "hit", tabindex: "0", role: "button", "aria-label": labels[ci] });
      hit.addEventListener("click", (event) => onPick(category, event));
      hit.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPick(category, event); } });
      chart.append(hit);
    }
  });
  return chart;
}

/** Line chart: one line per series (up to 8 colours) across the categories, with a dot and a tooltip on every point. */
function lineChart({ categories, labels, series, format, axisFormat, height = 300 }) {
  const width = 1000;
  const padLeft = 86;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 40;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const step = categories.length > 1 ? plotW / (categories.length - 1) : 0;
  const xOf = (i) => (categories.length > 1 ? padLeft + i * step : padLeft + plotW / 2);
  const yOf = (value) => padTop + plotH - (value / max) * plotH;
  const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart line-chart", role: "img" });
  for (let i = 0; i <= 4; i++) {
    const y = padTop + plotH - (plotH * i) / 4;
    chart.append(svg("line", { x1: padLeft, x2: width - padRight, y1: y, y2: y, class: i ? "grid" : "axis" }));
    chart.append(svg("text", { x: padLeft - 8, y: y + 5, class: "tick", "text-anchor": "end" }, [document.createTextNode(axisFormat((max * i) / 4))]));
  }
  const every = Math.ceil(categories.length / 14);
  categories.forEach((_, i) => {
    if (i % every === 0 || i === categories.length - 1) chart.append(svg("text", { x: xOf(i), y: height - 12, class: "cat", "text-anchor": "middle" }, [document.createTextNode(labels[i])]));
  });
  series.forEach((s, si) => {
    const cls = `s-c${si % DASH_LINES}`;
    if (s.values.length > 1) chart.append(svg("polyline", { points: s.values.map((v, i) => `${xOf(i)},${yOf(v)}`).join(" "), class: `line ${cls}` }));
    s.values.forEach((v, i) => chart.append(svg("circle", { cx: xOf(i), cy: yOf(v), r: 5, class: `dot ${cls}` }, [svg("title", {}, [document.createTextNode(`${s.name} · ${labels[i]}: ${format(v)}`)])])));
  });
  return chart;
}

/** Horizontal bars: [{ label, value, text, title, ghost, onClick, change }]; ghost is the compared value, drawn as a thin mark. */
function hbars(items, { cls = "" } = {}) {
  const max = Math.max(0, ...items.flatMap((item) => [item.value, item.ghost ?? 0]));
  const width = (v) => (max > 0 ? Math.max(0.5, (v / max) * 100) : 0);
  return el("ol", { class: `hbars ${cls}`.trim() }, items.map((item, i) => el("li", { class: "hbar" }, [
    item.onClick
      ? el("button", { type: "button", class: "hbar-name link-btn", title: item.label, text: item.label, onclick: item.onClick })
      : el("span", { class: "hbar-name", title: item.label, text: item.label }),
    el("span", { class: "hbar-track", "aria-hidden": "true" }, [
      el("i", { class: `s-c${(item.color ?? i) % DASH_LINES}`, style: `width: ${width(item.value)}%` }),
      item.ghost ? el("b", { class: "hbar-ghost", title: L("Compared period", "तुलना की अवधि"), style: `left: ${width(item.ghost)}%` }) : "",
    ]),
    el("span", { class: "hbar-value", title: item.title || "", text: item.text }),
    item.change ?? "",
  ])));
}

function sparkline(values) {
  if (values.filter((v) => v > 0).length < 2) return "";
  const width = 110;
  const height = 30;
  const max = Math.max(...values) || 1;
  const points = values.map((v, i) => `${((i * width) / (values.length - 1)).toFixed(1)},${(height - 3 - (v / max) * (height - 6)).toFixed(1)}`).join(" ");
  return svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "spark", "aria-hidden": "true", preserveAspectRatio: "none" }, [svg("polyline", { points })]);
}

function legend(items) {
  return el("div", { class: "legend" }, items.map(([className, text]) => el("span", { class: "legend-item" }, [el("i", { class: `legend-swatch ${className}` }), text])));
}

/** The 12 months up to the end of the period, for the small trend lines in the tiles. */
function sparkMonths(view) {
  const last = view.months.at(-1);
  return monthRange(addMonths(last, -11), last).filter(inData);
}

// ---------- Overview ----------
function overviewSection(view) {
  return [
    ...kpiRows(view),
    monthlyCard(view),
    el("div", { class: "dash-two" }, [insightsCard(view), el("div", { class: "dash-stack" }, [view.parties.length === 1 ? shareCard(view) : topPartiesCard(view), finishesCard(view, { top: DASH_TOP })])]),
  ];
}

function kpiRows(view) {
  const b = view.billed;
  const p = view.priorBilled;
  const w = view.inward;
  const u = unbilledFor(view.partySet);
  const stock = stockFor(view.partySet).total;
  const t = thisMonthFor(view.partySet);
  const spark = sparkMonths(view);
  const vs = view.compareText;
  const mb = view.measuredBilled;
  const billedChange = view.billChangeOk ? change(mb.taxable, p.taxable) : null;
  const billNote = view.onlyCurrent && dashState.sel.compare !== "none"
    ? L("This month is still running: billing is compared once it is over.", "यह Month अभी चल रहा है: इसकी बिलिंग Month पूरा होने पर मिलाई जाएगी।")
    : billedChange === null ? "" : partialNote(view);
  let clothChange = null;
  let clothAgainst = vs;
  if (view.onlyCurrent && t.sameDaysThan !== null) {
    clothChange = change(w.than, t.sameDaysThan);
    clothAgainst = L("the same days last month", "पिछले महीने के इन्हीं दिनों");
  } else if (view.inwardChangeOk) {
    clothChange = change(view.measuredInward.than, view.priorInward.than);
  }
  const perNow = b.than ? b.taxable / b.than : null;
  const perMeasured = mb.than ? mb.taxable / mb.than : null;
  const perBefore = p.than ? p.taxable / p.than : null;
  const primary = [
    kpi({ id: "kpi-billed", label: L("Billed before GST", "GST से पहले बिलिंग"), value: b.bills ? rs(b.taxable) : "—", title: b.bills ? rsFull(b.taxable) : "",
      tone: changeTone(billedChange) === "info" ? "" : changeTone(billedChange),
      spark: sparkline(spark.map((month) => billsIn(view, month).taxable)),
      lines: [trendLine(billedChange, vs), billNote,
        b.bills ? L(`${num(b.bills)} bills · ${num(b.than)} priced THAN`, `${num(b.bills)} बिल · ${num(b.than)} बिल में थान`) : L("No saved bills in this period", "इस अवधि के कोई सेव बिल नहीं"),
        b.bills ? L(`Bill total with GST: ${rs(b.total)}`, `GST सहित बिल कुल: ${rs(b.total)}`) : ""] }),
    kpi({ id: "kpi-unbilled", label: L("Waiting to be billed · estimate", "बिल बनाना बाक़ी · अनुमान"), value: rs(u.ready.value), title: rsFull(u.ready.value), tone: u.ready.entries ? "warn" : "",
      lines: [L(`${entriesText(u.ready.entries)} · ${num(u.ready.than)} THAN`, `${entriesText(u.ready.entries)} · ${num(u.ready.than)} थान`),
        u.daysWaiting ? L(`Longest wait: ${daysText(u.daysWaiting)}`, `सबसे लंबा इंतज़ार: ${daysText(u.daysWaiting)}`) : "",
        L("As of today, whatever the period", "आज तक का, अवधि कोई भी हो")],
      action: [L("See the list", "List देखें"), () => goSection("unbilled")] }),
    kpi({ id: "kpi-cloth", label: L("Cloth received", "आया माल"), value: w.entries ? thanText(w.than) : "—",
      tone: changeTone(clothChange, { flat: 5 }) === "bad" ? "warn" : "",
      spark: sparkline(spark.map((month) => inwardIn(view, month).than)),
      lines: [trendLine(clothChange, clothAgainst, { flat: 5 }),
        w.entries ? L(`${entriesText(w.entries)}${w.value ? ` · work worth about ${rs(w.value)}` : ""}`, `${entriesText(w.entries)}${w.value ? ` · लगभग ${rs(w.value)} का काम` : ""}`) : L("No inward entries in this period", "इस अवधि में कोई आवक नहीं"),
        w.repairThan ? L(`Includes ${num(w.repairThan)} repair THAN`, `${num(w.repairThan)} रिपेयर थान शामिल`) : "",
        view.includesCurrent && t.upTo ? L(`Recorded through ${niceDate(t.upTo)}`, `${niceDate(t.upTo)} तक दर्ज`) : ""] }),
    kpi({ id: "kpi-stock", label: L("In the factory now", "अभी फ़ैक्ट्री में"), value: L(`${num(stock.pieces)} pieces`, `${num(stock.pieces)} नग`),
      lines: [L(`${entriesText(stock.entries)} not fully sent back`, `${entriesText(stock.entries)} पूरी नहीं गईं`),
        L(`${num(stock.undispatchedThan)} THAN on slips with no dispatch`, `बिना जावक वाली पर्चियों में ${num(stock.undispatchedThan)} थान`),
        L("Dispatch balance in the register · as of today", "रजिस्टर में बाक़ी जावक · आज तक")],
      action: [L("See stock", "स्टॉक देखें"), () => goSection("cloth")] }),
  ];
  const perChange = view.billChangeOk && perMeasured !== null && perBefore !== null ? change(perMeasured, perBefore) : null;
  const secondary = [
    kpi({ id: "kpi-per-than", label: L("Billed per priced THAN", "बिल में प्रति थान राशि"), value: perNow === null ? "—" : perThan(perNow),
      lines: [trendLine(perChange, vs), L("After discount, before GST; not profit", "Discount के बाद, GST से पहले; मुनाफ़ा नहीं")] }),
    kpi({ id: "kpi-gst", label: L("GST charged", "बिल पर GST"), value: b.bills ? rs(b.gst) : "—", title: b.bills ? rsFull(b.gst) : "",
      lines: [L("On saved invoices, not net GST payable", "सेव बिलों पर, शुद्ध देय GST नहीं"),
        b.gst ? [b.cgst ? `CGST ${rs(b.cgst)}` : "", b.sgst ? `SGST ${rs(b.sgst)}` : "", b.igst ? `IGST ${rs(b.igst)}` : ""].filter(Boolean).join(" · ") : ""],
      action: [L("GST by month", "Month-वार GST"), () => goSection("gst")] }),
    kpi({ id: "kpi-discount", label: L("Discount given", "दिया गया Discount"), value: rs(b.discount), title: rsFull(b.discount),
      lines: [b.gross ? L(`${pct((b.discount / b.gross) * 100)} of job charges (${rs(b.gross)})`, `Job Charge (${rs(b.gross)}) का ${pct((b.discount / b.gross) * 100)}`) : ""] }),
  ];
  return [
    el("section", { class: "kpis primary", "aria-label": L("Main figures", "मुख्य आँकड़े") }, primary),
    el("section", { class: "kpis secondary", "aria-label": L("More figures", "और आँकड़े") }, secondary),
  ];
}

function monthlyCard(view) {
  const months = chartMonths(view);
  const lastYear = months.map((month) => (inData(addMonths(month, -12)) ? billsIn(view, addMonths(month, -12)).taxable : 0));
  const hasLastYear = lastYear.some((v) => v > 0);
  const series = [{ name: L("Billed before GST", "GST से पहले बिलिंग"), values: months.map((month) => billsIn(view, month).taxable), className: "s-income", short: rsChart }];
  if (hasLastYear) series.push({ name: L("Same month last year", "पिछले साल का यही Month"), values: lastYear, className: "s-last", short: rsChart });
  const span = months.length ? `${shortMonth(months[0])} ${months[0].slice(0, 4)} – ${shortMonth(months.at(-1))} ${months.at(-1).slice(0, 4)}` : "";
  const title = months.length && fyOf(months[0]) === fyOf(months.at(-1)) ? L(`Billing month by month, ${fyText(fyOf(months[0]))}`, `Month-वार बिलिंग, ${fyText(fyOf(months[0]))}`) : L(`Billing month by month, ${span}`, `Month-वार बिलिंग, ${span}`);
  return card("dash-monthly", title, L("After discount, before GST. Click a month to see it; the picked months are dark.", "Discount के बाद, GST से पहले। Month देखने के लिए क्लिक करें; चुने हुए Month गहरे हैं।"), [
    columnChart({ categories: months, labels: months.map(shortMonth), series, format: rsFull, axisFormat: rsChart, selected: view.months, compared: view.shownCompare, onPick: pickMonth, showValues: !hasLastYear || months.length <= 8 }),
    legend([["s-income", L("Picked months", "चुने हुए Month")], ["s-income-soft", L("Other months", "बाक़ी Month")], ...(view.shownCompare.length && dashState.sel.compare === "previous" ? [["s-cmp", L("Compared with", "तुलना वाले Month")]] : []), ...(hasLastYear ? [["s-last", L("Same month last year", "पिछले साल का यही Month")]] : [])]),
  ]);
}

function topPartiesCard(view) {
  const rows = partyRows(view).filter((p) => p.taxable > 0 || p.prior > 0);
  const top = rows.slice(0, DASH_TOP);
  const items = top.map((p, i) => ({
    label: p.name, value: p.taxable, ghost: view.billChangeOk ? p.prior : null, color: i, text: rs(p.taxable), title: rsFull(p.taxable), onClick: () => openPartyPanel(p.i),
    change: el("span", { class: `chg ${view.billChangeOk ? changeTone(p.change) : "info"}`, text: view.billChangeOk ? (p.prior ? `${p.change >= 0 ? "▲" : "▼"} ${ONE_DECIMAL.format(Math.abs(p.change))}%` : L("New", "नई")) : pct(p.share) }),
  }));
  const title = view.parties.length ? L("Billing of the picked parties", "चुनी हुई पार्टियों की बिलिंग") : L("Top parties by billing", "सबसे ज़्यादा बिलिंग वाली पार्टियाँ");
  const note = view.billChangeOk ? L(`Before GST · change against ${view.compareText} (the thin mark)`, `GST से पहले · ${view.compareText} से बदलाव (पतला निशान)`) : L("Before GST · share of all billing", "GST से पहले · कुल बिलिंग में हिस्सा");
  return card("dash-top-parties", title, note, [
    top.length ? hbars(items) : emptyNote(L("No bills in this period.", "इस अवधि में कोई बिल नहीं।")),
    rows.length ? el("button", { type: "button", class: "secondary small", text: L(`See all ${partiesText(rows.length)}`, `सभी ${partiesText(rows.length)} देखें`), onclick: () => goSection("parties") }) : "",
  ]);
}

/** One party: its billing against all parties' in the same period. */
function shareCard(view) {
  const i = view.parties[0];
  const all = view.allBilled;
  const b = view.billed;
  const m = dashState.model;
  const allYear = billOf(rollup(m.f.bills, { months: new Set(fyMonthsOf(fyOf(view.months.at(-1))).filter(inData).map(monthIndexOf)) }).get(0));
  const year = billOf(rollup(m.f.bills, { months: new Set(fyMonthsOf(fyOf(view.months.at(-1))).filter(inData).map(monthIndexOf)), parties: view.partySet }).get(0));
  const fy = fyText(fyOf(view.months.at(-1)));
  const rows = [[periodWords(view.months), b.taxable, all.taxable], [L(`Financial year ${fy}`, `Financial Year ${fy}`), year.taxable, allYear.taxable]];
  return card("dash-overall", L("Compared with all parties", "सभी पार्टियों से तुलना"), L("Billed before GST · all parties includes this party", "GST से पहले बिलिंग · सभी पार्टियों में यह पार्टी शामिल है"), [
    dashTable([th(L("Period", "अवधि"), "left"), th(partyName(i)), th(L("All parties", "सभी पार्टियाँ")), th(L("Share of all parties", "सभी पार्टियों में हिस्सा"))],
      rows.map(([period, mine, everyone]) => el("tr", {}, [el("th", { scope: "row", class: "left", text: period }), moneyCell(mine), moneyCell(everyone, "num"), td(everyone > 0 ? pct((mine * 100) / everyone) : "—")]))),
    year.than && allYear.than ? el("p", { class: "muted", text: L(
      `Per priced THAN in ${fy}: ${perThan(year.taxable / year.than)} for ${partyName(i)}, ${perThan(allYear.taxable / allYear.than)} for all parties. Finish mixes and rates may differ.`,
      `${fy} में प्रति थान: ${partyName(i)} ${perThan(year.taxable / year.than)}, सभी पार्टियाँ ${perThan(allYear.taxable / allYear.than)}। फ़िनिश और Rate अलग हो सकते हैं।`) }) : "",
  ]);
}

function finishesCard(view, { top = 0 } = {}) {
  const all = finishRows(view);
  const key = "finishes";
  const rows = top && !dashState.ui.more.has(key) ? all.slice(0, top) : all;
  const max = all[0]?.amount || 0;
  return card("dash-finishes", L("Job charges by finish", "फ़िनिश-वार Job Charge"), L("Before discount, in the picked period", "Discount से पहले, चुनी हुई अवधि में"), [
    all.length ? dashTable([th(L("Finish", "फ़िनिश"), "left"), th(L("Job charges", "Job Charge")), th(L("Share", "हिस्सा")), th(L("THAN", "थान")), th(L("Average rate", "औसत Rate"))],
      rows.map((f) => el("tr", {}, [barCell(f.finish, f.amount, max), moneyCell(f.amount), td(pct(f.share)), td(num(f.than)), td(perThan(f.rate))]))) : emptyNote(L("No bills in this period.", "इस अवधि में कोई बिल नहीं।")),
    top ? moreButton(key, all.length, top, L(`Show all ${num(all.length)} finishes`, `सभी ${num(all.length)} फ़िनिश दिखाएँ`)) : "",
  ], { actions: all.length ? [csvButton("dashCsvFinishes", "finishes", () => [
    [L("Finish", "फ़िनिश"), L("Job charges", "Job Charge"), L("Share %", "हिस्सा %"), "THAN", L("Average rate", "औसत Rate")],
    ...all.map((f) => [f.finish, f.amount, f.share, f.than, f.rate]),
  ])] : [] });
}

// ---------- What needs attention: plain sentences worked out from the figures ----------
function buildInsights(view) {
  const list = [];
  const m = dashState.model;
  const u = unbilledFor(view.partySet);
  const b = view.billed;
  const p = view.priorBilled;
  const period = periodWords(view.months);
  const go = (section, text = L("See the list", "List देखें")) => ({ text, run: () => goSection(section) });
  const rows = partyRows(view);

  if (u.old.entries > 0) {
    list.push({ tone: "warn", icon: "⏰", title: L("Older entries need bill reconciliation", "पुरानी Entries के बिल मिलाएँ"),
      text: L(`${entriesText(u.old.entries)} with an estimated value of ${rs(u.old.value)} have waited over ${m.f.oldAfterDays} days. Check old bills and dispatch records before invoicing.`,
        `${rs(u.old.value)} के अनुमान की ${entriesText(u.old.entries)} ${m.f.oldAfterDays} दिन से ज़्यादा पुरानी हैं। बिल बनाने से पहले पुराने बिल और जावक जाँचें।`),
      action: go("unbilled") });
  }
  if (u.ready.entries > 0) {
    const largest = view.parties.length !== 1 && u.rows.filter((row) => row.ready.value > 0).sort((x, y) => y.ready.value - x.ready.value)[0];
    list.push({ tone: "warn", icon: "🧾", title: L("Billing queue needs review", "बिलिंग सूची की जाँच करें"),
      text: L(`No bill link recorded for ${entriesText(u.ready.entries)} (${num(u.ready.than)} THAN), estimated at ${rs(u.ready.value)}.${largest ? ` Largest: ${partyName(largest.party)} (${rs(largest.ready.value)}).` : ""}`,
        `${entriesText(u.ready.entries)} (${num(u.ready.than)} थान) का बिल लिंक नहीं मिला। अनुमान ${rs(u.ready.value)}।${largest ? ` सबसे ज़्यादा: ${partyName(largest.party)} (${rs(largest.ready.value)})।` : ""}`),
      action: go("unbilled") });
  }
  if (b.bills === 0) {
    list.push({ tone: "info", icon: "📅", title: L(`No bills yet for ${period}`, `${period} के अभी कोई बिल नहीं`),
      text: view.includesCurrent ? L("Bills are usually made at the end of the month. Pick another period on the left to see its figures.", "बिल आम तौर पर महीने के अंत में बनते हैं। उसके आँकड़े देखने के लिए बाईं ओर कोई और अवधि चुनें।")
        : L("Pick another period on the left to see its figures.", "उसके आँकड़े देखने के लिए बाईं ओर कोई और अवधि चुनें।") });
  } else {
    const c = view.billChangeOk ? change(view.measuredBilled.taxable, p.taxable) : null;
    const note = c === null ? "" : partialNote(view);
    list.push({ tone: changeTone(c), icon: c === null ? "📅" : c >= 0 ? "📈" : "📉", title: L(`Billed before GST in ${period}: ${rs(b.taxable)}`, `${period} की GST से पहले की बिल राशि: ${rs(b.taxable)}`),
      text: c !== null
        ? L(`${changeText(c, view.compareText)} (${rs(p.taxable)}). ${num(b.bills)} bills for ${num(b.than)} THAN.${note ? ` ${note}` : ""}`, `${changeText(c, view.compareText)} (${rs(p.taxable)})। ${num(b.than)} थान के ${num(b.bills)} बिल।${note ? ` ${note}` : ""}`)
        : L(`${num(b.bills)} bills for ${num(b.than)} THAN.`, `${num(b.than)} थान के ${num(b.bills)} बिल।`) });
  }
  if (view.billChangeOk && rows.length >= 2) {
    const counted = periodWords(view.measured);
    const changed = rows.filter((row) => row.prior > 0 || row.counted > 0);
    const fall = changed.filter((row) => row.delta < 0).sort((x, y) => x.delta - y.delta)[0];
    const rise = changed.filter((row) => row.delta > 0).sort((x, y) => y.delta - x.delta)[0];
    const stopped = changed.filter((row) => row.prior > 0 && row.counted === 0);
    if (fall && Math.abs(fall.delta) >= Math.max(1, p.taxable * 0.02)) {
      list.push({ tone: "warn", icon: "📉", title: L(`Biggest fall: ${fall.name}`, `सबसे ज़्यादा कमी: ${fall.name}`),
        text: L(`Billed ${rs(fall.counted)} in ${counted}, ${rs(-fall.delta)} less than in ${view.compareText} (${rs(fall.prior)}).`, `${counted} में ${rs(fall.counted)} बिल, ${view.compareText} (${rs(fall.prior)}) से ${rs(-fall.delta)} कम।`),
        action: { text: L("Open party", "पार्टी खोलें"), run: () => openPartyPanel(fall.i) } });
    }
    if (rise && rise.delta >= Math.max(1, p.taxable * 0.02)) {
      list.push({ tone: "good", icon: "🚀", title: L(`Biggest rise: ${rise.name}`, `सबसे ज़्यादा बढ़त: ${rise.name}`),
        text: L(`Billed ${rs(rise.counted)} in ${counted}, ${rs(rise.delta)} more than in ${view.compareText} (${rs(rise.prior)}).`, `${counted} में ${rs(rise.counted)} बिल, ${view.compareText} (${rs(rise.prior)}) से ${rs(rise.delta)} ज़्यादा।`),
        action: { text: L("Open party", "पार्टी खोलें"), run: () => openPartyPanel(rise.i) } });
    }
    if (stopped.length) {
      const names = stopped.sort((x, y) => y.prior - x.prior).slice(0, 3).map((row) => row.name).join(", ");
      list.push({ tone: "warn", icon: "⏸", title: L(`${partiesText(stopped.length)} billed in ${view.compareText} but not in ${counted}`, `${view.compareText} में बिल हुईं ${partiesText(stopped.length)} का ${counted} में बिल नहीं`),
        text: L(`${names}${stopped.length > 3 ? " and others" : ""}. Check whether their work was billed outside the app or has stopped.`, `${names}${stopped.length > 3 ? " और अन्य" : ""}। देखें कि उनका बिल बाहर बना या काम रुक गया।`),
        action: go("parties", L("See parties", "पार्टियाँ देखें")) });
    }
  }
  const billedRows = rows.filter((row) => row.taxable > 0);
  if (!view.partySet && billedRows.length >= 3 && b.taxable > 0) {
    const top = billedRows[0];
    const five = billedRows.slice(0, 5);
    const fiveShare = five.reduce((sum, row) => sum + row.share, 0);
    list.push({ tone: fiveShare >= 60 || top.share >= 25 ? "warn" : "info", icon: "🤝", title: L("Billing by customer", "पार्टी के अनुसार बिलिंग"),
      text: L(`${top.name} accounts for ${pct(top.share)} of billed value; the top ${five.length} parties account for ${pct(fiveShare)}.`,
        `${top.name} का हिस्सा बिल राशि का ${pct(top.share)} है; सबसे बड़ी ${five.length} पार्टियों का कुल हिस्सा ${pct(fiveShare)} है।`),
      action: go("parties", L("See parties", "पार्टियाँ देखें")) });
  }
  const quiet = quietFor(view.partySet);
  if (quiet.length) {
    const names = quiet.slice(0, 3).map((q) => L(`${partyName(q.party)} (usually ${num(q.usualThan)}, now ${num(q.recentThan)} THAN)`, `${partyName(q.party)} (आम तौर पर ${num(q.usualThan)}, अब ${num(q.recentThan)} थान)`)).join(", ");
    list.push({ tone: "warn", icon: "📞", title: quiet.length === 1 && view.partySet ? L("Sending less cloth", "कम माल आ रहा है") : L("Parties sending less cloth", "कम माल भेज रही पार्टियाँ"),
      text: L(`In the 30 days ending ${niceDate(m.f.coverage.lastInward)}, the register shows less cloth than usual from: ${names}.`, `${niceDate(m.f.coverage.lastInward)} तक के 30 दिनों में रजिस्टर में आम से कम माल आया: ${names}।`),
      action: go("cloth") });
  }
  if (!view.partySet && b.than > 0) {
    const average = b.taxable / b.than;
    const lowest = billedRows.filter((row) => row.than >= Math.max(100, b.than * 0.02)).sort((x, y) => x.perThan - y.perThan)[0];
    if (lowest && lowest.perThan < average * 0.92) {
      list.push({ tone: "info", icon: "⚖", title: L("Below-average billing per THAN", "औसत से कम प्रति थान बिलिंग"),
        text: L(`${lowest.name} was billed ${perThan(lowest.perThan)} per priced THAN after discount, versus the overall ${perThan(average)}. The mix of finishes and rates may differ.`,
          `${lowest.name} की Discount के बाद प्रति थान बिलिंग ${perThan(lowest.perThan)} है, कुल औसत ${perThan(average)} है। फ़िनिश और Rate अलग हो सकते हैं।`),
        action: { text: L("Open party", "पार्टी खोलें"), run: () => openPartyPanel(lowest.i) } });
    }
  }
  if (u.noRate.entries > 0) {
    list.push({ tone: "warn", icon: "✎", title: L("Some work has no finish or rate yet", "कुछ काम में फ़िनिश या Rate नहीं है"),
      text: L(`${entriesText(u.noRate.entries)} (${num(u.noRate.than)} THAN) with no bill link lack a finish or rate. Estimates use past billing where available. Fill in the finish or add the rate in Masters.`,
        `बिना बिल लिंक की ${entriesText(u.noRate.entries)} (${num(u.noRate.than)} थान) में फ़िनिश या Rate नहीं है। अनुमान के लिए पुराने बिल लिए जाते हैं। फ़िनिश भरें या Masters में Rate जोड़ें।`) });
  }
  const t = thisMonthFor(view.partySet);
  if (t.upTo) {
    const c = change(t.than, t.sameDaysThan);
    const tone = changeTone(c, { flat: 5 });
    list.push({ tone: tone === "bad" ? "warn" : tone, icon: "📦", title: L(`Cloth received in ${monthOnly(t.month)}: ${thanText(t.than)}`, `${monthOnly(t.month)} में आया माल: ${thanText(t.than)}`),
      text: L(`Up to ${niceDate(t.upTo)}${t.value > 0 ? `, worth about ${rs(t.value)} of work` : ""}.${c === null ? "" : ` ${changeText(c, "the same days last month")} (${num(t.sameDaysThan)} THAN).`}`,
        `${niceDate(t.upTo)} तक${t.value > 0 ? `, लगभग ${rs(t.value)} का काम` : ""}।${c === null ? "" : ` ${changeText(c, "पिछले महीने के इन्हीं दिनों")} (${num(t.sameDaysThan)} थान)।`}`),
      action: go("cloth", L("See cloth", "माल देखें")) });
  }
  if (view.inward.repairThan > 0) {
    list.push({ tone: "info", icon: "🔧", title: L(`Re-work (REP.) in ${period}: ${thanText(view.inward.repairThan)}`, `${period} में रिपेयर: ${thanText(view.inward.repairThan)}`),
      text: L(`${entriesText(view.inward.repairEntries)} marked as repairs, done again without a bill.`, `${entriesText(view.inward.repairEntries)} पर रिपेयर का निशान है, बिना बिल के दोबारा किया गया।`),
      action: go("cloth", L("See repairs", "रिपेयर देखें")) });
  }
  if (b.gst > 0) {
    list.push({ tone: "info", icon: "🏛", title: L(`GST on ${period} bills: ${rsFull(b.gst)}`, `${period} के बिलों पर GST: ${rsFull(b.gst)}`),
      text: L("GST charged on saved bills, not what is payable after credits, adjustments or payments.", "यह सेव किए बिलों पर लगा GST है, क्रेडिट, समायोजन और भुगतान के बाद देय राशि नहीं।"),
      action: go("gst", L("See GST", "GST देखें")) });
  }
  if (b.discount > 0 && b.gross > 0) {
    const biggest = !view.partySet && billedRows.slice(0, 15).filter((row) => row.discountPct > 0).sort((x, y) => y.discountPct - x.discountPct)[0];
    list.push({ tone: "info", icon: "🏷", title: L(`Discount given in ${period}: ${rs(b.discount)}`, `${period} में दिया गया Discount: ${rs(b.discount)}`),
      text: L(`That is ${pct((b.discount / b.gross) * 100)} of all job charges.${biggest ? ` Highest among the bigger parties: ${biggest.name} at ${pct(biggest.discountPct)}.` : ""}`,
        `यह कुल Job Charge का ${pct((b.discount / b.gross) * 100)} है।${biggest ? ` बड़ी पार्टियों में सबसे ज़्यादा: ${biggest.name}, ${pct(biggest.discountPct)}।` : ""}`) });
  }
  const rank = { bad: 0, warn: 1, good: 2, info: 3 };
  return list.map((item, i) => ({ ...item, i })).sort((a, z) => rank[a.tone] - rank[z.tone] || a.i - z.i);
}

function insightsCard(view) {
  const items = buildInsights(view);
  const key = "insights";
  const shown = dashState.ui.more.has(key) ? items : items.slice(0, DASH_INSIGHTS);
  const body = items.length
    ? el("div", { class: "insights" }, shown.map((item) => el("article", { class: `insight ${item.tone}` }, [
      el("span", { class: "insight-icon", "aria-hidden": "true", text: item.icon }),
      el("div", { class: "insight-body" }, [
        el("h3", { text: item.title }),
        el("p", { text: item.text }),
        item.action ? el("button", { type: "button", class: "secondary small insight-action", text: item.action.text, onclick: item.action.run }) : "",
      ]),
    ])))
    : emptyNote(L("Nothing needs your attention right now. Figures appear here once entries and bills are added.", "अभी किसी बात पर ध्यान देने की ज़रूरत नहीं। Entries और बिल जुड़ने पर यहाँ आँकड़े दिखेंगे।"));
  return card("dash-insights", L("What needs your attention", "किन बातों पर ध्यान दें"), L("Most important first", "सबसे ज़रूरी पहले"), [
    body,
    moreButton(key, items.length, DASH_INSIGHTS, L(`Show all ${num(items.length)}`, `सभी ${num(items.length)} दिखाएँ`)),
  ]);
}

// ---------- Parties: every party in view, sortable, searchable, tick to compare ----------
function partyShows() {
  return [
    ["all", L("All", "सभी")],
    ["billed", L("Billed", "बिल हुई")],
    ["waiting", L("Waiting to bill", "बिल बाक़ी")],
    ["stopped", L("Not billed now", "अब बिल नहीं")],
  ];
}

function filteredPartyRows(view) {
  const tokens = normalize(dashState.ui.filter).split(" ").filter(Boolean);
  const show = dashState.ui.show;
  const rows = partyRows(view).filter((row) => tokens.every((token) => normalize(row.name).includes(token))
    && (show !== "billed" || row.taxable > 0)
    && (show !== "waiting" || row.waitingEntries > 0)
    && (show !== "stopped" || (row.prior > 0 && row.counted === 0)));
  const { key, dir } = dashState.ui.sort;
  const value = (row) => (key === "change" ? row.delta : key === "lastBill" ? row.lastBill || "" : row[key]);
  return rows.sort((a, b) => {
    const x = value(a);
    const y = value(b);
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir || a.name.localeCompare(b.name);
  });
}

function sortHead(key, text, cls = "num", tip = "") {
  const { key: current, dir } = dashState.ui.sort;
  const on = current === key;
  return el("th", { class: cls, scope: "col", "aria-sort": on ? (dir > 0 ? "ascending" : "descending") : "none" }, [
    el("button", { type: "button", class: `sort-btn${on ? " on" : ""}`, "data-sort": key, title: tip || L("Sort by this column", "इस कॉलम से क्रम लगाएँ"),
      onclick: () => {
        dashState.ui.sort = { key, dir: on ? -dir : key === "name" ? 1 : -1 };
        redrawPartyTable();
      } }, [text, el("span", { class: "sort-arrow", "aria-hidden": "true", text: on ? (dir > 0 ? " ▲" : " ▼") : " ↕" })]),
  ]);
}

function redrawPartyTable() {
  $("dashPartyTableWrap")?.replaceChildren(...partyTableParts(dashView()));
}

function partyTableParts(view) {
  const rows = filteredPartyRows(view);
  const ticked = dashState.ui.ticked;
  const key = "partyTable";
  const shown = dashState.ui.more.has(key) ? rows : rows.slice(0, DASH_ROWS);
  const cmp = view.billChangeOk;
  const all = el("input", { type: "checkbox", "aria-label": L("Tick all shown parties", "दिख रही सभी पार्टियाँ चुनें") });
  all.checked = shown.length > 0 && shown.every((row) => ticked.has(row.i));
  all.addEventListener("change", () => {
    for (const row of shown) if (all.checked) ticked.add(row.i); else ticked.delete(row.i);
    redrawPartyTable();
  });
  const heads = [
    el("th", { class: "tick", scope: "col" }, [all]),
    sortHead("name", L("Party", "पार्टी"), "left"),
    sortHead("taxable", L("Billed before GST", "GST से पहले बिलिंग")),
    ...(cmp ? [sortHead("change", L("Change", "बदलाव"), "num", L(`Against ${view.compareText}`, `${view.compareText} से`))] : []),
    sortHead("share", L("Share", "हिस्सा")),
    sortHead("than", L("THAN billed", "बिल में थान")),
    sortHead("perThan", L("Per THAN", "प्रति थान")),
    sortHead("discountPct", L("Discount", "Discount")),
    sortHead("inwardThan", L("Cloth received", "आया माल")),
    sortHead("waiting", L("Waiting to bill", "बिल बाक़ी")),
    sortHead("lastBill", L("Last bill", "आख़िरी बिल")),
  ];
  const average = view.billed.than ? view.billed.taxable / view.billed.than : 0;
  const body = shown.map((row) => {
    const tick = el("input", { type: "checkbox", "aria-label": L(`Tick ${row.name}`, `${row.name} चुनें`) });
    tick.checked = ticked.has(row.i);
    tick.addEventListener("change", () => {
      if (tick.checked) ticked.add(row.i); else ticked.delete(row.i);
      redrawPartyTable();
    });
    return el("tr", { class: ticked.has(row.i) ? "ticked" : "" }, [
      el("td", { class: "tick" }, [tick]),
      el("td", { class: "left name-cell", title: row.group ? L(`Sister firms: ${row.group}`, `सिस्टर फ़र्म: ${row.group}`) : "" }, [partyButton(row.i, "link-btn strong")]),
      moneyCell(row.taxable),
      ...(cmp ? [changeCell(row.counted, row.prior, true)] : []),
      td(row.taxable ? pct(row.share) : "—"),
      td(row.than ? num(row.than) : "—"),
      td(row.than ? perThan(row.perThan) : "—", `num${average && row.than && row.perThan < average * 0.92 ? " low" : ""}`),
      td(row.gross ? pct(row.discountPct) : "—"),
      td(row.inwardThan ? num(row.inwardThan) : "—"),
      row.waiting ? moneyCell(row.waiting, "num warn-cell") : td("—", "num muted-cell"),
      td(row.lastBill ? niceDate(row.lastBill) : "—", "num muted-cell"),
    ]);
  });
  const sum = (field) => rows.reduce((total, row) => total + row[field], 0);
  const totals = { taxable: sum("taxable"), counted: sum("counted"), prior: sum("prior"), bills: sum("bills"), than: sum("than"), gross: sum("gross"), discount: sum("discount"), inward: sum("inwardThan"), waiting: sum("waiting") };
  const foot = rows.length ? [el("tr", {}, [
    td(""), td(L(`Total of ${partiesText(rows.length)}`, `${partiesText(rows.length)} का कुल`), "left"), moneyCell(totals.taxable),
    ...(cmp ? [changeCell(totals.counted, totals.prior, true)] : []),
    td(view.allBilled.taxable ? pct((totals.taxable * 100) / view.allBilled.taxable) : "—"), td(num(totals.than)),
    td(totals.than ? perThan(totals.taxable / totals.than) : "—"), td(totals.gross ? pct((totals.discount * 100) / totals.gross) : "—"),
    td(num(totals.inward)), moneyCell(totals.waiting, "num"), td(""),
  ])] : null;
  const tickedCount = ticked.size;
  return [
    el("div", { class: "dash-toolbar dash-ticked" }, [
      el("span", { class: "muted", text: tickedCount ? L(`${partiesText(tickedCount)} ticked`, `${partiesText(tickedCount)} चुनी हुई`) : L("Tick parties to compare them or to show only them.", "तुलना करने या केवल उन्हें देखने के लिए पार्टियाँ चुनें।") }),
      tickedCount ? el("button", { type: "button", id: "dashCompareTicked", class: "small", text: L(`Compare ticked (${tickedCount})`, `चुनी हुई की तुलना (${tickedCount})`),
        onclick: () => { const list = [...ticked]; ticked.clear(); dashSelect({ parties: list.map(partyName), section: "compare" }, { top: true }); } }) : "",
      tickedCount ? el("button", { type: "button", id: "dashOnlyTicked", class: "secondary small", text: L("Show only ticked", "केवल चुनी हुई दिखाएँ"),
        onclick: () => { const list = [...ticked]; ticked.clear(); setParties(list); } }) : "",
      tickedCount ? el("button", { type: "button", class: "ghost small", text: L("Clear ticks", "चुनाव हटाएँ"), onclick: () => { ticked.clear(); redrawPartyTable(); } }) : "",
    ]),
    rows.length ? dashTable(heads, body, { id: "dashPartyTable", foot, cls: "party-table" }) : emptyNote(L("No party matches.", "कोई पार्टी नहीं मिली।")),
    moreButton(key, rows.length, DASH_ROWS, L(`Show all ${partiesText(rows.length)}`, `सभी ${partiesText(rows.length)} दिखाएँ`)),
  ];
}

function partiesSection(view) {
  const filter = el("input", { type: "search", id: "dashPartyFilter", value: dashState.ui.filter, placeholder: L("Find a party in this list…", "इस List में पार्टी खोजें…"), "aria-label": L("Find a party", "पार्टी खोजें") });
  filter.addEventListener("input", () => {
    dashState.ui.filter = filter.value;
    redrawPartyTable();
  });
  const shows = el("div", { class: "dash-seg", role: "group", "aria-label": L("Show", "दिखाएँ") }, partyShows().map(([key, label]) =>
    el("button", { type: "button", class: `seg-btn${dashState.ui.show === key ? " active" : ""}`, "data-show": key, "aria-pressed": String(dashState.ui.show === key),
      onclick: () => { dashState.ui.show = key; renderDashboard(); } }, [label])));
  const csv = csvButton("dashCsvParties", "parties", () => {
    const rows = filteredPartyRows(view);
    return [
      [L("Party", "पार्टी"), L("Sister group", "सिस्टर ग्रुप"), L("Billed before GST", "GST से पहले बिलिंग"), ...(view.billChangeOk ? [L(`Billed in ${view.compareText}`, `${view.compareText} में बिलिंग`)] : []),
        L("Share %", "हिस्सा %"), L("Bills", "बिल"), L("THAN billed", "बिल में थान"), L("Per THAN", "प्रति थान"), L("Job charges", "Job Charge"), L("Discount", "Discount"),
        L("GST", "GST"), L("Bill total", "बिल कुल"), L("Cloth received (THAN)", "आया माल (थान)"), L("Waiting to bill (estimate)", "बिल बाक़ी (अनुमान)"), L("Last bill", "आख़िरी बिल")],
      ...rows.map((row) => [row.name, row.group, row.taxable, ...(view.billChangeOk ? [row.prior] : []), row.share, row.bills, row.than, row.perThan, row.gross, row.discount, row.gst, row.total, row.inwardThan, row.waiting, row.lastBill || ""]),
    ];
  });
  return [card("dash-parties", L("Billing by party", "पार्टी-वार बिलिंग"),
    L("Click a party's name to see it in detail. Per THAN in red is below the average of these parties.", "किसी पार्टी को विस्तार से देखने के लिए उसके नाम पर क्लिक करें। लाल प्रति थान इन पार्टियों के औसत से कम है।"), [
      el("div", { class: "dash-toolbar" }, [filter, shows]),
      el("div", { id: "dashPartyTableWrap" }, partyTableParts(view)),
    ], { actions: [csv] })];
}

// ---------- Compare: parties month by month ----------
function metricList() {
  const count = (v) => num(Math.round(v));
  return [
    { key: "taxable", label: L("Billed ₹", "बिलिंग ₹"), long: L("billed before GST", "GST से पहले बिलिंग"), src: "bills", get: (b) => b.taxable, fmt: rs, full: rsFull, axis: rsChart },
    { key: "than", label: L("THAN billed", "बिल में थान"), long: L("priced THAN on bills", "बिलों में थान"), src: "bills", get: (b) => b.than, fmt: num, full: thanText, axis: count },
    { key: "perThan", label: L("₹ per THAN", "प्रति थान ₹"), long: L("billed per priced THAN", "प्रति थान बिलिंग"), src: "bills", get: (b) => (b.than ? b.taxable / b.than : 0), fmt: perThan, full: perThan, axis: (v) => `₹${count(v)}`, ratio: true },
    { key: "inward", label: L("Cloth received", "आया माल"), long: L("THAN received", "आए थान"), src: "inward", get: (w) => w.than, fmt: num, full: thanText, axis: count },
    { key: "bills", label: L("Bills", "बिल"), long: L("saved bills", "सेव बिल"), src: "bills", get: (b) => b.bills, fmt: num, full: num, axis: count },
  ];
}

function compareSection(view) {
  const m = dashState.model;
  const metric = metricList().find((x) => x.key === dashState.sel.metric) ?? metricList()[0];
  const rows = metric.src === "inward" ? m.f.inward : m.f.bills;
  const of = metric.src === "inward" ? inwardOf : billOf;
  const value = (sum) => metric.get(of(sum));
  const rank = (sum) => (metric.ratio ? billOf(sum).taxable : value(sum));
  const months = view.months;
  const width = m.f.months.length;
  const periodTotals = rollup(rows, { months: view.monthSet, parties: view.partySet, by: (row) => row[0] });
  const picked = view.parties.length > 0;
  const chosen = picked ? view.parties : [...periodTotals].filter(([, sum]) => rank(sum) > 0).sort((a, b) => rank(b[1]) - rank(a[1])).slice(0, DASH_COMPARE_TOP).map(([i]) => i);
  const set = new Set(chosen);
  const cells = rollup(rows, { months: view.monthSet, parties: set, by: (row) => row[0] * width + row[1] });
  const changeOk = metric.src === "inward" ? view.inwardChangeOk : view.billChangeOk;
  const prior = changeOk ? rollup(rows, { months: view.compareSet, parties: set, by: (row) => row[0] }) : new Map();
  const counted = view.partial ? rollup(rows, { months: view.measuredSet, parties: set, by: (row) => row[0] }) : periodTotals;
  const cellValue = (i, month) => value(cells.get(i * width + monthIndexOf(month)));
  const chosenTotal = rollup(rows, { months: view.monthSet, parties: set }).get(0);
  const chosenPrior = changeOk ? rollup(rows, { months: view.compareSet, parties: set }).get(0) : null;
  const chosenCounted = rollup(rows, { months: view.measuredSet, parties: set }).get(0);
  const allTotal = rollup(rows, { months: view.monthSet }).get(0);
  const allPrior = changeOk ? rollup(rows, { months: view.compareSet }).get(0) : null;
  const allCounted = rollup(rows, { months: view.measuredSet }).get(0);
  const columns = rollup(rows, { months: view.monthSet, parties: set, by: (row) => row[1] });
  const allColumns = rollup(rows, { months: view.monthSet, by: (row) => row[1] });
  const values = chosen.flatMap((i) => months.map((month) => cellValue(i, month)));
  const low = metric.ratio ? Math.min(...values.filter((v) => v > 0)) : 0;
  const high = Math.max(0, ...values);
  const heat = (v) => (v > 0 && high > low ? (metric.ratio ? 0.15 + ((v - low) / (high - low)) * 0.85 : v / high) : v > 0 ? 1 : 0);

  const metricButtons = el("div", { class: "dash-seg", id: "dashMetric", role: "group", "aria-label": L("What to compare", "किसकी तुलना") }, metricList().map((x) =>
    el("button", { type: "button", class: `seg-btn${x.key === metric.key ? " active" : ""}`, "data-metric": x.key, "aria-pressed": String(x.key === metric.key), onclick: () => dashSelect({ metric: x.key }) }, [x.label])));
  const quick = el("div", { class: "dash-side-actions" }, [
    el("button", { type: "button", class: "secondary small", "data-top": "5", text: L("Top 5 parties", "शीर्ष 5 पार्टियाँ"), onclick: () => setParties(topParties(view, 5)) }),
    el("button", { type: "button", class: "secondary small", "data-top": "10", text: L("Top 10 parties", "शीर्ष 10 पार्टियाँ"), onclick: () => setParties(topParties(view, 10)) }),
    el("button", { type: "button", class: "secondary small", text: L("Choose parties…", "पार्टियाँ चुनें…"), onclick: openPicker }),
  ]);
  const intro = picked
    ? L(`${partiesText(chosen.length)} compared on ${metric.long}, ${periodWords(months)}.`, `${partiesText(chosen.length)} की ${metric.long} की तुलना, ${periodWords(months)}।`)
    : L(`The ${partiesText(chosen.length)} with the most ${metric.long} in ${periodWords(months)}. Pick parties on the left (or tick them under Parties) to compare others.`,
      `${periodWords(months)} में सबसे ज़्यादा ${metric.long} वाली ${partiesText(chosen.length)}। दूसरी पार्टियों की तुलना के लिए बाईं ओर पार्टियाँ चुनें।`);

  let chart = emptyNote(L("Nothing to compare in this period.", "इस अवधि में तुलना के लिए कुछ नहीं।"));
  if (chosen.length && months.length > 1) {
    const lines = chosen.slice(0, DASH_LINES);
    chart = el("div", {}, [
      lineChart({ categories: months, labels: months.map((month) => (months.length > 12 || fyOf(months[0]) !== fyOf(months.at(-1)) ? `${shortMonth(month)} ${month.slice(2, 4)}` : shortMonth(month))),
        series: lines.map((i) => ({ name: partyName(i), values: months.map((month) => cellValue(i, month)) })), format: metric.full, axisFormat: metric.axis }),
      legend(lines.map((i, k) => [`s-c${k}`, partyName(i)])),
      chosen.length > DASH_LINES ? el("p", { class: "muted", text: L(`The chart shows the first ${DASH_LINES}; the table below has all ${chosen.length}.`, `Chart में पहली ${DASH_LINES}; नीचे की Table में सभी ${chosen.length}।`) }) : "",
    ]);
  } else if (chosen.length) {
    chart = hbars(chosen.map((i, k) => {
      const now = value(periodTotals.get(i));
      const before = changeOk ? value(prior.get(i)) : 0;
      const base = value(counted.get(i));
      return { label: partyName(i), value: now, ghost: changeOk ? before : null, color: k, text: metric.fmt(now), title: metric.full(now), onClick: () => openPartyPanel(i),
        change: changeOk ? el("span", { class: `chg ${changeTone(change(base, before))}`, text: before ? `${base >= before ? "▲" : "▼"} ${ONE_DECIMAL.format(Math.abs(change(base, before)))}%` : "—" }) : "" };
    }));
  }

  const heads = [th(L("Party", "पार्टी"), "left sticky-col"), ...months.map((month) => th(months.length > 12 || fyOf(months[0]) !== fyOf(months.at(-1)) ? `${shortMonth(month)} ${month.slice(2, 4)}` : shortMonth(month))),
    ...(months.length > 1 ? [th(L("Total", "कुल"), "num total-col")] : []), ...(changeOk ? [th(view.compareText), th(L("Change", "बदलाव"))] : [])];
  const changeTd = (now, before) => {
    const c = change(now, before);
    return c === null ? td(now ? L("New", "नई") : "—", "num muted-cell") : el("td", { class: "num" }, [el("span", { class: `chg ${changeTone(c)}`, text: `${c >= 0 ? "▲" : "▼"} ${ONE_DECIMAL.format(Math.abs(c))}%` })]);
  };
  const body = chosen.map((i, k) => {
    const total = value(periodTotals.get(i));
    const before = value(prior.get(i));
    return el("tr", {}, [
      el("th", { scope: "row", class: "left sticky-col name-cell" }, [el("span", { class: "name-line" }, [el("i", { class: `legend-swatch s-c${k % DASH_LINES}`, "aria-hidden": "true" }), partyButton(i)])]),
      ...months.map((month) => {
        const v = cellValue(i, month);
        return el("td", { class: "num heat", style: `--heat: ${heat(v).toFixed(3)}`, title: `${partyName(i)} · ${longMonth(month)}: ${metric.full(v)}`, text: v ? metric.fmt(v) : "—" });
      }),
      ...(months.length > 1 ? [td(total ? metric.fmt(total) : "—", "num strong total-col", { title: metric.full(total) })] : []),
      ...(changeOk ? [td(before ? metric.fmt(before) : "—", "num muted-cell", { title: metric.full(before) }), changeTd(value(counted.get(i)), before)] : []),
    ]);
  });
  const footRow = (label, columnMap, total, before, base, cls = "") => el("tr", { class: cls }, [
    el("th", { scope: "row", class: "left sticky-col", text: label }),
    ...months.map((month) => td(value(columnMap.get(monthIndexOf(month))) ? metric.fmt(value(columnMap.get(monthIndexOf(month)))) : "—")),
    ...(months.length > 1 ? [td(metric.fmt(value(total)), "num total-col")] : []),
    ...(changeOk ? [td(metric.fmt(value(before)), "num muted-cell"), changeTd(value(base), value(before))] : []),
  ]);
  const foot = chosen.length ? [
    footRow(picked ? L("These parties", "ये पार्टियाँ") : L(`Top ${chosen.length} together`, `शीर्ष ${chosen.length} मिलाकर`), columns, chosenTotal, chosenPrior, chosenCounted),
    footRow(L("All parties", "सभी पार्टियाँ"), allColumns, allTotal, allPrior, allCounted, "all-row"),
  ] : null;
  const csv = csvButton("dashCsvCompare", `compare ${metric.key}`, () => [
    [L("Party", "पार्टी"), ...months.map(longMonth), L("Total", "कुल"), ...(changeOk ? [view.compareText] : [])],
    ...chosen.map((i) => [partyName(i), ...months.map((month) => cellValue(i, month)), value(periodTotals.get(i)), ...(changeOk ? [value(prior.get(i))] : [])]),
    [L("All parties", "सभी पार्टियाँ"), ...months.map((month) => value(allColumns.get(monthIndexOf(month)))), value(allTotal), ...(changeOk ? [value(allPrior)] : [])],
  ]);
  return [
    card("dash-compare", L("Compare parties", "पार्टियों की तुलना"), intro, [el("div", { class: "dash-toolbar" }, [metricButtons, quick]), chart]),
    card("dash-matrix", L(`Month by month: ${metric.label}`, `Month-वार: ${metric.label}`), L("Darker cells are bigger. Click a party's name to see it in detail.", "गहरा खाना बड़ा है। विस्तार के लिए पार्टी के नाम पर क्लिक करें।"), [
      chosen.length ? dashTable(heads, body, { id: "dashMatrix", foot, cls: "matrix" }) : emptyNote(L("Nothing to compare in this period.", "इस अवधि में तुलना के लिए कुछ नहीं।")),
    ], { actions: chosen.length ? [csv] : [] }),
  ];
}

// ---------- To be billed (as of today) ----------
function unbilledSection(view) {
  const m = dashState.model;
  const u = unbilledFor(view.partySet);
  const total = u.ageing.reduce((sum, b) => sum + b.value, 0);
  const ageBar = el("div", { class: "age-bar", role: "img", "aria-label": L("Work without a bill, by days waiting", "बिना बिल का काम, इंतज़ार के दिनों के अनुसार") },
    u.ageing.filter((b) => b.value > 0).map((b) => el("span", { class: `age-seg age-${b.key.replace("+", "plus")}`, style: `flex-grow: ${b.value}`, title: `${AGE_TEXT[b.key][dashHindi() ? 1 : 0]}: ${rsFull(b.value)}` })));
  const ageLegend = el("div", { class: "age-legend" }, u.ageing.map((b) => el("div", { class: "age-item" }, [
    el("i", { class: `legend-swatch age-${b.key.replace("+", "plus")}` }),
    el("div", {}, [el("div", { class: "age-name", text: AGE_TEXT[b.key][dashHindi() ? 1 : 0] }), el("b", { text: rs(b.value) }),
      el("div", { class: "muted", text: L(`${entriesText(b.entries)} · ${num(b.than)} THAN`, `${entriesText(b.entries)} · ${num(b.than)} थान`) })]),
  ])));
  const all = u.rows.filter((row) => row.ready.entries > 0).sort((a, b) => b.ready.value - a.ready.value || b.ready.than - a.ready.than);
  const key = "unbilled";
  const rows = dashState.ui.more.has(key) ? all : all.slice(0, 12);
  const canBill = billsAvailable();
  const heads = [
    th(L("Party (bill to)", "पार्टी (बिल किसे)"), "left"), th(L("Estimated value", "अनुमानित राशि")), th(L("Entries", "Entries")), th(L("THAN", "थान")),
    th(L("Oldest inward", "सबसे पुरानी आवक")), th(L("Days waiting", "इंतज़ार")), th(L("Earlier inward", "पुरानी आवक")), th(L("Missing rate", "Rate नहीं")),
    th(L("Dispatch flags", "जावक की जाँच")), th(L("Still in factory", "अभी फ़ैक्ट्री में")), ...(canBill ? [th("")] : []),
  ];
  const body = rows.map((row) => el("tr", { class: row.daysWaiting > m.f.oldAfterDays ? "old" : "" }, [
    el("td", { class: "left name-cell" }, [partyButton(row.party, "link-btn strong")]),
    moneyCell(row.ready.value),
    td(num(row.ready.entries)),
    td(num(row.ready.than)),
    td(row.oldest ? niceDate(row.oldest) : "—"),
    td(row.daysWaiting ? num(row.daysWaiting) : "—", `num${row.daysWaiting > m.f.oldAfterDays ? " low" : ""}`),
    td(row.earlierInward.entries ? num(row.earlierInward.entries) : "—"),
    td(row.missingRate.entries ? num(row.missingRate.entries) : "—"),
    td(row.dispatchIssue.entries ? num(row.dispatchIssue.entries) : "—"),
    td(row.factory.than ? L(`${num(row.factory.than)} THAN`, `${num(row.factory.than)} थान`) : "—", "num muted-cell", { title: row.factory.value ? rsFull(row.factory.value) : "" }),
    ...(canBill ? [el("td", { class: "num" }, [el("button", { type: "button", class: "small", text: L("Review entries", "Entries जाँचें"), onclick: () => makeBillFor(partyName(row.party), row.oldest).catch(showFatal) })])] : []),
  ]));
  const csv = csvButton("dashCsvUnbilled", "to be billed", () => [
    [L("Party (bill to)", "पार्टी (बिल किसे)"), L("Estimated value", "अनुमानित राशि"), L("Entries", "Entries"), "THAN", L("Oldest inward", "सबसे पुरानी आवक"), L("Days waiting", "इंतज़ार के दिन"),
      L("Earlier inward", "पुरानी आवक"), L("Missing rate", "Rate नहीं"), L("Dispatch flags", "जावक की जाँच"), L("Still in factory (THAN)", "फ़ैक्ट्री में (थान)"), L("Still in factory (estimate)", "फ़ैक्ट्री में (अनुमान)")],
    ...all.map((row) => [partyName(row.party), row.ready.value, row.ready.entries, row.ready.than, row.oldest || "", row.daysWaiting, row.earlierInward.entries, row.missingRate.entries, row.dispatchIssue.entries, row.factory.than, row.factory.value]),
  ]);
  return [
    card("dash-unbilled", L("Billing queue to reconcile", "बिलिंग सूची मिलाएँ"),
      L("As of today, whatever the period. No bill link is not proof that work was never billed. Check saved bills, Excel and dispatch details before invoicing.",
        "आज तक का, अवधि कोई भी हो। बिल लिंक न होना यह साबित नहीं करता कि बिल नहीं बना। बिल बनाने से पहले सेव बिल, Excel और जावक जाँचें।"), [
        all.length ? el("div", { class: "unbilled-top" }, [
          el("div", { class: "unbilled-big" }, [el("span", { class: "kpi-label", text: L("Estimated before GST", "GST से पहले अनुमान") }), el("b", { class: "kpi-value", title: rsFull(u.ready.value), text: rs(u.ready.value) }),
            el("span", { class: "muted", text: L(`${entriesText(u.ready.entries)} · ${num(u.ready.than)} THAN. Age from the last valid dispatch, or from inward if none:`, `${entriesText(u.ready.entries)} · ${num(u.ready.than)} थान। आख़िरी सही जावक से समय, नहीं तो आवक से:`) })]),
          el("div", { class: "unbilled-age" }, [total > 0 ? ageBar : "", ageLegend]),
        ]) : "",
        all.length ? reviewFlags(u) : "",
        u.factory.entries ? el("p", { class: "muted", text: L(`Not dispatched yet (still in the factory): ${entriesText(u.factory.entries)} · ${num(u.factory.than)} THAN · about ${rs(u.factory.value)}. These are not counted above.`,
          `अभी जावक नहीं हुई (फ़ैक्ट्री में): ${entriesText(u.factory.entries)} · ${num(u.factory.than)} थान · लगभग ${rs(u.factory.value)}। ये ऊपर नहीं गिनी गईं।`) }) : "",
        all.length ? dashTable(heads, body, { id: "dashUnbilledTable" }) : emptyNote(L("No eligible unlinked entries recorded.", "कोई योग्य बिना लिंक वाली Entry दर्ज नहीं।")),
        moreButton(key, all.length, 12, L(`Show all ${partiesText(all.length)}`, `सभी ${partiesText(all.length)} दिखाएँ`)),
      ], { actions: all.length ? [csv] : [] }),
    footnote(),
  ];
}

function reviewFlags(u) {
  const lastBill = niceDate(dashState.model.f.coverage.lastBill);
  const flags = [
    [L(`Came in on or before the last saved bill (${lastBill})`, `आख़िरी सेव बिल (${lastBill}) तक की आवक`), u.earlierInward],
    [L("Missing finish or rate (historical estimate, if available)", "फ़िनिश या Rate नहीं (पुराने बिलों से अनुमान, यदि उपलब्ध)"), u.missingRate],
    [L("Dispatch date or quantity needs checking", "जावक की तारीख़ या मात्रा जाँचें"), u.dispatchIssue],
    [L("Not dispatched, but early billing is enabled", "जावक नहीं हुई, पर पहले बिल की अनुमति है"), u.beforeDispatch],
  ].filter(([, estimate]) => estimate.entries);
  return flags.length ? el("div", { id: "dash-review-flags" }, [
    el("p", { class: "muted", text: L("Review flags can overlap. These amounts are already included in the queue.", "एक Entry पर कई संकेत हो सकते हैं। ये राशियाँ सूची में पहले से शामिल हैं।") }),
    el("ul", { class: "repair-list" }, flags.map(([label, e]) => el("li", { text: `${label}: ${entriesText(e.entries)} · ${num(e.than)} THAN · ${rsFull(e.value)}` }))),
  ]) : "";
}

// ---------- Cloth and stock ----------
function clothSection(view) {
  const w = view.inward;
  const t = thisMonthFor(view.partySet);
  const stock = stockFor(view.partySet).total;
  const ok = view.inwardChangeOk;
  const mw = view.measuredInward;
  const sameDays = change(t.than, t.sameDaysThan);
  const kpis = [
    kpi({ id: "kpi-cloth-in", label: L("Cloth received", "आया माल"), value: thanText(w.than), lines: [trendLine(ok ? change(mw.than, view.priorInward.than) : null, view.compareText, { flat: 5 }), ok ? partialNote(view) : "",
      L(`${entriesText(w.entries)} · ${num(w.pieces)} pieces`, `${entriesText(w.entries)} · ${num(w.pieces)} नग`), w.value ? L(`Work worth about ${rs(w.value)} at today's rates`, `आज के Rate पर लगभग ${rs(w.value)} का काम`) : ""] }),
    kpi({ id: "kpi-cloth-sent", label: L("Sent back", "वापस भेजा"), value: L(`${num(w.sent)} pieces`, `${num(w.sent)} नग`), lines: [trendLine(ok ? change(mw.sent, view.priorInward.sent) : null, view.compareText, { flat: 5 }),
      L("Dispatches dated in the period", "इस अवधि की तारीख़ वाली जावक")] }),
    kpi({ id: "kpi-cloth-month", label: L(`This month so far · ${monthOnly(t.month)}`, `यह Month अब तक · ${monthOnly(t.month)}`), value: t.upTo ? thanText(t.than) : "—",
      tone: changeTone(sameDays, { flat: 5 }) === "bad" ? "warn" : "",
      lines: [t.upTo ? L(`Recorded through ${niceDate(t.upTo)} · ${entriesText(t.entries)}`, `${niceDate(t.upTo)} तक दर्ज · ${entriesText(t.entries)}`) : L("No inward entries recorded this month", "इस महीने कोई आवक दर्ज नहीं"),
        trendLine(sameDays, L("same recorded days last month", "पिछले महीने के इन्हीं दर्ज दिनों"), { flat: 5 }),
        t.upTo && sameDays === null ? L("No comparable prior-month data", "पिछले महीने का तुलनीय डेटा नहीं") : ""] }),
    kpi({ id: "kpi-cloth-stock", label: L("In the factory now", "अभी फ़ैक्ट्री में"), value: L(`${num(stock.pieces)} pieces`, `${num(stock.pieces)} नग`),
      lines: [L(`${entriesText(stock.entries)} · as of today`, `${entriesText(stock.entries)} · आज तक`), L(`${num(stock.undispatchedThan)} THAN on slips with no dispatch`, `बिना जावक वाली पर्चियों में ${num(stock.undispatchedThan)} थान`)] }),
  ];
  return [
    el("section", { class: "kpis primary", "aria-label": L("Cloth figures", "माल के आँकड़े") }, kpis),
    thanCard(view),
    clothTableCard(view),
    el("div", { class: "dash-two" }, [stockCard(view), quietCard(view)]),
    repairsCard(view),
  ];
}

function thanCard(view) {
  const months = chartMonths(view);
  const received = months.reduce((sum, month) => sum + inwardIn(view, month).than, 0);
  const billed = months.reduce((sum, month) => sum + billsIn(view, month).than, 0);
  return card("dash-than", L("Cloth received and cloth billed (THAN)", "आया माल और बिल हुआ माल (थान)"),
    L("Received includes repairs and uses inward date. Billed uses priced quantities and bill date. The difference is not stock or unbilled work.", "आवक में रिपेयर शामिल हैं और आवक की तारीख़ ली जाती है। बिलिंग में बिल के थान और बिल की तारीख़ ली जाती है। इनका अंतर स्टॉक या बिना बिल का काम नहीं है।"), [
      columnChart({ categories: months, labels: months.map(shortMonth), series: [
        { name: L("Received", "आया"), values: months.map((month) => inwardIn(view, month).than), className: "s-in", short: (v) => num(v) },
        { name: L("Billed", "बिल हुआ"), values: months.map((month) => billsIn(view, month).than), className: "s-billed", short: (v) => num(v) },
      ], format: thanText, axisFormat: (v) => num(Math.round(v)), selected: view.months, compared: view.shownCompare, onPick: pickMonth, height: 280 }),
      legend([["s-in", L(`Received: ${num(received)} THAN in these months`, `आया: इन Month में ${num(received)} थान`)], ["s-billed", L(`Billed: ${num(billed)} THAN`, `बिल हुआ: ${num(billed)} थान`)]]),
    ]);
}

function clothTableCard(view) {
  const months = chartMonths(view);
  const row = (label, w, billedThan, cls = "") => el("tr", { class: cls }, [
    el("td", { class: "left", text: label }), td(num(w.entries)), td(num(w.than), "num strong"), td(w.repairThan ? num(w.repairThan) : "—"), td(num(w.pieces)), td(num(w.sent)), td(num(billedThan)),
  ]);
  const heads = [th(L("Month", "Month"), "left"), th(L("Entries", "Entries")), th(L("THAN received", "आए थान")), th(L("Repairs (THAN)", "रिपेयर (थान)")), th(L("Pieces received", "आए नग")), th(L("Pieces sent back", "भेजे नग")), th(L("THAN billed", "बिल हुए थान"))];
  return card("dash-cloth-months", L("Cloth month by month", "Month-वार माल"), L("Picked months are highlighted", "चुने हुए Month हाइलाइट हैं"), [
    dashTable(heads, months.map((month) => row(longMonth(month), inwardIn(view, month), billsIn(view, month).than, view.months.includes(month) ? "picked" : "")), {
      foot: [row(L(`Picked: ${periodWords(view.months)}`, `चुनी अवधि: ${periodWords(view.months)}`), view.inward, view.billed.than, "total")],
    }),
  ], { actions: [csvButton("dashCsvCloth", "cloth", () => [
    [L("Month", "Month"), L("Entries", "Entries"), L("THAN received", "आए थान"), L("Repairs (THAN)", "रिपेयर (थान)"), L("Pieces received", "आए नग"), L("Pieces sent back", "भेजे नग"), L("THAN billed", "बिल हुए थान")],
    ...months.map((month) => { const w = inwardIn(view, month); return [month, w.entries, w.than, w.repairThan, w.pieces, w.sent, billsIn(view, month).than]; }),
  ])] });
}

function stockCard(view) {
  const stock = stockFor(view.partySet);
  const rows = [
    [L("Unbilled (standard)", "बिना बिल (सामान्य)"), stock.unbilled],
    [L("Unbilled (can bill before dispatch)", "बिना बिल (पहले बिल की अनुमति)"), stock.beforeDispatch],
    [L("Already billed or marked billed elsewhere", "बिल हो चुका या बाहर बिल दर्ज"), stock.billed],
    [L("No bill needed", "बिल की ज़रूरत नहीं"), stock.noBill],
    [L("Repairs", "रिपेयर"), stock.repairs],
  ];
  const row = (label, balance) => el("tr", {}, [
    el("td", { class: "left", text: label }),
    ...[balance.entries, balance.pieces, balance.undispatchedThan, balance.partialEntries].map((value) => td(num(value))),
  ]);
  return card("dash-stock", L("Recorded dispatch balance", "रजिस्टर में बाक़ी जावक"), L("As of today. Pieces left = THAN + TP + TWO PART − dispatched, per slip. This is not a physical stock count.", "आज तक। बाक़ी नग = हर पर्ची में थान + TP + TWO PART − जावक। यह असली स्टॉक की गिनती नहीं है।"), [
    dashTable([th(L("Status", "स्थिति"), "left"), th(L("Entries", "Entries")), th(L("Pieces left", "बाक़ी नग")), th(L("THAN on slips with no dispatch", "बिना जावक पर्चियों के थान")), th(L("Partly dispatched slips", "आंशिक जावक की पर्चियाँ"))],
      rows.map(([label, balance]) => row(label, balance)), { foot: [row(L("Total recorded balance", "कुल दर्ज बाक़ी"), stock.total)] }),
  ]);
}

function quietCard(view) {
  const quiet = quietFor(view.partySet);
  const end = niceDate(dashState.model.f.coverage.lastInward);
  return card("dash-quiet", view.parties.length === 1 ? L("Recent inward pace", "हाल की आवक की रफ़्तार") : L("Parties sending less cloth", "कम माल भेज रही पार्टियाँ"),
    end ? L(`30 days ending ${end} versus the earlier recorded pace`, `${end} तक के 30 दिनों की पुरानी दर्ज रफ़्तार से तुलना`) : "", [
      quiet.length ? dashTable([th(L("Party", "पार्टी"), "left"), th(L("Usual (THAN)", "सामान्य (थान)")), th(L("Last 30 days", "पिछले 30 दिन")), th(L("Last cloth came", "आख़िरी माल आया"))],
        quiet.map((q) => el("tr", {}, [
          el("td", { class: "left name-cell" }, [partyButton(q.party, "link-btn strong")]),
          td(num(q.usualThan)),
          td(num(q.recentThan), "num low"),
          td(L(`${niceDate(q.lastInward)} (${num(q.daysSinceLast)} days ago)`, `${niceDate(q.lastInward)} (${num(q.daysSinceLast)} दिन पहले)`), "num wrap-ok"),
        ]))) : emptyNote(L("No slowdown flagged in the available inward data.", "दर्ज आवक में कोई कमी चिन्हित नहीं।")),
    ]);
}

function repairsCard(view) {
  const m = dashState.model;
  const byParty = [...rollup(m.f.inward, { months: view.monthSet, parties: view.partySet, by: (row) => row[0] })]
    .map(([i, sum]) => ({ i, ...inwardOf(sum) })).filter((row) => row.repairThan > 0).sort((a, b) => b.repairThan - a.repairThan || b.repairEntries - a.repairEntries);
  const w = view.inward;
  return card("dash-repairs", L(`Re-work (REP.) in ${periodWords(view.months)}`, `${periodWords(view.months)} में रिपेयर`), L("Done again without a bill", "बिना बिल के दोबारा किया गया"), [
    w.repairThan ? el("div", {}, [
      el("p", { text: L(`${num(w.repairThan)} THAN in ${entriesText(w.repairEntries)} were re-done without a bill.`, `${num(w.repairEntries)} Entries में ${num(w.repairThan)} थान बिना बिल के दोबारा किए गए।`) }),
      view.parties.length === 1 ? "" : hbars(byParty.slice(0, 5).map((row, k) => ({ label: partyName(row.i), value: row.repairThan, color: k, text: thanText(row.repairThan), title: entriesText(row.repairEntries), onClick: () => openPartyPanel(row.i) }))),
    ]) : el("p", { class: "good-note", text: L("✓ No repairs in this period.", "✓ इस अवधि में कोई रिपेयर नहीं।") }),
  ]);
}

// ---------- GST ----------
function gstSection(view) {
  const months = chartMonths(view).filter((month) => billsIn(view, month).bills > 0 || view.months.includes(month));
  const hasIgst = view.byMonth.size && [...view.byMonth.values()].some((sum) => billOf(sum).igst > 0);
  const hasLocal = [...view.byMonth.values()].some((sum) => billOf(sum).cgst > 0 || billOf(sum).sgst > 0) || !hasIgst;
  const heads = (first) => [th(first, "left"), th(L("Bills", "बिल")), th(L("Billed before GST", "GST से पहले बिलिंग")), ...(hasLocal ? [th("CGST"), th("SGST")] : []), ...(hasIgst ? [th("IGST")] : []), th(L("GST total", "कुल GST")), th(L("Bill total", "बिल कुल"))];
  const cells = (b) => [td(num(b.bills)), td(rsFull(b.taxable)), ...(hasLocal ? [td(rsFull(b.cgst)), td(rsFull(b.sgst))] : []), ...(hasIgst ? [td(rsFull(b.igst))] : []), td(rsFull(b.gst), "num strong"), td(rsFull(b.total))];
  const row = (label, b, cls = "") => el("tr", { class: cls }, [el("td", { class: "left", text: label }), ...cells(b)]);
  const foot = [row(L(`Picked: ${periodWords(view.months)}`, `चुनी अवधि: ${periodWords(view.months)}`), view.billed, "total")];
  if (view.billChangeOk) foot.push(row(L(`${view.compareText} total`, `${view.compareText} कुल`), view.priorBilled, "muted-row"));
  const parties = partyRows(view).filter((p) => p.bills > 0);
  const csvHead = [L("Bills", "बिल"), L("Billed before GST", "GST से पहले बिलिंग"), "CGST", "SGST", "IGST", L("GST total", "कुल GST"), L("Bill total", "बिल कुल")];
  const csvCells = (b) => [b.bills, b.taxable, b.cgst, b.sgst, b.igst, b.gst, b.total];
  return [
    card("dash-gst", L("GST on your bills, month by month", "Month-वार आपके बिलों पर GST"), L("GST charged on saved invoices. Net GST payable is not calculated here.", "सेव बिलों पर लगा GST। शुद्ध देय GST यहाँ नहीं निकाला जाता।"), [
      months.length ? dashTable(heads(L("Month", "Month")), months.map((month) => row(longMonth(month), billsIn(view, month), view.months.includes(month) ? "picked" : "")), { foot })
        : emptyNote(L("No bills in these months yet.", "इन Month में अभी कोई बिल नहीं।")),
    ], { actions: [csvButton("dashCsvGst", "GST by month", () => [[L("Month", "Month"), ...csvHead], ...months.map((month) => [month, ...csvCells(billsIn(view, month))])])] }),
    card("dash-gst-parties", L(`GST by party, ${periodWords(view.months)}`, `पार्टी-वार GST, ${periodWords(view.months)}`), L("For the picked period and parties", "चुनी हुई अवधि और पार्टियों के लिए"), [
      parties.length ? dashTable(heads(L("Party", "पार्टी")), parties.map((p) => el("tr", {}, [el("td", { class: "left name-cell" }, [partyButton(p.i, "link-btn strong")]), ...cells(p)])), { foot: [row(L("Total", "कुल"), view.billed, "total")] })
        : emptyNote(L("No bills in this period.", "इस अवधि में कोई बिल नहीं।")),
    ], { actions: parties.length ? [csvButton("dashCsvGstParties", "GST by party", () => [[L("Party", "पार्टी"), ...csvHead], ...parties.map((p) => [p.name, ...csvCells(p)])])] : [] }),
  ];
}

function footnote() {
  return el("section", { class: "dash-foot" }, [
    el("h3", { text: L("How these figures are made", "ये आँकड़े कैसे बनते हैं") }),
    el("ul", {}, [
      L("Billed value is job charges after discount and before GST. Cancelled and future-dated bills are not counted in these totals.", "बिल राशि में Discount के बाद और GST से पहले का Job Charge है। रद्द और भविष्य की तारीख़ वाले बिल कुल में नहीं हैं।"),
      L("The queue uses configured rates less discount; without a rate it uses recent party or firm billing per THAN, if available. These are estimates, not invoice totals.", "बिलिंग सूची में तय Rate से Discount घटाते हैं। Rate न होने पर पार्टी या फ़र्म की हाल की प्रति थान बिलिंग, अगर उपलब्ध हो, लेते हैं। ये अनुमान हैं, बिल का कुल नहीं।"),
      L("Bills follow the party on the saved invoice; inward and stock follow the party in the register. Sister firms are not combined.", "बिल सेव किए गए बिल की पार्टी के अनुसार हैं; आवक और स्टॉक रजिस्टर की पार्टी के अनुसार हैं। सिस्टर फ़र्म अलग रहती हैं।"),
      L("This dashboard does not report cash received, outstanding collections, profit, or net tax payable.", "यह Dashboard मिली नक़दी, बाक़ी वसूली, मुनाफ़ा या शुद्ध देय कर नहीं दिखाता।"),
      L("The dashboard reads the data again every time you open it, every minute while it is open, and when you press Refresh.", "Dashboard हर बार खोलने पर, खुला रहने पर हर मिनट, और Refresh करें दबाने पर डेटा फिर से पढ़ता है।"),
    ].map((text) => el("li", { text }))),
  ]);
}

// ---------- One party in detail (slides in from the right) ----------
function openPartyPanel(i) {
  dashState.ui.panel = i;
  renderPartyPanel();
  openDrawer($("dashPartyPanel"), $("dashPanelClose"));
}

function renderPartyPanel() {
  const dialog = $("dashPartyPanel");
  const m = dashState.model;
  const i = dashState.ui.panel;
  if (i === null || !m?.f.parties[i]) {
    if (dialog.open) dialog.close();
    return;
  }
  const view = dashView();
  const party = m.f.parties[i];
  const only = new Set([i]);
  const total = (rows, months) => rollup(rows, { months, parties: only }).get(0);
  const b = billOf(total(m.f.bills, view.monthSet));
  const p = billOf(view.compareOn ? total(m.f.bills, view.compareSet) : null);
  const w = inwardOf(total(m.f.inward, view.monthSet));
  const u = unbilledFor(only);
  const stock = stockFor(only).total;
  const quiet = m.quiet.get(i);
  const byMonth = rollup(m.f.bills, { parties: only, by: (row) => row[1] });
  const inByMonth = rollup(m.f.inward, { parties: only, by: (row) => row[1] });
  const months = chartMonths(view);
  const c = view.billChangeOk ? change(billOf(total(m.f.bills, view.measuredSet)).taxable, p.taxable) : null;
  const flags = [party.group ? L(`Sister firms: ${party.group}`, `सिस्टर फ़र्म: ${party.group}`) : "", party.active ? "" : L("Inactive", "बंद"), party.noBill ? L("No bill needed", "बिल की ज़रूरत नहीं") : ""].filter(Boolean);
  const finishes = finishRows(view, only).slice(0, 6);
  const canBill = billsAvailable() && u.ready.entries > 0;
  const close = () => closeDrawer(dialog, true);
  dialog.replaceChildren(el("div", { class: "dash-panel" }, [
    el("header", { class: "drawer-head" }, [
      el("h2", {}, [party.name, el("span", { class: "sub", text: [periodWords(view.months), ...flags].join(" · ") })]),
      el("button", { type: "button", id: "dashPanelClose", class: "icon-btn", title: L("Close (Esc)", "बंद करें (Esc)"), "aria-label": L("Close", "बंद करें"), text: "×", onclick: close }),
    ]),
    el("div", { class: "drawer-body" }, [
      el("div", { class: "kpis mini" }, [
        kpi({ id: "panel-billed", label: L("Billed before GST", "GST से पहले बिलिंग"), value: b.bills ? rs(b.taxable) : "—", title: rsFull(b.taxable),
          lines: [trendLine(c, view.compareText), b.bills ? L(`${num(b.bills)} bills · ${num(b.than)} THAN`, `${num(b.bills)} बिल · ${num(b.than)} थान`) : ""] }),
        kpi({ id: "panel-share", label: L("Share of all billing", "कुल बिलिंग में हिस्सा"), value: view.allBilled.taxable ? pct((b.taxable * 100) / view.allBilled.taxable) : "—",
          lines: [b.than ? L(`${perThan(b.taxable / b.than)} per THAN`, `प्रति थान ${perThan(b.taxable / b.than)}`) : "", b.gross ? L(`Discount ${pct((b.discount * 100) / b.gross)}`, `Discount ${pct((b.discount * 100) / b.gross)}`) : ""] }),
        kpi({ id: "panel-waiting", label: L("Waiting to be billed", "बिल बाक़ी"), value: rs(u.ready.value), tone: u.ready.entries ? "warn" : "",
          lines: [L(`${entriesText(u.ready.entries)} · today`, `${entriesText(u.ready.entries)} · आज तक`), u.oldest ? L(`Oldest inward ${niceDate(u.oldest)}`, `सबसे पुरानी आवक ${niceDate(u.oldest)}`) : ""] }),
        kpi({ id: "panel-cloth", label: L("Cloth received", "आया माल"), value: thanText(w.than),
          lines: [L(`${num(stock.pieces)} pieces in the factory now`, `अभी फ़ैक्ट्री में ${num(stock.pieces)} नग`), party.lastInward ? L(`Last cloth ${niceDate(party.lastInward)}`, `आख़िरी माल ${niceDate(party.lastInward)}`) : ""] }),
      ]),
      quiet ? el("p", { class: "insight warn panel-note", text: L(`Sending less cloth: usually ${num(quiet.usualThan)} THAN in 30 days, ${num(quiet.recentThan)} in the last 30.`, `कम माल आ रहा है: आम तौर पर 30 दिन में ${num(quiet.usualThan)} थान, पिछले 30 दिन में ${num(quiet.recentThan)}।`) }) : "",
      el("section", { class: "section" }, [
        el("div", { class: "section-head" }, [el("h3", { text: L("Month by month", "Month-वार") }), el("span", { class: "muted", text: L("Bars: billed before GST", "खंभे: GST से पहले बिलिंग") })]),
        columnChart({ categories: months, labels: months.map(shortMonth), series: [{ name: L("Billed before GST", "GST से पहले बिलिंग"), values: months.map((month) => billOf(byMonth.get(monthIndexOf(month))).taxable), className: "s-income", short: rsChart }],
          format: rsFull, axisFormat: rsChart, selected: view.months, compared: view.shownCompare, onPick: pickMonth, showValues: months.length <= 12, height: 300, width: 820 }),
        dashTable([th(L("Month", "Month"), "left"), th(L("Billed", "बिलिंग")), th(L("THAN billed", "बिल में थान")), th(L("Cloth received", "आया माल"))],
          months.filter((month) => byMonth.has(monthIndexOf(month)) || inByMonth.has(monthIndexOf(month))).reverse().map((month) => {
            const mb = billOf(byMonth.get(monthIndexOf(month)));
            const mw = inwardOf(inByMonth.get(monthIndexOf(month)));
            return el("tr", { class: view.months.includes(month) ? "picked" : "" }, [td(longMonth(month), "left"), td(mb.bills ? rsFull(mb.taxable) : "—"), td(mb.than ? num(mb.than) : "—"), td(mw.than ? num(mw.than) : "—")]);
          })),
      ]),
      el("section", { class: "section" }, [
        el("div", { class: "section-head" }, [el("h3", { text: L("Finishes in the period", "इस अवधि की फ़िनिश") }), el("span", { class: "muted", text: L("Job charges before discount", "Discount से पहले Job Charge") })]),
        finishes.length ? hbars(finishes.map((f, k) => ({ label: f.finish, value: f.amount, color: k, text: rs(f.amount), title: L(`${num(f.than)} THAN · ${perThan(f.rate)} average`, `${num(f.than)} थान · औसत ${perThan(f.rate)}`) })))
          : emptyNote(L("No bills in this period.", "इस अवधि में कोई बिल नहीं।")),
      ]),
      el("p", { class: "muted", text: [
        L(`Last bill: ${party.lastBill ? niceDate(party.lastBill) : "none"}`, `आख़िरी बिल: ${party.lastBill ? niceDate(party.lastBill) : "नहीं"}`),
        L(`Last dated dispatch: ${party.lastDispatch ? niceDate(party.lastDispatch) : "none"}`, `आख़िरी जावक: ${party.lastDispatch ? niceDate(party.lastDispatch) : "नहीं"}`),
      ].join(" · ") }),
    ]),
    el("footer", { class: "drawer-foot" }, [
      el("button", { type: "button", id: "dashPanelOnly", text: L("Show only this party", "केवल यह पार्टी दिखाएँ"), onclick: () => { close(); setParties([i]); } }),
      el("button", { type: "button", id: "dashPanelCompare", class: "secondary", text: L("Add to comparison", "तुलना में जोड़ें"),
        onclick: () => { close(); const list = [...new Set([...dashView().parties, i])]; dashSelect({ parties: list.map(partyName), section: "compare" }, { top: true }); } }),
      canBill ? el("button", { type: "button", id: "dashPanelBill", class: "secondary", text: L("Review entries to bill", "बिल के लिए Entries जाँचें"), onclick: () => { close(); makeBillFor(party.name, u.oldest).catch(showFatal); } }) : "",
    ]),
  ]));
}

// ---------- Choosing parties from a list ----------
function openPicker() {
  dashState.ui.pick = new Set(dashView().parties);
  dashState.ui.pickFilter = "";
  renderPicker();
  openDrawer($("dashPicker"), $("dashPickerSearch"));
}

function pickerOrder(view) {
  const m = dashState.model;
  const billed = rollup(m.f.bills, { months: view.monthSet, by: (row) => row[0] });
  const value = (i) => billOf(billed.get(i)).taxable;
  return { billed: value, order: [...m.order].sort((a, b) => value(b) - value(a) || m.order.indexOf(a) - m.order.indexOf(b)) };
}

function pickerItems(view) {
  const m = dashState.model;
  const tokens = normalize(dashState.ui.pickFilter).split(" ").filter(Boolean);
  const { billed, order } = pickerOrder(view);
  const shown = order.filter((i) => tokens.every((token) => m.norm[i].includes(token) || normalize(m.f.parties[i].group).includes(token)));
  if (!shown.length) return [emptyNote(L("No party matches.", "कोई पार्टी नहीं मिली।"))];
  return shown.map((i) => {
    const party = m.f.parties[i];
    const box = el("input", { type: "checkbox", "data-party": String(i) });
    box.checked = dashState.ui.pick.has(i);
    box.addEventListener("change", () => {
      if (box.checked) dashState.ui.pick.add(i); else dashState.ui.pick.delete(i);
      updatePickerCount();
    });
    return el("label", { class: `check dash-pick${party.active ? "" : " inactive"}` }, [box,
      el("span", { class: "dash-pick-name", text: party.name }),
      party.group ? el("span", { class: "tag", text: party.group }) : "",
      el("span", { class: "dash-pick-hint", text: billed(i) ? rs(billed(i)) : party.active ? "" : L("inactive", "बंद") }),
    ]);
  });
}

function updatePickerCount() {
  const count = dashState.ui.pick.size;
  const text = $("dashPickerCount");
  if (text) text.textContent = count ? L(`${partiesText(count)} ticked`, `${partiesText(count)} चुनी हुई`) : L("None ticked: all parties are shown", "कोई नहीं चुनी: सभी पार्टियाँ दिखेंगी");
}

function renderPicker() {
  const dialog = $("dashPicker");
  const m = dashState.model;
  const view = dashView();
  const list = el("div", { class: "dash-pick-list", id: "dashPickerList" }, pickerItems(view));
  const redraw = () => {
    list.replaceChildren(...pickerItems(view));
    updatePickerCount();
  };
  const search = el("input", { type: "search", id: "dashPickerSearch", value: dashState.ui.pickFilter, placeholder: L("Find a party or sister group…", "पार्टी या सिस्टर ग्रुप खोजें…"), "aria-label": L("Find a party", "पार्टी खोजें") });
  search.addEventListener("input", () => {
    dashState.ui.pickFilter = search.value;
    redraw();
  });
  const pickTop = (count) => {
    dashState.ui.pick = new Set(topParties(view, count));
    redraw();
  };
  const groups = [...m.groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  const close = () => closeDrawer(dialog, true);
  dialog.replaceChildren(el("div", { class: "dash-panel" }, [
    el("header", { class: "drawer-head" }, [
      el("h2", {}, [L("Choose parties", "पार्टियाँ चुनें"), el("span", { class: "sub", text: L(`Ordered by billing in ${periodWords(view.months)}`, `${periodWords(view.months)} की बिलिंग के क्रम में`) })]),
      el("button", { type: "button", class: "icon-btn", title: L("Close (Esc)", "बंद करें (Esc)"), "aria-label": L("Close", "बंद करें"), text: "×", onclick: close }),
    ]),
    el("div", { class: "drawer-body dash-pick-body" }, [
      search,
      el("div", { class: "dash-side-actions" }, [
        el("button", { type: "button", class: "secondary small", text: L("Top 5", "शीर्ष 5"), onclick: () => pickTop(5) }),
        el("button", { type: "button", class: "secondary small", text: L("Top 10", "शीर्ष 10"), onclick: () => pickTop(10) }),
        el("button", { type: "button", class: "secondary small", text: L("Tick all shown", "दिख रही सब चुनें"), onclick: () => {
          for (const box of list.querySelectorAll("input[data-party]")) dashState.ui.pick.add(Number(box.dataset.party));
          redraw();
        } }),
        el("button", { type: "button", class: "ghost small", text: L("Clear ticks", "चुनाव हटाएँ"), onclick: () => { dashState.ui.pick.clear(); redraw(); } }),
      ]),
      groups.length ? el("div", { class: "dash-groups" }, [el("span", { class: "muted", text: L("Sister firms:", "सिस्टर फ़र्म:") }), ...groups.map((g) => el("button", { type: "button", class: "secondary small", title: g.parties.map(partyName).join(", "),
        text: `${g.name} (${g.parties.length})`, onclick: () => {
          const all = g.parties.every((i) => dashState.ui.pick.has(i));
          for (const i of g.parties) if (all) dashState.ui.pick.delete(i); else dashState.ui.pick.add(i);
          redraw();
        } }))]) : "",
      list,
    ]),
    el("footer", { class: "drawer-foot" }, [
      el("button", { type: "button", id: "dashPickerApply", text: L("Show these parties", "ये पार्टियाँ दिखाएँ"), onclick: () => { const pick = [...dashState.ui.pick]; close(); setParties(pick); } }),
      el("button", { type: "button", class: "secondary", text: L("Cancel", "रद्द करें"), onclick: close }),
      el("span", { class: "muted", id: "dashPickerCount" }),
    ]),
  ]));
  updatePickerCount();
}

/**
 * Opens Bills → Make bills for the party in the current bill month, with the period moved back to its oldest unbilled entry,
 * so every entry the dashboard counted is listed (whatever period was left from the last time bills were made).
 */
async function makeBillFor(party, oldest) {
  switchView("bills");
  switchSubview("bills", "make");
  $("billMonth").value = todayIso().slice(0, 7);
  applyMonthDates();
  if (oldest && oldest < $("periodFrom").value) $("periodFrom").value = oldest;
  await loadCandidates(party);
}

const billsAvailable = () => state.info?.showBills !== false && typeof loadCandidates === "function";
