"use strict";

// Dashboard → Overview: key figures, monthly billing, top parties, finishes and insights.

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
  const u = unbilledFor(view.partySet, view.monthSet);
  const stock = stockFor(view.partySet, view.monthSet).total;
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
        L("Came in during the period, unbilled as of today", "इस अवधि में आया, आज तक बिल बाक़ी")],
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
        L("Dispatch balance of the period's cloth · as of today", "इस अवधि के माल की बाक़ी जावक · आज तक")],
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
    kpi({ id: "kpi-discount", label: L("Discount given", "दिया गया Discount"), value: b.bills ? rs(b.discount) : "—", title: b.bills ? rsFull(b.discount) : "",
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
  const u = unbilledFor(view.partySet, view.monthSet);
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
  const quiet = quietFor(view);
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
  if (view.includesCurrent && t.upTo) {
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
