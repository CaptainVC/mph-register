"use strict";

// Financial dashboard. The server works every figure out from the register, the saved bills and the rates each time it is
// asked; this screen asks again whenever it is opened, when the window comes back into view and every minute while it is shown,
// so it always follows the data. Written in plain words, with big numbers in lakh / crore, in English or Hindi.
const dashState = { data: null, fy: "", month: "", party: "", ticket: 0, loadedAt: 0, allParties: false, allFinishes: false, allUnbilled: false, error: "" };
const DASH_REFRESH_MS = 60000;
const DASH_MIN_GAP_MS = 5000;
const SVG_NS = "http://www.w3.org/2000/svg";
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const AGE_TEXT = {
  "0-30": ["Up to 30 days", "30 दिन तक"],
  "31-60": ["31 to 60 days", "31 से 60 दिन"],
  "61-90": ["61 to 90 days", "61 से 90 दिन"],
  "90+": ["Over 90 days", "90 दिन से ज़्यादा"],
};
const DASH_PARTY_ROWS = 10;
const DASH_FINISH_ROWS = 10;
const DASH_UNBILLED_ROWS = 12;
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

/** Financial year (April to March) of an ISO date, like "26-27". */
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

function billChange(d, selected, previous) {
  return selected?.bills && previous?.bills && selected.month < d.today.slice(0, 7)
    ? change(selected.taxable, previous.taxable)
    : null;
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

// ---------- Loading (always from the server, so the figures follow the data) ----------
function dashboardShown() {
  return $("view-dashboard")?.classList.contains("active") && document.visibilityState === "visible";
}

async function showDashboard() {
  await loadDashboard();
}

async function loadDashboard({ quiet = false } = {}) {
  const ticket = ++dashState.ticket;
  const root = $("dashRoot");
  if (!dashState.data && !quiet) root.replaceChildren(el("div", { class: "dash-loading", text: L("Working out the figures…", "आँकड़े तैयार हो रहे हैं…") }));
  const query = new URLSearchParams();
  if (dashState.fy) query.set("fy", dashState.fy);
  if (dashState.month) query.set("month", dashState.month);
  if (dashState.party) query.set("party", dashState.party);
  try {
    const data = await api(`/api/dashboard?${query}`);
    if (ticket !== dashState.ticket) return;
    dashState.data = data;
    dashState.fy = data.fy;
    dashState.month = data.month;
    dashState.party = data.party ?? "";
    dashState.loadedAt = Date.now();
    dashState.error = "";
    renderDashboard();
  } catch (error) {
    if (ticket !== dashState.ticket) return;
    dashState.error = error.message;
    dashState.party = dashState.data?.party ?? "";
    if (!dashState.data) {
      root.replaceChildren(el("div", { class: "report err" }, [el("b", { text: L("Could not work out the dashboard.", "Dashboard नहीं बन सका।") }), el("p", { text: error.message })]));
    } else {
      renderDashboard();
    }
  }
}

function refreshIfShown() {
  if (!dashboardShown() || Date.now() - dashState.loadedAt < DASH_MIN_GAP_MS) return;
  if (document.querySelector("dialog[open], #dashRoot [aria-expanded=true]")) return;
  loadDashboard({ quiet: true }).catch(() => {});
}

setInterval(refreshIfShown, DASH_REFRESH_MS);
window.addEventListener("focus", refreshIfShown);
document.addEventListener("visibilitychange", refreshIfShown);
document.addEventListener("mph-lang", () => { if (dashState.data) renderDashboard(); });
document.addEventListener("mph-theme", () => { if (dashState.data) renderDashboard(); });

function pickYear(fy) {
  dashState.fy = fy;
  dashState.month = "";
  loadDashboard().catch(showFatal);
}

function pickMonth(month) {
  if (month === dashState.month) return;
  dashState.month = month;
  loadDashboard({ quiet: true }).catch(showFatal);
}

function pickParty(party) {
  if (party === dashState.party) return;
  dashState.party = party;
  dashState.allFinishes = false;
  dashState.allUnbilled = false;
  renderDashboard();
  loadDashboard().catch(showFatal);
}

function scrollToCard(id) {
  $(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
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

// ---------- Screen ----------
function renderDashboard() {
  const d = dashState.data;
  const main = $("main");
  const scroll = main.scrollTop;
  const focusParty = document.activeElement === $("dashParty");
  const index = d.monthly.findIndex((m) => m.month === d.month);
  const selected = d.monthly[index] || null;
  const previous = index > 0 ? d.monthly[index - 1] : null;
  const view = { d, selected, previous, isCurrent: d.fy === fyOf(d.today) };
  const pendingParty = dashState.party !== (d.party ?? "");
  const cards = pendingParty ? [el("div", { class: "dash-loading", role: "status", text: L("Working out the figures…", "आँकड़े तैयार हो रहे हैं…") })] : [
    insightsCard(view),
    kpis(view),
    ...(d.party ? [overallCard(view)] : []),
    monthlyIncomeCard(view),
    thanCard(view),
    d.party ? finishesCard(view) : el("div", { class: "dash-two" }, [partiesCard(view), finishesCard(view)]),
    unbilledCard(view),
    stockCard(view),
    gstCard(view),
    el("div", { class: "dash-two" }, [quietCard(view), repairsCard(view)]),
    footnote(view),
  ];
  $("dashRoot").replaceChildren(header(view, pendingParty), ...cards);
  if (focusParty) $("dashParty").focus({ preventScroll: true });
  main.scrollTop = scroll;
}

function header({ d }, pendingParty) {
  const year = dropdownOf(d.years.map((fy) => [String(fy), fyText(fy)]), d.fy,
    { id: "dashYear", "aria-label": L("Financial year", "Financial Year"), title: L("April to March", "April से March") });
  year.addEventListener("change", () => pickYear(year.value));
  const month = dropdownOf([...d.months].reverse().map((m) => [m, longMonth(m)]), d.month,
    { id: "dashMonth", "aria-label": L("Month", "Month") });
  month.addEventListener("change", () => pickMonth(month.value));
  const names = d.partyOptions.includes(dashState.party) || !dashState.party ? d.partyOptions : [...d.partyOptions, dashState.party];
  const party = dropdownOf([["", L("All parties", "सभी पार्टियाँ")], ...names.map((name) => [name, name])],
    dashState.party, { id: "dashParty", "aria-label": L("Party", "पार्टी"), title: dashState.party });
  party.addEventListener("change", () => pickParty(party.value));
  const refresh = el("button", { type: "button", id: "dashRefresh", class: "secondary", text: L("↻ Refresh", "↻ Refresh करें"), onclick: () => loadDashboard().catch(showFatal) });
  const time = new Date(dashState.loadedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const status = dashState.error
    ? el("p", { class: "dash-sub err", text: L(`Could not refresh just now (${dashState.error}). Showing the figures from ${time}.`, `अभी Refresh नहीं हो सका (${dashState.error})। ${time} के आँकड़े दिख रहे हैं।`) })
    : el("p", { class: "dash-sub", text: L(`Worked out from your register and bills at ${time}. It updates on its own.`, `आपके रजिस्टर और बिलों से ${time} पर तैयार किया गया। यह अपने-आप अपडेट होता है।`) });
  const dates = [
    [L("Last inward", "आख़िरी आवक"), d.coverage.lastInward],
    [L("Last dated dispatch", "आख़िरी तारीख़ वाली जावक"), d.coverage.lastDispatch],
    [L("Last saved bill", "आख़िरी सेव किया बिल"), d.coverage.lastBill],
  ].map(([label, date]) => `${label}: ${date ? niceDate(date) : L("none recorded", "दर्ज नहीं")}`).join(" · ");
  return el("div", { class: "card dash-head" }, [
    el("div", { class: "dash-title" }, [el("h1", { text: L("Business dashboard", "व्यापार Dashboard") }),
      ...(pendingParty ? [] : [status, el("p", { class: "dash-sub", id: "dash-coverage", text: dates })]),
      el("p", { class: "dash-sub", text: L("Year and month apply to billing and history. The queue, stock and current inward show the chosen party or all parties through today.", "साल और महीना बिलिंग और पुराने आँकड़ों पर लागू हैं। बिलिंग सूची, स्टॉक और मौजूदा आवक चुनी हुई पार्टी या सभी पार्टियों के लिए आज तक हैं।") }),
      dashState.party ? el("p", { class: "dash-sub", text: L("Bills follow the party on the saved invoice; inward and stock follow the party in the register. Sister firms are not combined.", "बिल सेव किए गए बिल की पार्टी के अनुसार हैं; आवक और स्टॉक रजिस्टर की पार्टी के अनुसार हैं। सिस्टर फ़र्म अलग रहती हैं।") }) : ""]),
    el("div", { class: "dash-controls" }, [
      el("div", { class: "field dash-party-field" }, [el("label", { for: "dashParty", text: L("Party", "पार्टी") }), party]),
      el("div", { class: "field" }, [el("label", { for: "dashYear", text: L("Financial year", "Financial Year") }), year]),
      el("div", { class: "field" }, [el("label", { for: "dashMonth", text: L("Month to look at", "देखने का Month") }), month]),
      refresh,
    ]),
  ]);
}

function overallCard({ d, selected }) {
  const overall = d.overall;
  const rows = [
    [longMonth(d.month), selected.taxable, overall.monthTaxable],
    [L(`Financial year ${fyText(d.fy)}`, `Financial Year ${fyText(d.fy)}`), d.year.taxable, overall.yearTaxable],
  ];
  const headings = [L("Period", "अवधि"), d.party, L("All parties", "सभी पार्टियाँ"), L("Share of all parties", "सभी पार्टियों में हिस्सा")];
  return el("section", { class: "card dash-card", id: "dash-overall" }, [
    el("div", { class: "card-head" }, [el("h2", { text: L("Compared with all parties", "सभी पार्टियों से तुलना") }),
      el("span", { class: "muted", text: L("Billed before GST · all parties includes the selected party", "GST से पहले बिलिंग · सभी पार्टियों में चुनी हुई पार्टी शामिल है") })]),
    el("div", { class: "table-scroll" }, [el("table", { class: "dash-table" }, [
      el("thead", {}, [el("tr", {}, headings.map((text, i) => el("th", { class: i ? "num" : "left", text })))]),
      el("tbody", {}, rows.map(([period, partyValue, allValue]) => el("tr", {}, [
        el("th", { scope: "row", class: "left", text: period }),
        el("td", { class: "num strong", title: rsFull(partyValue), text: rs(partyValue) }),
        el("td", { class: "num", title: rsFull(allValue), text: rs(allValue) }),
        el("td", { class: "num", text: allValue > 0 ? pct(partyValue * 100 / allValue) : "—" }),
      ]))),
    ])]),
    overall.yearThan > 0 ? el("p", { class: "muted", text: L(
      `Financial year per priced THAN: ${d.year.than ? perThan(d.year.taxable / d.year.than) : "—"} for ${d.party}, ${perThan(overall.yearTaxable / overall.yearThan)} for all parties. Finish mixes and rates may differ.`,
      `Financial Year में प्रति थान: ${d.party} की राशि ${d.year.than ? perThan(d.year.taxable / d.year.than) : "—"}, सभी पार्टियों की ${perThan(overall.yearTaxable / overall.yearThan)}। फ़िनिश और Rate अलग हो सकते हैं।`,
    ) }) : "",
  ]);
}

// ---------- What needs attention: plain sentences worked out from the figures ----------
function buildInsights({ d, selected, previous, isCurrent }) {
  const list = [];
  const u = d.unbilled;
  const y = d.year;
  const topUnbilled = !d.party && d.unbilledParties.find((p) => p.value > 0);
  const scroll = (id) => ({ text: L("See the list", "List देखें"), run: () => scrollToCard(id) });

  if (u.oldEntries > 0) {
    list.push({ tone: "warn", icon: "⏰", title: L("Older entries need bill reconciliation", "पुरानी Entries के बिल मिलाएँ"),
      text: L(`${entriesText(u.oldEntries)} with an estimated value of ${rs(u.oldValue)} have been in the queue over ${u.oldAfterDays} days. Check old bills and dispatch records before invoicing.`,
        `${rs(u.oldValue)} के अनुमान की ${entriesText(u.oldEntries)} ${u.oldAfterDays} दिन से ज़्यादा पुरानी हैं। बिल बनाने से पहले पुराने बिल और जावक जाँचें।`),
      action: scroll("dash-unbilled") });
  }
  if (u.readyEntries > 0) {
    list.push({ tone: "warn", icon: "🧾", title: L("Billing queue needs review", "बिलिंग सूची की जाँच करें"),
      text: L(`No bill link recorded for ${entriesText(u.readyEntries)} (${num(u.readyThan)} THAN), estimated at ${rs(u.readyValue)}.${topUnbilled ? ` Largest: ${topUnbilled.party} (${rs(topUnbilled.value)}).` : ""}`,
        `${entriesText(u.readyEntries)} (${num(u.readyThan)} थान) का बिल लिंक नहीं मिला। अनुमान ${rs(u.readyValue)}।${topUnbilled ? ` सबसे ज़्यादा: ${topUnbilled.party} (${rs(topUnbilled.value)})।` : ""}`),
      action: scroll("dash-unbilled") });
  }
  if (selected) {
    if (selected.bills === 0) {
      list.push({ tone: "info", icon: "📅", title: L(`No bills yet for ${longMonth(selected.month)}`, `${longMonth(selected.month)} के अभी कोई बिल नहीं`),
        text: L("Bills are usually made at the end of the month. Choose another month above to see its figures.", "बिल आम तौर पर महीने के अंत में बनते हैं। उसके आँकड़े देखने के लिए ऊपर कोई और Month चुनें।") });
    } else {
      const c = billChange(d, selected, previous);
      list.push({ tone: changeTone(c), icon: c === null ? "📅" : c >= 0 ? "📈" : "📉", title: L(`Billed before GST in ${longMonth(selected.month)}: ${rs(selected.taxable)}`, `${longMonth(selected.month)} की GST से पहले की बिल राशि: ${rs(selected.taxable)}`),
        text: c !== null
          ? L(`${changeText(c, monthOnly(previous.month))} (${rs(previous.taxable)}). ${num(selected.bills)} bills for ${num(selected.than)} THAN.`,
            `${changeText(c, monthOnly(previous.month))} (${rs(previous.taxable)})। ${num(selected.than)} थान के ${num(selected.bills)} बिल।`)
          : L(`${num(selected.bills)} bills for ${num(selected.than)} THAN.`, `${num(selected.than)} थान के ${num(selected.bills)} बिल।`) });
    }
  }
  if (isCurrent && y.projected > 0) {
    list.push({ tone: "info", icon: "🎯", title: L(`Annualized billing pace: ${rs(y.projected)}`, `सालाना बिलिंग की मौजूदा रफ़्तार: ${rs(y.projected)}`),
      text: L("Average billed value of completed months × 12. This is not a forecast.", "पूरे हुए महीनों का औसत बिल मूल्य × 12। यह भविष्यवाणी नहीं है।") });
  }
  if (d.compared) {
    const cmp = d.compared;
    const c = change(cmp.thisYear, cmp.lastYear);
    const span = cmp.fromMonth === cmp.toMonth ? monthOnly(cmp.fromMonth) : `${monthOnly(cmp.fromMonth)}–${monthOnly(cmp.toMonth)}`;
    list.push({ tone: changeTone(c), icon: c >= 0 ? "📈" : "📉", title: L(`Compared with last year (${span})`, `पिछले साल से तुलना (${span})`),
      text: L(`Billed before GST in ${span}: ${rs(cmp.thisYear)}, ${changeText(c, "the same months last year")} (${rs(cmp.lastYear)}).`,
        `${span} में GST से पहले बिल राशि ${rs(cmp.thisYear)}: ${changeText(c, "पिछले साल के इन्हीं महीनों")} (${rs(cmp.lastYear)})।`) });
  }
  if (!d.party && d.parties.length >= 3 && y.taxable > 0) {
    const top = d.parties[0];
    const five = d.parties.slice(0, 5);
    const fiveShare = five.reduce((s, p) => s + p.share, 0);
    const risky = fiveShare >= 60 || top.share >= 25;
    list.push({ tone: risky ? "warn" : "info", icon: "🤝", title: L("Billing by customer", "पार्टी के अनुसार बिलिंग"),
      text: L(`${top.party} accounts for ${pct(top.share)} of billed value; the top ${five.length} parties account for ${pct(fiveShare)}.`,
        `${top.party} का हिस्सा बिल राशि का ${pct(top.share)} है; सबसे बड़ी ${five.length} पार्टियों का कुल हिस्सा ${pct(fiveShare)} है।`),
      action: scroll("dash-parties") });
  }
  if (d.quietParties.length) {
    const names = d.quietParties.slice(0, 3).map((p) => L(`${p.party} (usually ${num(p.usualThan)}, now ${num(p.recentThan)} THAN)`, `${p.party} (आम तौर पर ${num(p.usualThan)}, अब ${num(p.recentThan)} थान)`)).join(", ");
    const end = niceDate(d.overall?.lastInward ?? d.coverage.lastInward);
    list.push({ tone: "warn", icon: "📞", title: d.party ? L("Sending less cloth", "कम माल आ रहा है") : L("Parties sending less cloth", "कम माल भेज रही पार्टियाँ"),
      text: L(`In the 30 days ending ${end}, the register shows less cloth than usual from: ${names}.`,
        `${end} तक के 30 दिनों में रजिस्टर में आवक सामान्य से कम है: ${names}।`),
      action: scroll("dash-quiet") });
  }
  if (selected && selected.cgst + selected.sgst + selected.igst > 0) {
    const gst = selected.cgst + selected.sgst + selected.igst;
    const parts = [selected.cgst ? `CGST ${rsFull(selected.cgst)}` : "", selected.sgst ? `SGST ${rsFull(selected.sgst)}` : "", selected.igst ? `IGST ${rsFull(selected.igst)}` : ""].filter(Boolean).join(" + ");
    list.push({ tone: "info", icon: "🏛", title: L(`GST on ${longMonth(selected.month)} bills: ${rsFull(gst)}`, `${longMonth(selected.month)} के बिलों पर GST: ${rsFull(gst)}`),
      text: L(`${parts}. GST charged on saved bills, not what is payable after credits, adjustments or payments.`,
        `${parts}। यह सेव किए बिलों पर लगा GST है, क्रेडिट, समायोजन और भुगतान के बाद देय राशि नहीं।`),
      action: scroll("dash-gst") });
  }
  if (y.discount > 0 && y.gross > 0) {
    const biggest = !d.party && d.parties.slice(0, 15).filter((p) => p.discountPercent > 0).sort((a, b) => b.discountPercent - a.discountPercent)[0];
    list.push({ tone: "info", icon: "🏷", title: L(`Discount given in ${fyText(d.fy)}: ${rs(y.discount)}`, `${fyText(d.fy)} में दिया गया Discount: ${rs(y.discount)}`),
      text: L(`That is ${pct((y.discount / y.gross) * 100)} of all job charges.${biggest ? ` Highest among the bigger parties: ${biggest.party} at ${pct(biggest.discountPercent)}.` : ""}`,
        `यह कुल Job Charge का ${pct((y.discount / y.gross) * 100)} है।${biggest ? ` बड़ी पार्टियों में सबसे ज़्यादा: ${biggest.party}, ${pct(biggest.discountPercent)}।` : ""}`) });
  }
  if (!d.party && y.than > 0) {
    const average = y.taxable / y.than;
    const lowest = d.parties.filter((p) => p.than >= Math.max(500, y.than * 0.02)).sort((a, b) => a.perThan - b.perThan)[0];
    if (lowest && lowest.perThan < average * 0.92) {
      list.push({ tone: "info", icon: "⚖", title: L("Below-average billing per THAN", "औसत से कम प्रति थान बिलिंग"),
        text: L(`${lowest.party} was billed ${perThan(lowest.perThan)} per priced THAN after discount, versus the overall ${perThan(average)}. The mix of finishes and rates may differ.`,
          `${lowest.party} की Discount के बाद प्रति थान बिलिंग ${perThan(lowest.perThan)} है, कुल औसत ${perThan(average)} है। फ़िनिश और Rate अलग हो सकते हैं।`),
        action: scroll("dash-parties") });
    }
  }
  if (u.noRateEntries > 0) {
    list.push({ tone: "warn", icon: "✎", title: L("Some work has no finish or rate yet", "कुछ काम में फ़िनिश या Rate नहीं है"),
      text: L(`${entriesText(u.noRateEntries)} (${num(u.noRateThan)} THAN) with no bill link lack a finish or rate. Estimates use past billing where available. Fill in the finish or add the rate in Masters.`,
        `बिना बिल लिंक की ${entriesText(u.noRateEntries)} (${num(u.noRateThan)} थान) में फ़िनिश या Rate नहीं है। अनुमान के लिए पुराने बिल लिए जाते हैं। फ़िनिश भरें या Masters में Rate जोड़ें।`) });
  }
  const t = d.thisMonth;
  if (t.upTo) {
    const c = change(t.than, t.lastMonthSameDaysThan);
    const tone = changeTone(c, { flat: 5 });
    list.push({ tone: tone === "bad" ? "warn" : tone, icon: "📦", title: L(`Cloth received in ${monthOnly(t.month)}: ${num(t.than)} THAN`, `${monthOnly(t.month)} में आया माल: ${num(t.than)} थान`),
      text: L(`Up to ${niceDate(t.upTo)}${t.estimatedValue > 0 ? `, worth about ${rs(t.estimatedValue)} of work` : ""}.${c === null ? "" : ` ${changeText(c, "the same days last month")} (${num(t.lastMonthSameDaysThan)} THAN).`}`,
        `${niceDate(t.upTo)} तक${t.estimatedValue > 0 ? `, लगभग ${rs(t.estimatedValue)} का काम` : ""}।${c === null ? "" : ` ${changeText(c, "पिछले महीने के इन्हीं दिनों")} (${num(t.lastMonthSameDaysThan)} थान)।`}`) });
  }
  if (d.repairs.than > 0) {
    const top = !d.party && d.repairs.topParties[0];
    list.push({ tone: "info", icon: "🔧", title: L(`Re-work (REP.) in ${fyText(d.fy)}: ${num(d.repairs.than)} THAN`, `${fyText(d.fy)} में रिपेयर: ${num(d.repairs.than)} थान`),
      text: L(`${num(d.repairs.entries)} entries marked as repairs.${top ? ` Most for ${top.party} (${num(top.than)} THAN).` : ""}`,
        `${num(d.repairs.entries)} Entries पर रिपेयर का निशान है।${top ? ` सबसे ज़्यादा ${top.party} के लिए (${num(top.than)} थान)।` : ""}`),
      action: scroll("dash-repairs") });
  }
  const rank = { bad: 0, warn: 1, good: 2, info: 3 };
  return list.map((item, i) => ({ ...item, i })).sort((a, b) => rank[a.tone] - rank[b.tone] || a.i - b.i);
}

function insightsCard(view) {
  const items = buildInsights(view);
  const body = items.length
    ? el("div", { class: "insights" }, items.map((item) => el("article", { class: `insight ${item.tone}` }, [
      el("span", { class: "insight-icon", "aria-hidden": "true", text: item.icon }),
      el("div", { class: "insight-body" }, [
        el("h3", { text: item.title }),
        el("p", { text: item.text }),
        item.action ? el("button", { type: "button", class: "secondary small insight-action", text: item.action.text, onclick: item.action.run }) : "",
      ]),
    ])))
    : el("p", { class: "muted", text: L("Nothing needs your attention right now. Figures appear here once entries and bills are added.", "अभी किसी बात पर ध्यान देने की ज़रूरत नहीं। Entries और बिल जुड़ने पर यहाँ आँकड़े दिखेंगे।") });
  return el("section", { class: "card dash-card", id: "dash-insights" }, [
    el("div", { class: "card-head" }, [el("h2", { text: L("What needs your attention", "किन बातों पर ध्यान दें") }),
      el("span", { class: "muted", text: L("Most important first", "सबसे ज़रूरी पहले") })]),
    body,
  ]);
}

// ---------- Big numbers ----------
function kpi({ label, value, title, lines = [], tone = "" }) {
  return el("div", { class: `kpi ${tone}`.trim() }, [
    el("div", { class: "kpi-label", text: label }),
    el("div", { class: "kpi-value", title: title || "", text: value }),
    ...lines.filter(Boolean).map((line) => (typeof line === "string" ? el("div", { class: "kpi-line", text: line }) : line)),
  ]);
}

function kpis({ d, selected, previous, isCurrent }) {
  const y = d.year;
  const u = d.unbilled;
  const t = d.thisMonth;
  const cards = [];
  if (selected) {
    const c = billChange(d, selected, previous);
    cards.push(kpi({ label: L(`Billed before GST · ${longMonth(selected.month)}`, `GST से पहले बिलिंग · ${longMonth(selected.month)}`), value: selected.bills ? rs(selected.taxable) : "—", title: selected.bills ? rsFull(selected.taxable) : "",
      tone: changeTone(c) === "info" ? "" : changeTone(c),
      lines: [c === null ? "" : el("div", { class: `kpi-line trend ${changeTone(c)}`, text: changeText(c, monthOnly(previous.month)) }),
        selected.bills ? L(`${num(selected.bills)} bills · ${num(selected.than)} priced THAN`, `${num(selected.bills)} बिल · ${num(selected.than)} बिल में थान`) : L("No saved bills for this month", "इस महीने के कोई सेव बिल नहीं"),
        selected.bills ? L(`Bill total with GST: ${rs(selected.total)}`, `GST सहित बिल कुल: ${rs(selected.total)}`) : ""] }));
  }
  cards.push(kpi({ label: L(`Billed before GST · FY ${fyText(d.fy)}`, `GST से पहले बिलिंग · FY ${fyText(d.fy)}`), value: y.bills ? rs(y.taxable) : "—", title: y.bills ? rsFull(y.taxable) : "",
    lines: [L(`${num(y.bills)} bills · ${num(y.parties)} parties`, `${num(y.bills)} बिल · ${num(y.parties)} पार्टियाँ`),
      isCurrent && y.projected > 0 ? L(`Annualized pace: ${rs(y.projected)} (not a forecast)`, `सालाना रफ़्तार: ${rs(y.projected)} (भविष्यवाणी नहीं)`) : ""] }));
  cards.push(kpi({ label: L("Billing queue · estimated", "बिलिंग सूची · अनुमान"), value: rs(u.readyValue), title: rsFull(u.readyValue), tone: u.readyEntries > 0 ? "warn" : "",
    lines: [L(`${entriesText(u.readyEntries)} · ${num(u.readyThan)} THAN`, `${entriesText(u.readyEntries)} · ${num(u.readyThan)} थान`),
      el("button", { type: "button", class: "secondary small", text: L("Review unlinked work", "बिना लिंक का काम जाँचें"), onclick: () => scrollToCard("dash-unbilled") })] }));
  const stock = d.stock.total;
  cards.push(kpi({ label: L("Dispatch balance · register", "बाक़ी जावक · रजिस्टर"), value: L(`${num(stock.pieces)} pieces`, `${num(stock.pieces)} नग`),
    lines: [L(`${entriesText(stock.entries)} · all billing statuses`, `${entriesText(stock.entries)} · सभी बिल स्थितियाँ`),
      L(`${num(stock.undispatchedThan)} THAN on slips with no dispatch`, `बिना जावक वाली पर्चियों में ${num(stock.undispatchedThan)} थान`),
      el("button", { type: "button", class: "secondary small", text: L("See stock breakdown", "स्टॉक का विवरण"), onclick: () => scrollToCard("dash-stock") })] }));
  if (selected) {
    const gst = selected.cgst + selected.sgst + selected.igst;
    cards.push(kpi({ label: L(`GST charged · ${monthOnly(selected.month)}`, `बिल पर GST · ${monthOnly(selected.month)}`), value: selected.bills ? rs(gst) : "—", title: selected.bills ? rsFull(gst) : "",
      lines: [L("On saved invoices, not net GST payable", "सेव बिलों पर लगा GST, शुद्ध देय GST नहीं"),
        y.bills ? L(`FY recorded: ${rs(y.gst)}`, `FY में दर्ज: ${rs(y.gst)}`) : ""] }));
  }
  cards.push(kpi({ label: L(`Discount given in ${fyText(d.fy)}`, `${fyText(d.fy)} में दिया गया Discount`), value: rs(y.discount), title: rsFull(y.discount),
    lines: [y.gross ? L(`${pct((y.discount / y.gross) * 100)} of job charges`, `Job Charge का ${pct((y.discount / y.gross) * 100)}`) : "",
      selected && selected.discount ? L(`${monthOnly(selected.month)}: ${rs(selected.discount)}`, `${monthOnly(selected.month)}: ${rs(selected.discount)}`) : ""] }));
  const monthPer = selected?.than ? selected.taxable / selected.than : null;
  cards.push(kpi({ label: L("Billed per priced THAN", "बिल में प्रति थान राशि"), value: monthPer === null ? "—" : perThan(monthPer),
    lines: [L("After discount, before GST; not profit", "Discount के बाद, GST से पहले; मुनाफ़ा नहीं"),
      y.than ? L(`FY weighted average: ${perThan(y.taxable / y.than)}`, `FY का भारित औसत: ${perThan(y.taxable / y.than)}`) : ""] }));
  const c = change(t.than, t.lastMonthSameDaysThan);
  cards.push(kpi({ label: L(`Cloth received · ${monthOnly(t.month)}`, `आया माल · ${monthOnly(t.month)}`), value: t.upTo ? L(`${num(t.than)} THAN`, `${num(t.than)} थान`) : "—",
    lines: [t.upTo ? L(`Recorded through ${niceDate(t.upTo)} · ${entriesText(t.entries)}`, `${niceDate(t.upTo)} तक दर्ज · ${entriesText(t.entries)}`) : L("No inward entries recorded this month", "इस महीने कोई आवक दर्ज नहीं"),
      t.repairThan ? L(`Includes ${num(t.repairThan)} repair THAN`, `${num(t.repairThan)} रिपेयर थान शामिल`) : "",
      t.upTo && c === null ? L("No comparable prior-month data", "पिछले महीने का तुलनीय डेटा नहीं") : "",
      c === null ? "" : el("div", { class: `kpi-line trend ${changeTone(c, { flat: 5 })}`, text: changeText(c, L("same recorded days last month", "पिछले महीने के इन्हीं दर्ज दिनों")) })] }));
  return el("section", { class: "kpis", "aria-label": L("Main figures", "मुख्य आँकड़े") }, cards);
}

// ---------- Charts ----------
/** Column chart drawn in SVG. Each series is { name, values, className }; clicking a month picks it. */
function columnChart({ categories, labels, series, format, axisFormat, selected, onPick, showValues = true, height = 330 }) {
  const width = 1000;
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
    const isSelected = category === selected;
    if (isSelected) chart.append(svg("rect", { x: x0 + 2, y: padTop - 22, width: groupW - 4, height: plotH + 22, class: "chart-pick", rx: 6 }));
    series.forEach((s, si) => {
      const value = s.values[ci] || 0;
      const h = (value / max) * plotH;
      const x = x0 + (groupW - barW * series.length) / 2 + si * barW;
      const bar = svg("rect", { x: x + 2, y: padTop + plotH - h, width: Math.max(1, barW - 4), height: Math.max(0, h), rx: 3, class: `bar ${s.className}${isSelected ? " on" : ""}` },
        [svg("title", {}, [document.createTextNode(`${labels[ci]} · ${s.name}: ${format(value)}`)])]);
      chart.append(bar);
      if (showValues && value > 0) {
        chart.append(svg("text", { x: x + barW / 2, y: padTop + plotH - h - 7, class: `bar-value${isSelected ? " on" : ""}`, "text-anchor": "middle" }, [document.createTextNode(s.short ? s.short(value) : format(value))]));
      }
    });
    chart.append(svg("text", { x: x0 + groupW / 2, y: height - 12, class: `cat${isSelected ? " on" : ""}`, "text-anchor": "middle" }, [document.createTextNode(labels[ci])]));
    if (onPick) {
      const hit = svg("rect", { x: x0, y: 0, width: groupW, height, class: "hit", tabindex: "0", role: "button", "aria-label": labels[ci] });
      hit.addEventListener("click", () => onPick(category));
      hit.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPick(category); } });
      chart.append(hit);
    }
  });
  return chart;
}

function legend(items) {
  return el("div", { class: "legend" }, items.map(([className, text]) => el("span", { class: "legend-item" }, [el("i", { class: `legend-swatch ${className}` }), text])));
}

function monthlyIncomeCard({ d }) {
  const months = d.monthly.map((m) => m.month);
  const hasLastYear = d.monthly.some((m) => m.lastYearTaxable > 0);
  const series = [{ name: L("Billed before GST", "GST से पहले बिलिंग"), values: d.monthly.map((m) => m.taxable), className: "s-income", short: rsChart }];
  if (hasLastYear) series.push({ name: L("Same month last year", "पिछले साल का यही Month"), values: d.monthly.map((m) => m.lastYearTaxable), className: "s-last", short: rsChart });
  return el("section", { class: "card dash-card", id: "dash-monthly" }, [
    el("div", { class: "card-head" }, [
      el("h2", { text: L(`Monthly billing, ${fyText(d.fy)}`, `महीने की बिलिंग, ${fyText(d.fy)}`) }),
      el("span", { class: "muted", text: L("Bill amounts after discount, before GST. Click a month to look at it closely.", "Discount के बाद, GST से पहले की बिल राशि। किसी Month को ध्यान से देखने के लिए उस पर क्लिक करें।") }),
    ]),
    columnChart({ categories: months, labels: months.map(shortMonth), series, format: rsFull, axisFormat: rsChart, selected: d.month, onPick: pickMonth, showValues: !hasLastYear || months.length <= 8 }),
    hasLastYear ? legend([["s-income", L("This year", "इस साल")], ["s-last", L("Same month last year", "पिछले साल का यही Month")]]) : "",
  ]);
}

function thanCard({ d }) {
  const months = d.monthly.map((m) => m.month);
  const received = d.monthly.reduce((s, m) => s + m.inwardThan, 0);
  const billed = d.monthly.reduce((s, m) => s + m.than, 0);
  return el("section", { class: "card dash-card", id: "dash-than" }, [
    el("div", { class: "card-head" }, [
      el("h2", { text: L("Cloth received and cloth billed (THAN)", "आया माल और बिल हुआ माल (थान)") }),
      el("span", { class: "muted", text: L("Received includes repairs and uses inward date. Billed uses priced quantities and bill date. The difference is not stock or unbilled work.", "आवक में रिपेयर शामिल हैं और आवक की तारीख़ ली जाती है। बिलिंग में बिल के थान और बिल की तारीख़ ली जाती है। इनका अंतर स्टॉक या बिना बिल का काम नहीं है।") }),
    ]),
    columnChart({ categories: months, labels: months.map(shortMonth), series: [
      { name: L("Received", "आया"), values: d.monthly.map((m) => m.inwardThan), className: "s-in", short: (v) => num(v) },
      { name: L("Billed", "बिल हुआ"), values: d.monthly.map((m) => m.than), className: "s-billed", short: (v) => num(v) },
    ], format: (v) => L(`${num(v)} THAN`, `${num(v)} थान`), axisFormat: (v) => num(Math.round(v)), selected: d.month, onPick: pickMonth, height: 300 }),
    legend([["s-in", L(`Received: ${num(received)} THAN this year`, `आया: इस साल ${num(received)} थान`)], ["s-billed", L(`Billed: ${num(billed)} THAN`, `बिल हुआ: ${num(billed)} थान`)]]),
  ]);
}

function barCell(text, share, max) {
  return el("td", { class: "left name-cell" }, [
    el("span", { class: "bar-name", text }),
    el("span", { class: "bar-track", "aria-hidden": "true" }, [el("i", { style: `width: ${max > 0 ? Math.max(1, (share / max) * 100) : 0}%` })]),
  ]);
}

function partiesCard({ d }) {
  const all = d.parties;
  const rows = dashState.allParties ? all : all.slice(0, DASH_PARTY_ROWS);
  const max = all[0]?.taxable || 0;
  const average = d.year.than ? d.year.taxable / d.year.than : 0;
  const table = el("table", { class: "dash-table" }, [
    el("thead", {}, [el("tr", {}, [L("#", "#"), L("Party", "पार्टी"), L("Billed before GST", "GST से पहले बिलिंग"), L("Share", "हिस्सा"), L("THAN", "थान"), L("Per THAN", "प्रति थान"), L("Discount", "Discount")].map((h, i) => el("th", { class: i === 1 ? "left" : "num", text: h })))]),
    el("tbody", {}, rows.map((p, i) => el("tr", {}, [
      el("td", { class: "num muted-cell", text: String(i + 1) }),
      barCell(p.party, p.taxable, max),
      el("td", { class: "num strong", title: rsFull(p.taxable), text: rs(p.taxable) }),
      el("td", { class: "num", text: pct(p.share) }),
      el("td", { class: "num", text: num(p.than) }),
      el("td", { class: `num${average && p.perThan < average * 0.92 ? " low" : ""}`, text: perThan(p.perThan) }),
      el("td", { class: "num", text: pct(p.discountPercent) }),
    ]))),
  ]);
  const toggle = all.length > DASH_PARTY_ROWS
    ? el("button", { type: "button", class: "secondary small", text: dashState.allParties ? L(`Show top ${DASH_PARTY_ROWS} only`, `केवल शीर्ष ${DASH_PARTY_ROWS} दिखाएँ`) : L(`Show all ${num(all.length)} parties`, `सभी ${num(all.length)} पार्टियाँ दिखाएँ`),
      onclick: () => { dashState.allParties = !dashState.allParties; renderDashboard(); } })
    : "";
  return el("section", { class: "card dash-card", id: "dash-parties" }, [
    el("div", { class: "card-head" }, [el("h2", { text: L(`Billing by party, ${fyText(d.fy)}`, `पार्टी-वार बिलिंग, ${fyText(d.fy)}`) }),
      el("span", { class: "muted", text: L(`Per THAN in red: below your average of ${perThan(average)}`, `लाल प्रति थान: आपके औसत ${perThan(average)} से कम`) })]),
    all.length ? el("div", { class: "table-scroll" }, [table]) : el("p", { class: "muted", text: L("No bills in this year yet.", "इस साल अभी कोई बिल नहीं।") }),
    toggle,
  ]);
}

function finishesCard({ d }) {
  const all = d.finishes;
  const list = dashState.allFinishes ? all : all.slice(0, DASH_FINISH_ROWS);
  const max = all[0]?.amount || 0;
  const table = el("table", { class: "dash-table" }, [
    el("thead", {}, [el("tr", {}, [L("Finish", "फ़िनिश"), L("Job charges", "Job Charge"), L("Share", "हिस्सा"), L("THAN", "थान"), L("Average rate", "औसत Rate")].map((h, i) => el("th", { class: i === 0 ? "left" : "num", text: h })))]),
    el("tbody", {}, list.map((f) => el("tr", {}, [
      barCell(f.finish, f.amount, max),
      el("td", { class: "num strong", title: rsFull(f.amount), text: rs(f.amount) }),
      el("td", { class: "num", text: pct(f.share) }),
      el("td", { class: "num", text: num(f.than) }),
      el("td", { class: "num", text: perThan(f.averageRate) }),
    ]))),
  ]);
  return el("section", { class: "card dash-card", id: "dash-finishes" }, [
    el("div", { class: "card-head" }, [el("h2", { text: L(`Job charges by finish, ${fyText(d.fy)}`, `फ़िनिश-वार Job Charge, ${fyText(d.fy)}`) }),
      el("span", { class: "muted", text: L("Before discount", "Discount से पहले") })]),
    all.length ? el("div", { class: "table-scroll" }, [table]) : el("p", { class: "muted", text: L("No bills in this year yet.", "इस साल अभी कोई बिल नहीं।") }),
    all.length > DASH_FINISH_ROWS
      ? el("button", { type: "button", class: "secondary small", text: dashState.allFinishes ? L(`Show top ${DASH_FINISH_ROWS} only`, `केवल शीर्ष ${DASH_FINISH_ROWS} दिखाएँ`) : L(`Show all ${num(all.length)} finishes`, `सभी ${num(all.length)} फ़िनिश दिखाएँ`),
        onclick: () => { dashState.allFinishes = !dashState.allFinishes; renderDashboard(); } })
      : "",
  ]);
}

function unbilledCard({ d }) {
  const u = d.unbilled;
  const total = u.ageing.reduce((s, b) => s + b.value, 0);
  const ageBar = el("div", { class: "age-bar", role: "img", "aria-label": L("Work without a bill, by days waiting", "बिना बिल का काम, इंतज़ार के दिनों के अनुसार") },
    u.ageing.filter((b) => b.value > 0).map((b) => el("span", { class: `age-seg age-${b.key.replace("+", "plus")}`, style: `flex-grow: ${b.value}`, title: `${AGE_TEXT[b.key][dashHindi() ? 1 : 0]}: ${rsFull(b.value)}` })));
  const ageLegend = el("div", { class: "age-legend" }, u.ageing.map((b) => el("div", { class: "age-item" }, [
    el("i", { class: `legend-swatch age-${b.key.replace("+", "plus")}` }),
    el("div", {}, [el("div", { class: "age-name", text: AGE_TEXT[b.key][dashHindi() ? 1 : 0] }), el("b", { text: rs(b.value) }),
      el("div", { class: "muted", text: L(`${entriesText(b.entries)} · ${num(b.than)} THAN`, `${entriesText(b.entries)} · ${num(b.than)} थान`) })]),
  ])));
  const all = d.unbilledParties.filter((p) => p.entries > 0);
  const rows = dashState.allUnbilled ? all : all.slice(0, DASH_UNBILLED_ROWS);
  const canBill = billsAvailable();
  const table = el("table", { class: "dash-table" }, [
    el("thead", {}, [el("tr", {}, [
      L("Party (bill to)", "पार्टी (बिल किसे)"), L("Estimated value", "अनुमानित राशि"), L("Entries", "Entries"), L("THAN", "थान"), L("Oldest inward", "सबसे पुरानी आवक"),
      L("Earlier inward", "पुरानी आवक"), L("Missing rate", "Rate नहीं"), L("Dispatch flags", "जावक की जाँच"), canBill ? "" : null,
    ].filter((h) => h !== null).map((h, i) => el("th", { class: i === 0 ? "left" : "num", text: h })))]),
    el("tbody", {}, rows.map((p) => el("tr", { class: p.daysWaiting > u.oldAfterDays ? "old" : "" }, [
      el("td", { class: "left strong", text: p.party }),
      el("td", { class: "num strong", title: rsFull(p.value), text: p.entries ? rs(p.value) : "—" }),
      el("td", { class: "num", text: p.entries ? num(p.entries) : "—" }),
      el("td", { class: "num", text: p.entries ? num(p.than) : "—" }),
      el("td", { class: "num", text: p.oldest ? niceDate(p.oldest) : "—" }),
      el("td", { class: "num", text: p.earlierInwardEntries ? num(p.earlierInwardEntries) : "—" }),
      el("td", { class: "num", text: p.readyNoRateEntries ? num(p.readyNoRateEntries) : "—" }),
      el("td", { class: "num", text: p.dispatchIssueEntries ? num(p.dispatchIssueEntries) : "—" }),
      ...(canBill ? [el("td", { class: "num" }, [el("button", { type: "button", class: "small", text: L("Review entries", "Entries जाँचें"), onclick: () => makeBillFor(p.party, p.oldest).catch(showFatal) })])] : []),
    ]))),
  ]);
  const toggle = all.length > DASH_UNBILLED_ROWS
    ? el("button", { type: "button", class: "secondary small", text: dashState.allUnbilled ? L(`Show top ${DASH_UNBILLED_ROWS} only`, `केवल शीर्ष ${DASH_UNBILLED_ROWS} दिखाएँ`) : L(`Show all ${num(all.length)} parties`, `सभी ${num(all.length)} पार्टियाँ दिखाएँ`),
      onclick: () => { dashState.allUnbilled = !dashState.allUnbilled; renderDashboard(); } })
    : "";
  return el("section", { class: "card dash-card", id: "dash-unbilled" }, [
    el("div", { class: "card-head" }, [el("h2", { text: L("Billing queue to reconcile", "बिलिंग सूची मिलाएँ") }),
      el("span", { class: "muted", text: L("No bill link is not proof that work was never billed. Check saved bills, Excel and dispatch details before invoicing.", "बिल लिंक न होना यह साबित नहीं करता कि बिल नहीं बना। बिल बनाने से पहले सेव बिल, Excel और जावक जाँचें।") })]),
    all.length ? el("div", { class: "unbilled-top" }, [
      el("div", { class: "unbilled-big" }, [el("span", { class: "kpi-label", text: L("Estimated before GST", "GST से पहले अनुमान") }), el("b", { class: "kpi-value", title: rsFull(u.readyValue), text: rs(u.readyValue) }),
        el("span", { class: "muted", text: L("Age from last valid dispatch, or from inward if none:", "आख़िरी सही जावक से समय, नहीं तो आवक से:") })]),
      el("div", { class: "unbilled-age" }, [total > 0 ? ageBar : "", ageLegend]),
    ]) : "",
    all.length ? reviewFlags(d) : "",
    all.length ? el("div", { class: "table-scroll" }, [table]) : el("p", { class: "muted", text: L("No eligible unlinked entries recorded.", "कोई योग्य बिना लिंक वाली Entry दर्ज नहीं।") }),
    toggle,
  ]);
}

function reviewFlags(d) {
  const r = d.review;
  const lastBill = niceDate(d.coverage.lastBill);
  const flags = [
    [L(`Inward on or before the last saved bill (${lastBill})`, `आख़िरी सेव बिल (${lastBill}) तक की आवक`), r.earlierInward],
    [L("Missing finish or rate (historical estimate, if available)", "फ़िनिश या Rate नहीं (पुराने बिलों से अनुमान, यदि उपलब्ध)"), r.missingRate],
    [L("Dispatch date or quantity needs checking", "जावक की तारीख़ या मात्रा जाँचें"), r.dispatchIssue],
    [L("Not dispatched, but early billing is enabled", "जावक नहीं हुई, पर पहले बिल की अनुमति है"), r.beforeDispatch],
  ].filter(([, estimate]) => estimate.entries);
  return flags.length ? el("div", { id: "dash-review-flags" }, [
    el("p", { class: "muted", text: L("Review flags can overlap. These amounts are already included in the queue.", "एक Entry पर कई संकेत हो सकते हैं। ये राशियाँ सूची में पहले से शामिल हैं।") }),
    el("ul", { class: "repair-list" }, flags.map(([label, e]) => el("li", { text: `${label}: ${entriesText(e.entries)} · ${num(e.than)} THAN · ${rsFull(e.value)}` }))),
  ]) : "";
}

function stockCard({ d }) {
  const stock = d.stock;
  const rows = [
    [L("Unbilled (standard)", "बिना बिल (सामान्य)"), stock.unbilled],
    [L("Unbilled (can bill before dispatch)", "बिना बिल (पहले बिल की अनुमति)"), stock.beforeDispatch],
    [L("Already billed or marked billed elsewhere", "बिल हो चुका या बाहर बिल दर्ज"), stock.billed],
    [L("No bill needed", "बिल की ज़रूरत नहीं"), stock.noBill],
    [L("Repairs", "रिपेयर"), stock.repairs],
  ];
  const row = (label, balance) => el("tr", {}, [
    el("td", { class: "left", text: label }),
    ...[balance.entries, balance.pieces, balance.undispatchedThan, balance.partialEntries].map((value) => el("td", { class: "num", text: num(value) })),
  ]);
  return el("section", { class: "card dash-card", id: "dash-stock" }, [
    el("div", { class: "card-head" }, [el("h2", { text: L("Recorded dispatch balance", "रजिस्टर में बाक़ी जावक") }),
      el("span", { class: "muted", text: L("Pieces remaining = THAN + TP + TWO PART − dispatched, per slip. This is not a physical stock count.", "बाक़ी नग = हर पर्ची में थान + TP + TWO PART − जावक। यह असली स्टॉक की गिनती नहीं है।") })]),
    el("div", { class: "table-scroll" }, [el("table", { class: "dash-table" }, [
      el("thead", {}, [el("tr", {}, [L("Status", "स्थिति"), L("Entries", "Entries"), L("Pieces left", "बाक़ी नग"), L("THAN on slips with no dispatch", "बिना जावक पर्चियों के थान"), L("Partly dispatched slips", "आंशिक जावक की पर्चियाँ")]
        .map((text, i) => el("th", { class: i === 0 ? "left" : "num", text })))]),
      el("tbody", {}, rows.map(([label, balance]) => row(label, balance))),
      el("tfoot", {}, [row(L("Total recorded balance", "कुल दर्ज बाक़ी"), stock.total)]),
    ])]),
  ]);
}

function gstCard({ d }) {
  const months = d.monthly.filter((m) => m.bills > 0 || m.month === d.month);
  const hasIgst = d.monthly.some((m) => m.igst > 0);
  const hasLocal = d.monthly.some((m) => m.cgst > 0 || m.sgst > 0) || !hasIgst;
  const heads = [L("Month", "Month"), L("Bills", "बिल"), L("Billed before GST", "GST से पहले बिलिंग"), ...(hasLocal ? ["CGST", "SGST"] : []), ...(hasIgst ? ["IGST"] : []), L("GST total", "कुल GST"), L("Bill total", "बिल कुल")];
  const row = (label, m, cls = "") => el("tr", { class: cls }, [
    el("td", { class: "left", text: label }),
    el("td", { class: "num", text: num(m.bills) }),
    el("td", { class: "num", text: rsFull(m.taxable) }),
    ...(hasLocal ? [el("td", { class: "num", text: rsFull(m.cgst) }), el("td", { class: "num", text: rsFull(m.sgst) })] : []),
    ...(hasIgst ? [el("td", { class: "num", text: rsFull(m.igst) })] : []),
    el("td", { class: "num strong", text: rsFull(m.cgst + m.sgst + m.igst) }),
    el("td", { class: "num", text: rsFull(m.total) }),
  ]);
  const sum = (key) => d.monthly.reduce((s, m) => s + m[key], 0);
  const totals = { bills: sum("bills"), taxable: sum("taxable"), cgst: sum("cgst"), sgst: sum("sgst"), igst: sum("igst"), total: sum("total") };
  return el("section", { class: "card dash-card", id: "dash-gst" }, [
    el("div", { class: "card-head" }, [el("h2", { text: L("GST on your bills", "आपके बिलों पर GST") }),
      el("span", { class: "muted", text: L("GST charged on saved invoices. Net GST payable is not calculated here.", "सेव बिलों पर लगा GST। शुद्ध देय GST यहाँ नहीं निकाला जाता।") })]),
    months.length ? el("div", { class: "table-scroll" }, [el("table", { class: "dash-table" }, [
      el("thead", {}, [el("tr", {}, heads.map((h, i) => el("th", { class: i === 0 ? "left" : "num", text: h })))]),
      el("tbody", {}, months.map((m) => row(longMonth(m.month), m, m.month === d.month ? "picked" : ""))),
      el("tfoot", {}, [row(L(`${fyText(d.fy)} total`, `${fyText(d.fy)} कुल`), totals, "total")]),
    ])]) : el("p", { class: "muted", text: L("No bills in this year yet.", "इस साल अभी कोई बिल नहीं।") }),
  ]);
}

function quietCard({ d }) {
  const quiet = d.quietParties;
  const end = niceDate(d.overall?.lastInward ?? d.coverage.lastInward);
  return el("section", { class: "card dash-card", id: "dash-quiet" }, [
    el("div", { class: "card-head" }, [el("h2", { text: d.party ? L("Recent inward pace", "हाल की आवक की रफ़्तार") : L("Parties sending less cloth", "कम माल भेज रही पार्टियाँ") }),
      el("span", { class: "muted", text: end ? L(`30 days ending ${end} versus the earlier recorded pace`, `${end} तक के 30 दिनों की पुरानी दर्ज रफ़्तार से तुलना`) : "" })]),
    quiet.length ? el("div", { class: "table-scroll" }, [el("table", { class: "dash-table" }, [
      el("thead", {}, [el("tr", {}, [L("Party", "पार्टी"), L("Usual (THAN)", "सामान्य (थान)"), L("Last 30 days", "पिछले 30 दिन"), L("Last cloth came", "आख़िरी माल आया")].map((h, i) => el("th", { class: i === 0 ? "left" : "num", text: h })))]),
      el("tbody", {}, quiet.map((p) => el("tr", {}, [
        el("td", { class: "left strong", text: p.party }),
        el("td", { class: "num", text: num(p.usualThan) }),
        el("td", { class: "num low", text: num(p.recentThan) }),
        el("td", { class: "num wrap-ok", text: L(`${niceDate(p.lastInward)} (${num(p.daysSinceLast)} days ago)`, `${niceDate(p.lastInward)} (${num(p.daysSinceLast)} दिन पहले)`) }),
      ]))),
    ])]) : el("p", { class: "muted", text: L("No slowdown flagged in the available inward data.", "दर्ज आवक में कोई कमी चिन्हित नहीं।") }),
  ]);
}

function repairsCard({ d }) {
  const repairs = d.repairs;
  return el("section", { class: "card dash-card", id: "dash-repairs" }, [
    el("div", { class: "card-head" }, [el("h2", { text: L(`Re-work (REP.) in ${fyText(d.fy)}`, `${fyText(d.fy)} में रिपेयर`) }),
      el("span", { class: "muted", text: L("Done again without a bill", "बिना बिल के दोबारा किया गया") })]),
    repairs.than ? el("div", {}, [
      el("p", { text: L(`${num(repairs.than)} THAN in ${entriesText(repairs.entries)} were re-done without a bill.`, `${num(repairs.entries)} Entries में ${num(repairs.than)} थान बिना बिल के दोबारा किए गए।`) }),
      d.party ? "" : el("ul", { class: "repair-list" }, repairs.topParties.map((p) => el("li", {}, [el("b", { text: p.party }), ` — ${L(`${num(p.than)} THAN, ${entriesText(p.entries)}`, `${num(p.than)} थान, ${entriesText(p.entries)}`)}`]))),
    ]) : el("p", { class: "good-note", text: L("✓ No repairs this year.", "✓ इस साल कोई रिपेयर नहीं।") }),
  ]);
}

function footnote() {
  return el("section", { class: "dash-foot" }, [
    el("h3", { text: L("How these figures are made", "ये आँकड़े कैसे बनते हैं") }),
    el("ul", {}, [
      L("Billed value is job charges after discount and before GST. Cancelled and future-dated bills are not counted in these totals.", "बिल राशि में Discount के बाद और GST से पहले का Job Charge है। रद्द और भविष्य की तारीख़ वाले बिल कुल में नहीं हैं।"),
      L("The queue uses configured rates less discount; without a rate it uses recent party or firm billing per THAN, if available. These are estimates, not invoice totals.", "बिलिंग सूची में तय Rate से Discount घटाते हैं। Rate न होने पर पार्टी या फ़र्म की हाल की प्रति थान बिलिंग, अगर उपलब्ध हो, लेते हैं। ये अनुमान हैं, बिल का कुल नहीं।"),
      L("This dashboard does not report cash received, outstanding collections, profit, or net tax payable.", "यह Dashboard मिली नक़दी, बाक़ी वसूली, मुनाफ़ा या शुद्ध देय कर नहीं दिखाता।"),
      L("The dashboard reads the data again every time you open it, every minute while it is open, and when you press Refresh.", "Dashboard हर बार खोलने पर, खुला रहने पर हर मिनट, और Refresh करें दबाने पर डेटा फिर से पढ़ता है।"),
    ].map((t) => el("li", { text: t }))),
  ]);
}
