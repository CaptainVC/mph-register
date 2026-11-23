"use strict";

// Importing an Excel bill workbook and linking its lines to inward entries.

// ---------- Import Excel bills ----------
async function sendBillImport(commit) {
  const file = $("billImportFile").files[0];
  if (!file) throw Object.assign(new Error("Choose the bill workbook first."), { errors: ["Choose the bill workbook first."] });
  const form = new FormData();
  form.append("file", file);
  form.append("commit", commit ? "true" : "false");
  return api("/api/billing/import", { method: "POST", body: form });
}

function renderBillImport(report) {
  billsState.importReport = report;
  const ok = report.errors.length === 0;
  const children = [
    el("h2", { text: billImportHeading(report, ok) }),
    el("div", { class: "chips" }, [
      el("span", {}, ["Bills: ", el("b", { text: num(report.invoices) })]),
      el("span", {}, ["Total of all bills: ", el("b", { text: rupees(report.total) })]),
      el("span", {}, ["Entries linked: ", el("b", { text: num(report.linkedEntries) })]),
      el("span", {}, ["Lines not linked: ", el("b", { text: num(report.unmatchedLines.length) })]),
      ...(report.alreadyInApp ? [el("span", {}, ["Already in the app (skipped): ", el("b", { text: num(report.alreadyInApp) })])] : []),
    ]),
  ];
  if (report.errors.length) children.push(el("h3", { text: "Errors" }), el("ul", {}, report.errors.map((e) => el("li", { text: e }))));
  if (report.addedParties?.length) children.push(el("p", { class: "muted", text: `New parties (added as inactive with the workbook's details): ${report.addedParties.join(", ")}` }));
  if (report.warnings.length) children.push(el("ul", { class: "warnings" }, report.warnings.map((e) => el("li", { text: e }))));
  const head = el("thead", {}, [el("tr", {}, ["BILL NO.", "PARTY", "LINES", "LINKED", "NOT LINKED", "SHEET TOTAL", "APP TOTAL", "CHECK"].map((h) => el("th", { text: h })))]);
  children.push(el("h3", { text: "Every bill, checked" }), el("div", { class: "table-wrap" }, [el("table", { class: "register" }, [head, el("tbody", {}, report.bills.map((b) =>
    el("tr", {}, [el("td", { class: "inward", text: b.invoiceNo }), el("td", { class: "left", text: b.party }), el("td", { class: "num", text: num(b.lines) }),
      el("td", { class: "num", text: num(b.matched) }), el("td", { class: b.unmatched ? "bad" : "num", text: num(b.unmatched) }),
      el("td", { class: "money", text: rupees(b.sheetTotal) }), el("td", { class: "money", text: rupees(b.appTotal) }),
      el("td", { class: b.sheetTotal === b.appTotal && !b.problems.length ? "good" : "bad left", text: b.sheetTotal === b.appTotal && !b.problems.length ? "✓ matches" : b.problems.join("; ") || "✓ matches" })])))])]));
  if (report.unmatchedLines.length) children.push(...unmatchedLinesTable(report.unmatchedLines));
  if (report.suggestions?.length) children.push(...suggestionsTable(report.suggestions));
  if (report.imported && report.leftovers.length) children.push(leftoverPanel(report.leftovers));
  $("billImportResult").replaceChildren(el("div", { class: `report ${ok ? "ok" : "err"}` }, children));
  $("billImportRun").disabled = !ok || report.imported || report.invoices === 0;
  if (report.imported) toast(`Imported ${num(report.invoices)} bills`);
  else if (ok && report.invoices === 0) toast("Nothing new to import", "warn");
  else if (!ok) toast(`Problems found in the bill workbook (${num(report.errors.length)}): nothing imported`, "err");
  else toast(`Check passed: ${num(report.invoices)} bills ready to import`);
}

function billImportHeading(report, ok) {
  if (report.imported) return `Imported ✓ ${num(report.invoices)} bills`;
  if (!ok) return "Problems found — nothing imported";
  if (report.invoices === 0 && report.alreadyInApp) return `Nothing new — all ${num(report.alreadyInApp)} bills are already in the app`;
  return `Check passed — ${num(report.invoices)} bills ready to import`;
}

function unmatchedLinesTable(lines) {
  return [el("h3", { text: "Bill lines that could not be linked to an inward entry" }),
    el("div", { class: "table-wrap" }, [el("table", { class: "register" }, [
      el("thead", {}, [el("tr", {}, ["BILL NO.", "ROW", "PARTY", "G.P.N.", "D.N.", "LOT NO.", "FINISH", "THAN"].map((h) => el("th", { text: h })))]),
      el("tbody", {}, lines.map((l) => el("tr", {}, [l.invoiceNo, l.row, l.party, l.gpn, l.dn, l.lot, l.finish, num(l.qty)].map((v) => el("td", { text: String(v) }))))),
    ])])];
}

// Lines that match another party's entries exactly: usually a sister firm billed under the other name.
function suggestionsTable(suggestions) {
  return [el("h3", { text: `Bill lines that match another party's inward entries (${num(suggestions.length)})` }),
    el("p", { class: "muted", text: "These are not linked. If the two parties are sister firms, give both the same sister-firm group in Masters → Parties, then re-check the links of imported bills." }),
    el("div", { class: "table-wrap" }, [el("table", { class: "register" }, [
      el("thead", {}, [el("tr", {}, ["BILL NO.", "ROW", "BILL PARTY", "INWARD PARTY", "REG. MONTH", "INW. NO.", "THAN"].map((h) => el("th", { text: h })))]),
      el("tbody", {}, suggestions.map((s) => el("tr", {}, [s.invoiceNo, s.row, s.billParty, s.entryParty, formatMonth(s.registerMonth), s.inwardNos.join(", "), num(s.qty)]
        .map((v) => el("td", { text: String(v) }))))),
    ])])];
}

// ---------- Re-check links of imported bills ----------
function renderRelink(report) {
  const changed = report.changedBills > 0;
  const children = [
    el("h2", { text: report.saved ? `Saved ✓ new links for ${num(report.changedBills)} bills` : changed ? `${num(report.changedBills)} of ${num(report.bills)} bills get new links` : "Links are up to date" }),
    el("div", { class: "chips" }, [
      el("span", {}, ["Bills checked: ", el("b", { text: num(report.bills) })]),
      el("span", {}, ["Entries linked: ", el("b", { text: `${num(report.linkedBefore)} → ${num(report.linkedAfter)}` })]),
      el("span", {}, ["Lines not linked: ", el("b", { text: `${num(report.unmatchedBefore)} → ${num(report.unmatchedAfter)}` })]),
    ]),
  ];
  if (!report.saved && changed) children.push(el("p", { class: "muted", text: "Nothing is saved yet. Press Save new links to use them; a backup is made first." }));
  if (report.warnings.length) {
    children.push(el("details", {}, [el("summary", { text: `Notes (${num(report.warnings.length)})` }), el("ul", { class: "warnings" }, report.warnings.map((w) => el("li", { text: w })))]));
  }
  if (report.unmatchedLines.length) children.push(...unmatchedLinesTable(report.unmatchedLines));
  if (report.suggestions.length) children.push(...suggestionsTable(report.suggestions));
  if (report.noLongerLinked.length) {
    children.push(el("h3", { text: `Entries that were linked before but no bill line points at now (${num(report.noLongerLinked.length)})` }),
      el("p", { class: "muted", text: "Their old link was a guess on THAN alone. With the new links they show as unbilled; mark them as billed if they were." }),
      el("div", { class: "table-wrap" }, [el("table", { class: "register" }, [
        el("thead", {}, [el("tr", {}, ["PARTY", "REG. MONTH", "INW. NO.", "D.N.", "LOT N.", "FINISH", "NETT THAN"].map((h) => el("th", { text: h })))]),
        el("tbody", {}, report.noLongerLinked.map((l) => el("tr", {}, [l.party, formatMonth(l.registerMonth), l.inwardNo, l.designNo, l.lotNo, l.finish, num(l.nettThan)]
          .map((v) => el("td", { text: String(v) }))))),
      ])]));
  }
  $("relinkResult").replaceChildren(el("div", { class: "report ok" }, children));
  $("relinkSave").disabled = report.saved || !changed;
  if (report.saved) toast(`Saved new links for ${num(report.changedBills)} bills`);
  else toast(changed ? `${num(report.changedBills)} of ${num(report.bills)} bills get new links` : "Links are up to date", changed ? "ok" : "warn");
}

async function runRelink(commit) {
  $("relinkSave").disabled = true;
  try {
    renderRelink(await api("/api/billing/relink", { method: "POST", json: { commit } }));
    if (commit) state.entriesCache.clear();
  } catch (error) {
    $("relinkResult").replaceChildren(el("div", { class: "report err" }, [el("ul", {}, (error.errors || [error.message]).map((e) => el("li", { text: e })))]));
    toast(`Could not ${commit ? "save" : "check"} the links: ${(error.errors || [error.message])[0]}`, "err");
  }
}

$("relinkCheck").addEventListener("click", () => runRelink(false));
$("relinkSave").addEventListener("click", () => runRelink(true));

function leftoverPanel(leftovers) {
  const note = el("input", { type: "text", id: "elsewhereNote", value: "Billed in Excel" });
  const all = el("input", { type: "checkbox" });
  const rows = leftovers.map((l) => {
    const box = el("input", { type: "checkbox", class: "leftover", "data-id": String(l.entryId) });
    return el("tr", { class: l.dispatchState === "none" ? "pending" : "" }, [el("td", {}, [box]),
      ...[l.party, formatMonth(l.registerMonth), l.inwardNo, l.designNo, l.lotNo, l.finish, num(l.nettThan), DISPATCH_TEXT[l.dispatchState]].map((v) => el("td", { text: String(v) }))]);
  });
  all.addEventListener("input", () => document.querySelectorAll(".leftover").forEach((b) => { b.checked = all.checked; }));
  const mark = el("button", { type: "button", id: "markElsewhere", text: "Mark ticked entries as already billed", onclick: async () => {
    const ids = [...document.querySelectorAll(".leftover")].filter((b) => b.checked).map((b) => Number(b.dataset.id));
    try {
      const result = await api("/api/billing/elsewhere", { method: "POST", json: { entryIds: ids, note: note.value } });
      toast(`Marked ${num(result.changed)} ${result.changed === 1 ? "entry" : "entries"} as already billed`);
      document.querySelectorAll(".leftover").forEach((b) => { if (b.checked) b.closest("tr").remove(); });
      state.entriesCache.clear();
    } catch (error) {
      toast(error.message, "err");
    }
  } });
  return el("div", {}, [
    el("h3", { text: `Inward entries of these parties that no bill line was linked to (${num(leftovers.length)})` }),
    el("p", { class: "muted", text: "Tick the ones that were billed in Excel (for example per-lot lines). Leave the ones still to be billed — undelivered entries usually stay unticked." }),
    el("div", { class: "table-wrap" }, [el("table", { class: "register" }, [
      el("thead", {}, [el("tr", {}, [el("th", {}, [all]), ...["PARTY", "REG. MONTH", "INW. NO.", "D.N.", "LOT N.", "FINISH", "NETT THAN", "DISPATCH"].map((h) => el("th", { text: h }))])]),
      el("tbody", {}, rows)])]),
    el("div", { class: "actions", style: "align-items: flex-end" }, [field("Note", note), mark]),
  ]);
}

function showBillImportError(error) {
  const errors = error.errors || [error.message];
  $("billImportResult").replaceChildren(el("div", { class: "report err" }, [el("ul", {}, errors.map((e) => el("li", { text: e })))]));
  toast(errors.length > 1 ? `Cannot import: ${errors[0]} (and ${num(errors.length - 1)} more)` : `Cannot import: ${errors[0]}`, "err");
}

$("billImportFile").addEventListener("change", () => { $("billImportRun").disabled = true; $("billImportResult").replaceChildren(); });
$("billImportCheck").addEventListener("click", async () => {
  try { renderBillImport(await sendBillImport(false)); } catch (error) {
    showBillImportError(error);
  }
});
$("billImportRun").addEventListener("click", async () => {
  $("billImportRun").disabled = true;
  try {
    renderBillImport(await sendBillImport(true));
    state.entriesCache.clear();
  } catch (error) {
    showBillImportError(error);
  }
});

subviewHandlers["bills-make"] = () => {
  clearBillCache();
  return refreshToBill();
};
subviewHandlers["bills-saved"] = () => refreshInvoices();
