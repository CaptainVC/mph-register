"use strict";

// Dashboard: adding up the facts for the chosen months and parties.

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

// ---------- Work still open today (as of today, for the cloth that came in during the period), stock and this month's inward ----------
const addWork = (a, b) => ({ entries: a.entries + b.entries, than: a.than + b.than, value: a.value + b.value });

/** One party's open work from two inward months, added up. */
function joinUnbilled(a, b) {
  return {
    ...Object.fromEntries(WORK_KEYS.map((key) => [key, addWork(a[key], b[key])])),
    party: a.party,
    month: a.month,
    ageing: a.ageing.map((bucket, i) => addWork(bucket, b.ageing[i])),
    oldest: [a.oldest, b.oldest].filter(Boolean).sort()[0] ?? null,
    daysWaiting: Math.max(a.daysWaiting, b.daysWaiting),
  };
}

/** Open work for the parties in view that came in during the months in view, one row per party. */
function unbilledFor(partySet, monthSet) {
  const byParty = new Map();
  for (const u of dashState.model.f.unbilled) {
    if ((partySet && !partySet.has(u.party)) || (monthSet && !monthSet.has(u.month))) continue;
    byParty.set(u.party, byParty.has(u.party) ? joinUnbilled(byParty.get(u.party), u) : u);
  }
  const rows = [...byParty.values()];
  const add = addWork;
  const total = Object.fromEntries(WORK_KEYS.map((key) => [key, rows.reduce((sum, u) => add(sum, u[key]), ZERO_WORK)]));
  total.ageing = AGE_KEYS.map((key, i) => ({ key, ...rows.reduce((sum, u) => add(sum, u.ageing[i]), ZERO_WORK) }));
  total.rows = rows;
  total.oldest = rows.map((u) => u.oldest).filter(Boolean).sort()[0] ?? null;
  total.daysWaiting = Math.max(0, ...rows.map((u) => u.daysWaiting));
  return total;
}

function stockFor(partySet, monthSet) {
  const rows = dashState.model.f.stock.filter((row) => (!partySet || partySet.has(row.party)) && (!monthSet || monthSet.has(row.month)));
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

/** Slowdowns are judged on the last 30 days, so they only belong to a period that includes the month still running. */
function quietFor(view) {
  return view.includesCurrent ? dashState.model.f.quiet.filter((q) => !view.partySet || view.partySet.has(q.party)) : [];
}

/** Each party in view with its billing in the period and the comparison, cloth received and work waiting. */
function partyRows(view) {
  if (view.cache.partyRows) return view.cache.partyRows;
  const m = dashState.model;
  const now = rollup(m.f.bills, { months: view.monthSet, parties: view.partySet, by: (row) => row[0] });
  const before = view.compareOn ? rollup(m.f.bills, { months: view.compareSet, parties: view.partySet, by: (row) => row[0] }) : new Map();
  const measured = view.partial ? rollup(m.f.bills, { months: view.measuredSet, parties: view.partySet, by: (row) => row[0] }) : now;
  const inward = rollup(m.f.inward, { months: view.monthSet, parties: view.partySet, by: (row) => row[0] });
  const open = new Map(unbilledFor(view.partySet, view.monthSet).rows.map((u) => [u.party, u]));
  const ids = new Set([...now.keys(), ...before.keys(), ...inward.keys(), ...(view.partySet ?? [])]);
  for (const [i, u] of open) if (u.ready.entries) ids.add(i);
  const all = view.allBilled.taxable;
  view.cache.partyRows = [...ids].map((i) => {
    const b = billOf(now.get(i));
    const p = billOf(before.get(i));
    const counted = billOf(measured.get(i)).taxable;
    const w = inwardOf(inward.get(i));
    const u = open.get(i);
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
    ["unbilled", "🧾", L("To be billed", "बिल बनाना बाक़ी"), L("Work with no bill yet, from cloth received in the period", "इस अवधि में आए जिस माल का आज तक बिल नहीं बना")],
    ["cloth", "📦", L("Cloth & stock", "माल और स्टॉक"), L("Cloth received, sent back and in the factory", "आया माल, भेजा माल और फ़ैक्ट्री में माल")],
    ["gst", "🏛", L("GST", "GST"), L("GST charged on your bills", "आपके बिलों पर लगा GST")],
  ];
}
