"use strict";

// Aawak → Totals and Check (Aawak rows against the inward register).

// ---------- Totals ----------
const TOTALS_PERIODS = [
  ["firstHalf", "1–15 this month"], ["secondHalf", "16 to month end"], ["thisMonth", "This month"], ["lastMonth", "Last month"],
  ["thisFy", "This financial year"], ["custom", "Choose dates"],
];
setDropdownOptions($("totalsPeriod"), TOTALS_PERIODS, "thisMonth");
setDropdownOptions($("totalsOrder"), [["nag", "Most NAG first"], ["first", "First arrival first"]], "nag");

function isoDay(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function periodDates(kind) {
  const [year, month] = todayIso().split("-").map(Number);
  const last = new Date(year, month, 0).getDate();
  if (kind === "firstHalf") return [isoDay(year, month, 1), isoDay(year, month, 15)];
  if (kind === "secondHalf") return [isoDay(year, month, 16), isoDay(year, month, last)];
  if (kind === "lastMonth") {
    const [y, m] = month === 1 ? [year - 1, 12] : [year, month - 1];
    return [isoDay(y, m, 1), isoDay(y, m, new Date(y, m, 0).getDate())];
  }
  if (kind === "thisFy") {
    const start = Number(financialYearOf(todayIso().slice(0, 7)));
    return [isoDay(start, 4, 1), isoDay(start + 1, 3, 31)];
  }
  return [isoDay(year, month, 1), isoDay(year, month, last)];
}

$("totalsPeriod").addEventListener("change", () => {
  if ($("totalsPeriod").value !== "custom") [$("totalsFrom").value, $("totalsTo").value] = periodDates($("totalsPeriod").value);
  renderTotalsView().catch(showFatal);
});
for (const id of ["totalsFrom", "totalsTo"]) $(id).addEventListener("change", () => { $("totalsPeriod").value = "custom"; renderTotalsView().catch(showFatal); });
$("totalsOrder").addEventListener("change", () => renderTotalsView().catch(showFatal));
$("totalsGroup").addEventListener("change", () => renderTotalsView().catch(showFatal));

function totalsQuery() {
  if (!$("totalsFrom").value && !$("totalsTo").value && $("totalsPeriod").value !== "custom") {
    [$("totalsFrom").value, $("totalsTo").value] = periodDates($("totalsPeriod").value);
  }
  return new URLSearchParams({ from: $("totalsFrom").value, to: $("totalsTo").value, group: String($("totalsGroup").checked), order: $("totalsOrder").value });
}

function nagShare(nag, total) {
  return total ? `${(nag / total * 100).toLocaleString("en-IN", { maximumFractionDigits: 1 })}%` : "0%";
}

function totalsTable(caption, lines, total) {
  return el("table", { class: "totals-table" }, [
    el("caption", { class: "sr-only", text: caption }),
    el("thead", {}, [el("tr", {}, ["Name", "Rows", "Share", "NAG"].map((text) => el("th", { scope: "col", text })))]),
    el("tbody", {}, lines.map((l) => el("tr", {}, [
      el("td", { class: "report-name", "data-no-i18n": "all" }, [el("span", { text: l.name }), l.isGroup ? el("small", { text: l.members.join(", ") }) : ""]),
      el("td", { text: num(l.arrivals) }),
      el("td", { class: "report-share" }, [
        el("span", { text: nagShare(l.nag, total) }),
        el("span", { class: "report-meter", "aria-hidden": "true" }, [el("span", { style: `width:${total ? l.nag / total * 100 : 0}%` })]),
      ]),
      el("td", { class: "report-nag", text: num(l.nag) }),
    ]))),
    el("tfoot", {}, [el("tr", {}, [
      el("th", { scope: "row", text: "Period total" }), el("th", { text: num(lines.reduce((s, l) => s + l.arrivals, 0)) }),
      el("th", { text: nagShare(total, total) }), el("th", { text: num(total) }),
    ])]),
  ]);
}

function totalsCard(title, note, lines, nag) {
  const search = el("input", { type: "search", placeholder: "Find a name...", "aria-label": `Search ${title.replace(/^By /, "")} totals` });
  const count = el("span", { class: "count-pill", text: num(lines.length) });
  const table = totalsTable(title, lines, nag);
  const empty = el("p", { class: "report-no-match muted", role: "status", hidden: "", text: "No matching names. Try a different search." });
  search.addEventListener("input", () => {
    const term = search.value.trim().toLocaleLowerCase();
    let visible = 0;
    [...table.tBodies[0].rows].forEach((row, i) => {
      row.hidden = ![lines[i].name, ...lines[i].members].some((name) => name.toLocaleLowerCase().includes(term));
      if (!row.hidden) visible++;
    });
    count.textContent = term ? `${num(visible)} / ${num(lines.length)}` : num(lines.length);
    empty.hidden = visible > 0;
  });
  return el("section", { class: "report-card", "aria-label": title }, [
    el("div", { class: "report-card-heading" }, [el("h2", { text: title }), count]),
    el("p", { class: "muted report-card-note", text: note }), search, table, empty,
  ]);
}

function renderTotalsReport(totals) {
  const stats = [
    ["Total NAG", totals.nag, "Across all arrivals"],
    ["Aawak rows", totals.arrivals, "Entries in this period"],
    [totals.groupSisters ? "Parties / groups" : "Parties", totals.parties.length, totals.groupSisters ? "Sister firms combined" : "Each party separately"],
    ["Lorry walas", totals.transporters.length, `${num(totals.days.length)} arrival days`],
  ];
  const daily = totalsTable("NAG by day", totals.days.map((d) => ({ name: formatDate(d.date), members: [], arrivals: d.arrivals, nag: d.nag })), totals.nag);
  daily.tHead.rows[0].cells[0].textContent = "Date";
  const transporters = totals.transporters;
  const parties = totals.parties;
  const cells = new Map(totals.matrix.map((c) => [JSON.stringify([c.transporter, c.party]), c.nag]));
  const matrix = el("table", { class: "totals-table report-matrix" }, [
    el("caption", { class: "sr-only", text: "NAG by lorry wala and party" }),
    el("thead", {}, [el("tr", {}, [
      el("th", { scope: "col", text: "Lorry wala" }),
      ...parties.map((p) => el("th", { scope: "col", text: p.name, "data-no-i18n": "all" })),
      el("th", { scope: "col", text: "Total NAG" }),
    ])]),
    el("tbody", {}, transporters.map((t) => el("tr", {}, [
      el("th", { scope: "row", text: t.name, "data-no-i18n": "all" }),
      ...parties.map((p) => el("td", { text: cells.has(JSON.stringify([t.name, p.name])) ? num(cells.get(JSON.stringify([t.name, p.name]))) : "\u2014" })),
      el("td", { class: "report-nag", text: num(t.nag) }),
    ]))),
    el("tfoot", {}, [el("tr", {}, [el("th", { scope: "row", text: "Total NAG" }), ...parties.map((p) => el("th", { text: num(p.nag) })), el("th", { text: num(totals.nag) })])]),
  ]);
  $("totalsResult").replaceChildren(
    el("div", { class: "report-stats", "aria-label": "Period summary" }, stats.map(([label, value, hint], i) => el("div", { class: `report-stat${i === 0 ? " report-stat-primary" : ""}` }, [
      el("span", { text: label }), el("b", { text: num(value) }), el("small", { text: hint }),
    ]))),
    el("div", { class: "report-breakdowns" }, [
      totalsCard(totals.groupSisters ? "By party / group" : "By party", totals.groupSisters ? "Share of period NAG. Search also finds a sister firm's name." : "Share of period NAG. Each party is shown separately.", totals.parties, totals.nag),
      el("div", { class: "report-side" }, [
        totalsCard("By lorry wala", "Who brought the goods, and how much.", totals.transporters, totals.nag),
        el("section", { class: "report-card", "aria-label": "Daily breakdown" }, [
          el("div", { class: "report-card-heading" }, [el("h2", { text: "Daily breakdown" }), el("span", { class: "count-pill", text: `${num(totals.days.length)} days` })]),
          el("p", { class: "muted report-card-note", text: "Arrival dates in calendar order." }),
          el("div", { class: "report-daily", tabindex: "0", role: "region", "aria-label": "Daily NAG totals" }, [daily]),
        ]),
      ]),
    ]),
    el("details", { class: "report-card report-cross" }, [
      el("summary", {}, [el("span", { text: "Lorry wala \u00d7 party" }), el("span", { class: "muted", text: "View NAG cross-check" })]),
      el("p", { class: "muted", text: "Each cell is NAG for one lorry wala and party. A dash means no arrivals. Row and column totals reconcile to the period total." }),
      el("div", { class: "report-matrix-wrap", tabindex: "0", role: "region", "aria-label": "NAG by lorry wala and party; scroll for more columns" }, [matrix]),
    ]),
    el("p", { class: "muted report-footnote", text: "Rows = Aawak entries, not inward slips. Searches only hide summary lines; period totals and the printed report always include all names." }),
  );
}

async function renderTotalsView() {
  const seq = ++aawakState.totalsSeq;
  const query = totalsQuery();
  const box = $("totalsResult");
  aawakState.totals = null;
  $("totalsPrint").disabled = true;
  $("statementsPrint").disabled = true;
  box.setAttribute("aria-busy", "false");
  const from = query.get("from"), to = query.get("to");
  if (!from || !to || from > to) {
    $("totalsStatus").textContent = !from || !to ? "Choose both dates to see your totals." : "The From date must be on or before the To date.";
    box.replaceChildren(el("div", { class: "report-empty", role: "alert", text: "Check the report dates above." }));
    return;
  }
  $("totalsStatus").textContent = "Updating totals...";
  box.setAttribute("aria-busy", "true");
  box.replaceChildren(el("div", { class: "report-empty muted", text: "Loading your report..." }));
  let totals;
  try {
    totals = await api(`/api/arrivals/totals?${query}`);
  } catch (error) {
    if (seq !== aawakState.totalsSeq) return;
    box.setAttribute("aria-busy", "false");
    $("totalsStatus").textContent = `Could not load totals: ${errorText(error)}`;
    box.replaceChildren(el("div", { class: "report-empty", role: "alert" }, [
      el("p", { text: "The report could not be loaded. Your data has not been changed." }),
      el("button", { type: "button", class: "secondary", text: "Try again", onclick: () => renderTotalsView().catch(showFatal) }),
    ]));
    return;
  }
  if (seq !== aawakState.totalsSeq) return;
  aawakState.totals = totals;
  box.setAttribute("aria-busy", "false");
  $("totalsStatus").replaceChildren(`${formatDate(totals.from)} to ${formatDate(totals.to)} \u00b7 `,
    el("span", { text: totals.groupSisters ? "Sister firms grouped" : "Individual parties" }), " \u00b7 ",
    el("span", { text: totals.order === "first" ? "First arrival first" : "Most NAG first" }));
  if (!totals.arrivals) {
    box.replaceChildren(el("div", { class: "report-empty" }, [
      el("h2", { text: "No arrivals in this period" }),
      el("p", { class: "muted", text: "Try another period or widen the dates. Totals appear here once Aawak entries are available." }),
    ]));
    return;
  }
  renderTotalsReport(totals);
  $("totalsPrint").disabled = false;
  $("statementsPrint").disabled = false;
}

function printArrivalReport(kind) {
  const { from, to, groupSisters, order } = aawakState.totals;
  window.open(`print-aawak.html?${new URLSearchParams({ kind, from, to, group: String(groupSisters), order })}`, "_blank", "noopener");
}
$("totalsPrint").addEventListener("click", () => printArrivalReport("totals"));
$("statementsPrint").addEventListener("click", () => printArrivalReport("statements"));

// ---------- Check ----------
function checkRange() {
  if (!$("checkFrom").value) $("checkFrom").value = `${todayIso().slice(0, 7)}-01`;
  if (!$("checkTo").value) $("checkTo").value = todayIso();
  return new URLSearchParams({ from: $("checkFrom").value, to: $("checkTo").value });
}

function checkCard(title, note, head, rows, empty) {
  return el("div", { class: "card check-card" }, [
    el("h2", {}, [title, el("span", { class: "count-pill", text: num(rows.length) })]),
    note ? el("p", { class: "muted", text: note }) : "",
    rows.length
      ? el("div", { class: "table-wrap" }, [el("table", { class: "register" }, [el("thead", {}, [el("tr", {}, head.map((h) => el("th", { text: h })))]), el("tbody", {}, rows)])])
      : el("p", { class: "muted", text: empty }),
  ]);
}

function arrivalLinkCell(a) {
  return el("td", {}, [el("a", { href: "#", class: "aawak-link", text: a.number, title: `Open ${arrivalTitle(a)}`, onclick: (event) => { event.preventDefault(); openArrival(a.id); } })]);
}

async function runCheck() {
  const check = await api(`/api/arrivals/check?${checkRange()}`);
  aawakState.check = check;
  const notLinked = check.notLinked.map((a) => el("tr", {}, [arrivalLinkCell(a), el("td", { text: formatDate(a.arrivalDate) }), el("td", { class: "left", text: a.party }),
    el("td", { text: num(a.nag) }), el("td", { class: "left", text: a.inwardText || "—" }), el("td", { class: "left slips-cell" }, [fillSlipsCellNode(a)])]));
  const nagDiffers = check.nagDiffers.map((a) => el("tr", {}, [arrivalLinkCell(a), el("td", { text: formatDate(a.arrivalDate) }), el("td", { class: "left", text: a.party }),
    el("td", { text: num(a.nag) }), el("td", { text: num(a.slipsNag) }), el("td", { class: "left slips-cell" }, [fillSlipsCellNode(a)])]));
  const without = check.slipsWithout.map((s) => el("tr", {}, [
    el("td", {}, [slipLink({ ...s, deleted: false, share: null, entryNag: s.nag, sisterFirm: false, manual: false })]), el("td", { text: formatMonth(s.registerMonth) }),
    el("td", { text: formatDate(s.entryDate) }), el("td", { class: "left", text: s.party }), el("td", { text: num(s.nag) }),
    el("td", {}, [el("button", { type: "button", class: "ghost small", text: Aawak_NOT_NEEDED_TEXT, title: "This slip never comes through the gate (moved inside the factory, re-slipped)",
      onclick: () => markNoAawak(s) })]),
  ]));
  const over = check.overlinked.map((s) => el("tr", {}, [
    el("td", {}, [slipLink({ ...s, deleted: false, share: null, entryNag: s.nag, sisterFirm: false, manual: false })]), el("td", { text: formatDate(s.entryDate) }),
    el("td", { class: "left", text: s.party }), el("td", { text: num(s.nag) }), el("td", { text: num(s.arrivedNag) }),
    el("td", {}, s.arrivalIds.flatMap((id, i) => [i ? ", " : "", el("a", { href: "#", class: "aawak-link", text: s.numbers[i], onclick: (event) => { event.preventDefault(); openArrival(id); } })])),
  ]));
  $("checkResult").replaceChildren(
    checkCard(NO_INWARD_TEXT, "Aawak rows with INW NO that are not in the inward register (yet), or with no INW NO.", ["Aawak NO", "DATE", "PARTY", "NAG", "INW NO", "SLIPS"], notLinked, "Every Aawak row found its slips."),
    checkCard("NAG differs", "The slips were found but their NAG adds up to something else: a part load, or a typo in NAG or INW NO.", ["Aawak NO", "DATE", "PARTY", "NAG", "SLIPS NAG", "SLIPS"], nagDiffers, "Every linked Aawak row has the slips' NAG."),
    checkCard(NO_Aawak_TEXT, check.checkSlipsFrom ? `Inward slips from ${formatDate(check.checkSlipsFrom)} on that are on no Aawak row.` : "There are no Aawak rows yet, so slips are not checked.",
      ["INW. NO.", "Register", "DATE", "PARTY", "NAG", ""], without, "Every inward slip has its Aawak row."),
    checkCard("Slip on more Aawak rows than its NAG", "", ["INW. NO.", "DATE", "PARTY", "NAG", "ARRIVED NAG", "Aawak"], over, "No slip came more often than its NAG."),
  );
}

function fillSlipsCellNode(a) {
  const span = el("span");
  fillSlipsCell(span, a);
  return span;
}

async function markNoAawak(slip) {
  try {
    await api(`/api/arrivals/no-arrival/${slip.entryId}`, { method: "PUT", json: { note: "Marked in Aawak → Check" } });
    toast(`INW. NO. ${slip.inwardNo} needs no Aawak ✓`, "ok", { id: "undoNoAawak", label: "Undo", run: async () => {
      await api(`/api/arrivals/no-arrival/${slip.entryId}`, { method: "DELETE" });
      await runCheck();
    } });
    await runCheck();
  } catch (error) {
    toast(errorText(error), "err");
  }
}

$("checkRun").addEventListener("click", () => runCheck().catch(showFatal));
for (const id of ["checkFrom", "checkTo"]) $(id).addEventListener("change", () => runCheck().catch(showFatal));
$("checkRelink").addEventListener("click", async () => {
  try {
    const result = await api("/api/arrivals/relink", { method: "POST" });
    toast(`Linked again ✓ ${num(result.arrivals)} rows: ${num(result.linked)} linked, ${num(result.nagDiffers)} NAG differs`);
    await runCheck();
  } catch (error) {
    toast(errorText(error), "err");
  }
});

// ---------- The Aawak screen ----------
subviewHandlers["aawak-new"] = prepareArrivalForm;
subviewHandlers["aawak-register"] = refreshAawakRegister;
subviewHandlers["aawak-totals"] = renderTotalsView;
subviewHandlers["aawak-check"] = runCheck;

async function showAawak() {
  fillNameLists();
  const active = document.querySelector('[id^="aawak-"].subview.active')?.id || "aawak-new";
  // Opening a row from another tab (or the import report) fills the register itself.
  if (active === "aawak-register" && ["arrival", "import"].includes(returnTrips.at(-1)?.kind)) return;
  await subviewHandlers[active]?.();
}
