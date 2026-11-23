"use strict";

// Dashboard → To be billed, Cloth & stock and GST.

// ---------- To be billed (cloth that came in during the period, as of today) ----------
function unbilledSection(view) {
  const m = dashState.model;
  const u = unbilledFor(view.partySet, view.monthSet);
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
      L("Cloth that came in during the period, as of today. No bill link is not proof that work was never billed. Check saved bills, Excel and dispatch details before invoicing.",
        "इस अवधि में आया माल, आज तक। बिल लिंक न होना यह साबित नहीं करता कि बिल नहीं बना। बिल बनाने से पहले सेव बिल, Excel और जावक जाँचें।"), [
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
  const stock = stockFor(view.partySet, view.monthSet).total;
  const ok = view.inwardChangeOk;
  const mw = view.measuredInward;
  const sameDays = change(t.than, t.sameDaysThan);
  const kpis = [
    kpi({ id: "kpi-cloth-in", label: L("Cloth received", "आया माल"), value: thanText(w.than), lines: [trendLine(ok ? change(mw.than, view.priorInward.than) : null, view.compareText, { flat: 5 }), ok ? partialNote(view) : "",
      L(`${entriesText(w.entries)} · ${num(w.pieces)} pieces`, `${entriesText(w.entries)} · ${num(w.pieces)} नग`), w.value ? L(`Work worth about ${rs(w.value)} at today's rates`, `आज के Rate पर लगभग ${rs(w.value)} का काम`) : ""] }),
    kpi({ id: "kpi-cloth-sent", label: L("Sent back", "वापस भेजा"), value: L(`${num(w.sent)} pieces`, `${num(w.sent)} नग`), lines: [trendLine(ok ? change(mw.sent, view.priorInward.sent) : null, view.compareText, { flat: 5 }),
      L("Dispatches dated in the period", "इस अवधि की तारीख़ वाली जावक")] }),
    ...(view.includesCurrent ? [kpi({ id: "kpi-cloth-month", label: L(`This month so far · ${monthOnly(t.month)}`, `यह Month अब तक · ${monthOnly(t.month)}`), value: t.upTo ? thanText(t.than) : "—",
      tone: changeTone(sameDays, { flat: 5 }) === "bad" ? "warn" : "",
      lines: [t.upTo ? L(`Recorded through ${niceDate(t.upTo)} · ${entriesText(t.entries)}`, `${niceDate(t.upTo)} तक दर्ज · ${entriesText(t.entries)}`) : L("No inward entries recorded this month", "इस महीने कोई आवक दर्ज नहीं"),
        trendLine(sameDays, L("same recorded days last month", "पिछले महीने के इन्हीं दर्ज दिनों"), { flat: 5 }),
        t.upTo && sameDays === null ? L("No comparable prior-month data", "पिछले महीने का तुलनीय डेटा नहीं") : ""] })] : []),
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
  const stock = stockFor(view.partySet, view.monthSet);
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
  return card("dash-stock", L("Recorded dispatch balance", "रजिस्टर में बाक़ी जावक"), L("Cloth that came in during the period, as of today. Pieces left = THAN + TP + TWO PART − dispatched, per slip. This is not a physical stock count.", "इस अवधि में आया माल, आज तक। बाक़ी नग = हर पर्ची में थान + TP + TWO PART − जावक। यह असली स्टॉक की गिनती नहीं है।"), [
    dashTable([th(L("Status", "स्थिति"), "left"), th(L("Entries", "Entries")), th(L("Pieces left", "बाक़ी नग")), th(L("THAN on slips with no dispatch", "बिना जावक पर्चियों के थान")), th(L("Partly dispatched slips", "आंशिक जावक की पर्चियाँ"))],
      rows.map(([label, balance]) => row(label, balance)), { foot: [row(L("Total recorded balance", "कुल दर्ज बाक़ी"), stock.total)] }),
  ]);
}

function quietCard(view) {
  const quiet = quietFor(view);
  const end = niceDate(dashState.model.f.coverage.lastInward);
  return card("dash-quiet", view.parties.length === 1 ? L("Recent inward pace", "हाल की आवक की रफ़्तार") : L("Parties sending less cloth", "कम माल भेज रही पार्टियाँ"),
    end ? L(`30 days ending ${end} versus the earlier recorded pace`, `${end} तक के 30 दिनों की पुरानी दर्ज रफ़्तार से तुलना`) : "", [
      quiet.length ? dashTable([th(L("Party", "पार्टी"), "left"), th(L("Usual (THAN)", "सामान्य (थान)")), th(L("Last 30 days", "पिछले 30 दिन")), th(L("Last cloth came", "आख़िरी माल आया"))],
        quiet.map((q) => el("tr", {}, [
          el("td", { class: "left name-cell" }, [partyButton(q.party, "link-btn strong")]),
          td(num(q.usualThan)),
          td(num(q.recentThan), "num low"),
          td(L(`${niceDate(q.lastInward)} (${num(q.daysSinceLast)} days ago)`, `${niceDate(q.lastInward)} (${num(q.daysSinceLast)} दिन पहले)`), "num wrap-ok"),
        ]))) : emptyNote(view.includesCurrent ? L("No slowdown flagged in the available inward data.", "दर्ज आवक में कोई कमी चिन्हित नहीं।")
          : L("Slowdowns are checked for periods that include the current month.", "कमी की जाँच उन अवधियों की होती है जिनमें मौजूदा Month शामिल है।")),
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

// Each dashboard tab and what draws it (the sections above and in sections-overview.js / sections-parties.js).
const SECTION_VIEWS = {
  overview: overviewSection,
  parties: partiesSection,
  compare: compareSection,
  unbilled: unbilledSection,
  cloth: clothSection,
  gst: gstSection,
};
