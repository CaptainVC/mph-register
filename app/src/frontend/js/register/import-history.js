"use strict";

// Import history. An entry keeps the import that added it and the latest import that updated it. The Δ next to an updated
// entry's INW. NO. opens them in a side window: what the import changed (was → now), what follows from it, and when each
// import happened. Earlier updates are not kept.

// The saved entry's value for a field an import changed, written as the server writes it, to tell a value the import set
// from one edited since.
const IMPORT_FIELD_NOW = {
  "REGISTER MONTH": (e) => e.registerMonth,
  "INW. NO.": (e) => String(e.inwardNo),
  "DATE": (e) => e.entryDate,
  "PARTY": (e) => e.party,
  "D.N.": (e) => e.designNo,
  "LOT N.": (e) => e.lotNo,
  "REP.": (e) => (e.repair ? "Yes" : "No"),
  "THAN": (e) => String(e.than),
  "TP": (e) => String(e.tp),
  "FINISH": (e) => e.finish,
  "TWO PART": (e) => String(e.twoPart),
  "SHORT THAN": (e) => (e.shortThan == null ? "" : String(e.shortThan)),
  "NAG": (e) => String(e.nag),
  "NETT THAN": (e) => String(e.nettThan),
  "BALANCE": (e) => String(e.balance),
};
const IMPORT_NUMBER_FIELDS = new Set(["INW. NO.", "THAN", "TP", "TWO PART", "SHORT THAN", "NAG", "NETT THAN", "BALANCE"]);

function importValueText(field, value) {
  if (value === "" || value == null) return "blank";
  if (field === "DATE") return formatDate(value);
  if (field === "REGISTER MONTH") return formatMonth(value);
  return IMPORT_NUMBER_FIELDS.has(field) ? num(value) : value;
}

function importDispatchText(dispatch) {
  if (!dispatch) return "none";
  const date = dispatch.date ? formatDate(dispatch.date) : dispatch.dateText || "no date";
  return `${num(dispatch.qty)} NAG · gate pass ${dispatch.gatePass || "blank"} · ${date}`;
}

function sameImportDispatch(a, b) {
  if (!a || !b) return !a && !b;
  return a.qty === b.qty && a.gatePass === b.gatePass && (a.date || a.dateText || "") === (b.date || b.dateText || "");
}

// "Was → Now": the value the import set, and when the entry has been edited since, what it holds now.
function importChangeRow(label, was, now, current) {
  const edited = current !== null && current !== now;
  return el("tr", {}, [
    el("td", { text: label }),
    el("td", { class: "ih-was", text: was }),
    el("td", {}, [
      el("span", { class: edited ? "ih-now edited" : "ih-now", text: now }),
      edited ? el("div", { class: "ih-edited", text: `edited since: ${current}` }) : "",
    ]),
  ]);
}

function importChangeTable(caption, rows) {
  return el("div", { class: "ih-block" }, [
    el("h3", { text: caption }),
    el("table", { class: "ih-table" }, [
      el("thead", {}, [el("tr", {}, ["Field", "Was", "Now"].map((text) => el("th", { text })))]),
      el("tbody", {}, rows),
    ]),
  ]);
}

// The changes of one update. `entry` is passed only for the latest update, whose values may have been edited since.
function importDetailBlocks(details, entry) {
  const fieldRows = details.fields.map((f) => importChangeRow(
    f.field, importValueText(f.field, f.was), importValueText(f.field, f.now),
    entry && IMPORT_FIELD_NOW[f.field] ? importValueText(f.field, IMPORT_FIELD_NOW[f.field](entry)) : null));
  const dispatchRows = details.dispatches.map((d) => importChangeRow(
    `Dispatch ${d.number}`, importDispatchText(d.was), importDispatchText(d.now),
    entry && !sameImportDispatch(d.now, entry.dispatches[d.number - 1]) ? importDispatchText(entry.dispatches[d.number - 1]) : null));
  const effectRows = details.effects.map((f) => importChangeRow(
    f.field, importValueText(f.field, f.was), importValueText(f.field, f.now),
    entry ? importValueText(f.field, IMPORT_FIELD_NOW[f.field](entry)) : null));
  const blocks = [];
  if (fieldRows.length || dispatchRows.length) blocks.push(importChangeTable("What the import changed", [...fieldRows, ...dispatchRows]));
  if (effectRows.length) blocks.push(importChangeTable("Follows from it (worked out by the app)", effectRows));
  return blocks.length ? blocks : [el("p", { class: "muted", text: "Nothing in the entry differs from before." })];
}

function importEventSection(event, entry, latest) {
  const updated = event.action === "updated";
  const head = el("div", { class: "ih-head" }, [
    el("span", { class: `ih-badge ${updated ? "updated" : "added"}`, text: updated ? "UPDATED" : "ADDED" }),
    el("span", { class: "ih-when", text: importWhen(event.importedAt) }),
  ]);
  const source = el("p", { class: "muted ih-source" }, [
    `${updated ? "By" : "From"} the import of `, el("b", { text: event.fileName }), ` (${formatMonth(event.registerMonth)} register`,
    event.sourceRow ? `, row ${event.sourceRow}` : "", ")",
  ]);
  const body = [];
  if (!updated) body.push(el("p", { text: "The entry was added by this import." }));
  else if (event.details) body.push(...importDetailBlocks(event.details, latest ? entry : null));
  else {
    body.push(el("p", { class: "muted", text: "What this import changed was not recorded." }));
    if (event.changes) body.push(el("p", { text: event.changes }));
  }
  return el("section", { class: `ih-event ${updated ? "updated" : "added"}` }, [head, source, ...body]);
}

// Steps to the previous and next entry with a Δ in the table the window was opened from.
function importHistorySteps(entryId, tbody) {
  const ids = tbody ? [...tbody.querySelectorAll("tr[data-entry-id] .import-tag")].map((tag) => Number(tag.closest("tr").dataset.entryId)) : [];
  const at = ids.indexOf(entryId);
  return { ids, at, previous: at > 0 ? ids[at - 1] : null, next: at >= 0 && at < ids.length - 1 ? ids[at + 1] : null };
}

async function openImportHistory(entryId, tbody) {
  const dialog = $("importHistoryDrawer");
  const form = $("importHistoryForm");
  let entry;
  let history;
  try {
    [entry, history] = await Promise.all([api(`/api/entries/${entryId}`), api(`/api/entries/${entryId}/import-history`)]);
  } catch (error) {
    toast(`Could not open the import history: ${errorText(error)}`, "err");
    return;
  }
  const steps = importHistorySteps(entryId, tbody);
  const events = history.events;
  const latestUpdate = events.find((e) => e.action === "updated");
  const body = events.length
    ? events.map((event) => importEventSection(event, entry, event === latestUpdate))
    : [el("p", { class: "muted", text: "No import has touched this entry: it was typed in the app." })];
  body.push(el("p", { class: "muted ih-keep", text: "Only the import that added the entry and the latest import that updated it are kept; earlier updates are not." }));
  const step = (text, id) => el("button", { type: "button", class: "secondary", text, ...(id === null ? { disabled: "" } : {}), onclick: () => openImportHistory(id, tbody) });
  const actions = [
    el("button", { type: "button", text: "Open entry", onclick: () => { closeDrawer(dialog, true); openInwardEntry(entry.id); } }),
    ...(steps.at >= 0 ? [step("‹ Previous changed", steps.previous), step("Next changed ›", steps.next)] : []),
    el("button", { type: "button", class: "secondary", text: "Close", onclick: () => closeDrawer(dialog) }),
  ];
  drawerForm(form, {
    title: `INW. NO. ${entry.inwardNo} · ${entry.party}`,
    subtitle: `${formatDate(entry.entryDate)} · ${formatMonth(entry.registerMonth)} register${steps.at >= 0 ? ` · ${steps.at + 1} of ${steps.ids.length} changed` : ""}`,
    key: `import-history-${entryId}`,
    body,
    actions,
  });
  openDrawer(dialog);
}
