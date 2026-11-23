"use strict";

// Importing an inward register workbook: preview, report and import.

// ---------- Import ----------
function guessMonth(fileName) {
  const name = fileName.toUpperCase();
  const names = MONTHS.map((m) => m.toUpperCase());
  const monthIndex = names.findIndex((m) => new RegExp(`(^|[^A-Z])${m}([^A-Z]|$)`).test(name));
  const year = name.match(/(\d{2})-(\d{2})/);
  if (monthIndex < 0 || !year) return "";
  const first = 2000 + Number(year[1]);
  const calendarYear = monthIndex >= 3 ? first : first + 1;
  return `${calendarYear}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function invalidateImportPreview() {
  $("runImport").disabled = true;
  $("importResult").replaceChildren();
}

const importPeriodInput = financialYearMonthInput($("importFinancialYear"), $("importMonth"), invalidateImportPreview, { automatic: true });
importPeriodInput.sync();

async function refreshImportYears() {
  importPeriodInput.fill(await api("/api/months"));
}

$("importFile").addEventListener("change", () => {
  const file = $("importFile").files[0];
  $("runImport").disabled = true;
  $("importResult").replaceChildren();
  if (file) $("importMonth").value = guessMonth(file.name) || $("importMonth").value;
  importPeriodInput.sync();
});
// Cancel drops the chosen workbook and its check result, so nothing can be imported until a file is chosen and checked again.
$("cancelImport").addEventListener("click", () => {
  $("importFile").value = "";
  invalidateImportPreview();
});

$("importMonth").addEventListener("input", () => { invalidateImportPreview(); importPeriodInput.sync(); });

async function sendImport(commit) {
  const file = $("importFile").files[0];
  if (!file) { renderImportError(["Choose a workbook first."]); return null; }
  const form = new FormData();
  form.append("file", file);
  form.append("month", $("importMonth").value);
  form.append("commit", commit ? "true" : "false");
  return api("/api/import", { method: "POST", body: form });
}

function renderImportError(errors) {
  toast(errors.length > 1 ? `Cannot import: ${errors[0]} (and ${num(errors.length - 1)} more)` : `Cannot import: ${errors[0]}`, "err");
  $("importResult").replaceChildren(el("div", { class: "report err" }, [el("b", { text: "Cannot import:" }), el("ul", {}, errors.map((e) => el("li", { text: e })))]));
}

function renderReport(report) {
  const ok = report.errors.length === 0;
  const update = report.savedEntries > 0;
  const rows = [
    ["File", report.fileName], ["Register month", formatMonth(report.registerMonth)],
    ...(update ? [["Entries already saved", report.savedEntries]] : []),
    ["New entries", report.entries],
    ...(update ? [["Entries changed", report.updatedEntries], ["Entries unchanged", report.unchangedEntries], ["Entries removed", report.removedEntries]] : []),
    ...(report.otherMonthUpdates ? [["Entries of other months changed", report.otherMonthUpdates]] : []),
    ["Carryover rows", report.carriedOver], ["Carryovers merged into earlier months", report.mergedCarryovers ?? 0],
    ["Dispatch lines", report.dispatches], ["THAN", report.than], ["TP", report.tp],
    ["NAG", report.nag], ["NETT THAN", report.nettThan], ["TWO PART", report.twoPart], ["JAWAK NAG", report.dispatched],
  ];
  const issue = (i) => el("li", { text: i.row ? `Excel row ${i.row}: ${i.message}` : i.message });
  const title = report.imported ? (update ? "Updated ✓" : "Imported ✓")
    : !ok ? "Problems found — nothing imported"
      : report.upToDate ? "Nothing to update — no new changes in this workbook"
        : update ? "Check passed — ready to update" : "Check passed — ready to import";
  // After an import, the Register can show just the entries it added or updated.
  const actions = report.imported && (report.added.length || report.changes.length) ? [el("div", { class: "report-actions" }, [
    ...(report.added.length ? [el("button", { type: "button", class: "secondary", id: "showImportAdded", text: "Show new entries in the Register",
      onclick: () => showImportInRegister("importAdded", report.registerMonth).catch(showFatal) })] : []),
    ...(report.changes.length ? [el("button", { type: "button", class: "secondary", id: "showImportUpdated", text: "Show updated entries in the Register",
      onclick: () => showImportInRegister("importUpdated", report.registerMonth).catch(showFatal) })] : []),
  ])] : [];
  const children = [
    el("h2", { text: title }),
    ...actions,
    el("table", {}, [el("tbody", {}, rows.map(([k, v]) => el("tr", {}, [el("th", { text: k }), el("td", { text: typeof v === "number" ? num(v) : String(v) })])))]),
  ];
  if (report.errors.length) children.push(el("h3", { text: `Errors (${report.errors.length})` }), el("ul", {}, report.errors.map(issue)));
  if (report.added.length) {
    children.push(el("h3", { id: "importAddedTitle", text: `New entries (${report.added.length})` }),
      el("ul", { id: "importAddedList" }, report.added.map(issue)));
  }
  if (report.changes.length) {
    children.push(el("h3", { id: "importUpdatedTitle", text: `Updated entries (${report.changes.length})` }),
      el("ul", { id: "importUpdatedList" }, report.changes.map(issue)));
  }
  if (report.kept.length) {
    children.push(el("h3", { text: `Kept as in the app (${report.kept.length})` }),
      el("p", { class: "muted", text: "These were changed in the app (or by a later month's carryover rows) since the last import. If the workbook is right, change them in the Register." }),
      el("ul", {}, report.kept.map(issue)));
  }
  if (report.notInWorkbook.length) children.push(el("h3", { text: `Not in the workbook (${report.notInWorkbook.length})` }), el("ul", {}, report.notInWorkbook.map(issue)));
  if (report.warnings.length) children.push(el("h3", { text: `Warnings — imported as-is, flagged in the Register (${report.warnings.length})` }), el("ul", {}, report.warnings.map(issue)));
  $("importResult").replaceChildren(el("div", { class: `report ${ok ? "ok" : "err"}` }, children));
  const month = formatMonth(report.registerMonth);
  if (report.imported) {
    toast(update
      ? `Updated ${month}: ${num(report.entries)} new, ${num(report.changes.length)} changed, ${num(report.removedEntries)} removed`
      : `Imported ${num(report.entries)} entries into ${month}`);
  } else if (!ok) toast(`Problems found in the workbook (${num(report.errors.length)}): nothing imported`, "err");
  else if (report.upToDate) toast(`${month} is up to date: no new changes in this workbook`, "warn");
  else toast(`Check passed: ready to ${update ? "update" : "import"} ${month}`);
  $("runImport").disabled = !ok || report.imported || report.upToDate;
  state.importRemoves = report.imported ? 0 : report.removedEntries;
  state.importMonth = report.registerMonth;
}

// Opens the Register on the imported month with only the entries the import added (or updated).
async function showImportInRegister(filterKey, month) {
  $("registerSearch").value = "";
  registerSearchPick = null;
  registerRowFilter.only([filterKey]);
  registerPeriodFilter.show(await api("/api/months"), month);
  returnTrips.length = 0;
  await switchView("register");
}

$("previewImport").addEventListener("click", async () => {
  try {
    const report = await sendImport(false);
    if (report) renderReport(report);
  } catch (error) {
    renderImportError(error.errors || [error.message]);
  }
});

$("runImport").addEventListener("click", async () => {
  const removes = state.importRemoves || 0;
  if (removes > 0 && !(await showConfirm({
    title: "Update the month",
    message: `Update ${formatMonth(state.importMonth)}?`,
    detail: `${num(removes)} saved ${removes === 1 ? "entry is" : "entries are"} not in this workbook and will be removed. A backup of the data file is taken first.`,
    confirmText: "Update and remove",
    cancelText: "Go back",
    tone: "danger",
  }))) return;
  $("runImport").disabled = true;
  try {
    const report = await sendImport(true);
    if (report) renderReport(report);
    state.entriesCache.clear();
    await Promise.all([loadMasters(), refreshInfo(), fillMonthSelect($("registerViewMonth"), true), fillMonthSelect($("partyViewMonth"), true)]);
  } catch (error) {
    renderImportError(error.errors || [error.message]);
  }
});
