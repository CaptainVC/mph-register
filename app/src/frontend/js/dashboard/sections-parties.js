"use strict";

// Dashboard → Parties and Compare.

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
