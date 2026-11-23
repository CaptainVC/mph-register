"use strict";

// Business dashboard. One request (/api/dashboard/facts) brings every month's billing, finishes, inward and dispatch per
// party, plus today's billing queue and stock. The screen adds up whichever months and parties are picked by itself, so
// changing the selection never waits for the server. The figures are asked for again when the tab is opened, when the window
// comes back into view and every five minutes while it is shown; while nothing changed the server answers 304 (not modified), which
// costs next to nothing. Written in plain words, with big numbers in lakh / crore, in English or Hindi.
const DASH_REFRESH_MS = 300000;
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
