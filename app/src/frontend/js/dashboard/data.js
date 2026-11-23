"use strict";

// Dashboard: the saved selection, fetching the facts and refreshing them.

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
