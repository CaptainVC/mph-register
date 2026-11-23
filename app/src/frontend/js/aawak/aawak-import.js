"use strict";

// Importing an Aawak workbook.

// ---------- Import → Aawak workbook ----------
async function sendAawakImport(commit) {
  const file = $("aawakImportFile").files[0];
  if (!file) { toast("Choose an Aawak workbook first.", "err"); return null; }
  const form = new FormData();
  form.append("file", file);
  form.append("month", $("aawakImportMonth").value);
  form.append("commit", commit ? "true" : "false");
  form.append("groups", $("aawakImportGroups").checked ? "true" : "false");
  return api("/api/import/aawak", { method: "POST", body: form });
}

function issueList(title, issues, kind = "") {
  if (!issues.length) return "";
  return el("details", { class: `report-list ${kind}`, ...(kind === "err" ? { open: "" } : {}) }, [el("summary", { text: `${title} (${num(issues.length)})` }),
    el("ul", {}, issues.map((i) => el("li", { text: i.row ? `Row ${i.row}: ${i.message}` : i.message })))]);
}

function renderAawakReport(report) {
  aawakState.importReport = report;
  const facts = [
    ["File", report.fileName], ["Aawak month", report.aawakMonth ? formatMonth(report.aawakMonth) : "—"], ["Rows", num(report.rows)], ["NAG", num(report.nag)],
    ["New rows", num(report.added)], ["Updated", num(report.updated)], ["Unchanged", num(report.unchanged)], ["Removed", num(report.removed)],
    ["Kept deleted", num(report.keptDeleted)], ["Typed in the app, kept", num(report.keptTyped)],
  ];
  if (report.links) facts.push(["Linked to slips", num(report.links.linked)], ["NAG differs", num(report.links.nagDiffers)],
    ["Slips not found", num(report.links.partlyLinked + report.links.notLinked)]);
  const heading = report.errors.length ? "Cannot import this file" : report.imported ? "Imported ✓" : report.upToDate ? "Already up to date: nothing new in this file" : "Checked: nothing is saved yet";
  const groups = report.groups.length ? el("details", { class: "report-list" }, [el("summary", { text: `Party groups in the workbook (${num(report.groups.length)})` }),
    el("ul", {}, report.groups.map((g) => el("li", { text: g.currentGroup ? `${g.party}: ${g.group} in the workbook, ${g.currentGroup} in the app (kept)`
      : `${g.party} → ${g.group}${g.applied ? " ✓ given" : " (tick the box above to give it)"}` })))]) : "";
  $("aawakImportResult").replaceChildren(el("div", { class: `report ${report.errors.length ? "err" : "ok"}` }, [
    el("h2", { text: heading }),
    el("dl", { class: "report-facts" }, facts.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })])),
    report.addedParties.length ? el("p", { text: `Parties added as inactive: ${report.addedParties.join(", ")}` }) : "",
    report.addedTransporters.length ? el("p", { text: `Lorry walas ${report.imported ? "added" : "to add"}: ${report.addedTransporters.join(", ")}` }) : "",
    groups,
    issueList("Errors", report.errors, "err"), issueList("Changes from the workbook", report.changes), issueList("Kept as in the app", report.kept),
    issueList("No longer in the workbook", report.notInWorkbook), issueList("Warnings", report.warnings, "warn"),
    report.imported ? el("button", { type: "button", class: "secondary", id: "aawakShowImported", text: "Show in Aawak register", onclick: async () => {
      aawakRowFilter.clear();
      showAawakSubview("register");
      returnTrips.push({ kind: "import", view: "import", scroll: [] });
      await switchView("aawak");
      returnTrips.pop();
      await fillAawakMonths(report.aawakMonth);
      aawakState.rowsKey = null;
      await renderAawakRegister();
    } }) : "",
  ]));
}

$("aawakImportFile").addEventListener("change", () => {
  $("aawakImportRun").disabled = true;
  $("aawakImportResult").replaceChildren();
});
$("aawakImportCheck").addEventListener("click", async () => {
  try {
    const report = await sendAawakImport(false);
    if (!report) return;
    renderAawakReport(report);
    $("aawakImportRun").disabled = report.errors.length > 0 || (report.upToDate && !report.groups.some((g) => !g.currentGroup));
  } catch (error) {
    toast(errorText(error), "err");
  }
});
$("aawakImportRun").addEventListener("click", async () => {
  $("aawakImportRun").disabled = true;
  try {
    const report = await sendAawakImport(true);
    if (!report) return;
    renderAawakReport(report);
    if (report.imported) {
      aawakState.rowsKey = null;
      await loadMasters();
      toast(`Imported ✓ ${formatMonth(report.aawakMonth)}: ${num(report.added)} new, ${num(report.updated)} updated`);
    }
  } catch (error) {
    toast(errorText(error), "err");
  }
});
