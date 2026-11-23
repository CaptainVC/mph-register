"use strict";

// Register columns, column sets and how each cell of an entry row is drawn.

// ---------- Register-style tables ----------
// A slip kept only for its inward number (the server's AllZeroSlip): THAN, TP and TWO PART are 0 and nothing is dispatched.
const ALL_ZERO_TIP = "All zero: slip kept only for its number; its THAN were entered and billed in an earlier register";

function isAllZeroInput(payload) {
  return !payload.than && !payload.tp && !payload.twoPart && payload.dispatches.length === 0;
}

const COLUMNS = [
  ["INW. NO.", (e) => e.inwardNo, "inward", (td, e) => fillInwardCell(td, e)],
  ["DATE", (e) => formatDate(e.entryDate)],
  ["PARTY", (e) => e.party, "left"],
  ["D.N.", (e) => e.designNo, "", (td, e) => fillIdentifierCell(td, e.designNo)],
  ["LOT N.", (e) => e.lotNo, "", (td, e) => fillIdentifierCell(td, e.lotNo)],
  ["REP.", (e) => (e.repair ? "Yes" : "No"), (e) => (e.repair ? "rep-yes" : "rep-no")],
  ["THAN", (e) => num(e.than), "big"],
  ["TP", (e) => (e.tp ? num(e.tp) : "")],
  ["NAG", (e) => num(e.nag), "big"],
  ["FINISH", (e) => e.finish],
  ["NETT THAN", (e) => num(e.nettThan), "big"],
  ["BILL NO.", (e) => e.billedIn || "", "left bill-cell", (td, e) => fillBillNoCell(td, e)],
  ["LINKED ENTRY", (e) => linkText(e), "left link-cell", (td, e) => fillLinkCell(td, e)],
  ["TWO PART", (e) => (e.twoPart ? num(e.twoPart) : "")],
  ...[0, 1, 2].flatMap((i) => [
    [`JAWAK NAG ${i + 1}`, (e) => num(e.dispatches[i]?.qty ?? ""), "big"],
    [`GATE PASS NO ${i + 1}`, (e) => e.dispatches[i]?.gatePass ?? ""],
    [`DATE ${i + 1}`, (e) => (e.dispatches[i] ? (e.dispatches[i].date ? formatDate(e.dispatches[i].date) : e.dispatches[i].dateText || "") : "")],
  ]),
  ["MORE JAWAK", (e) => (e.dispatches.length > 3 ? e.dispatches.slice(3).map((d) => `${num(d.qty)}/${d.gatePass}`).join(", ") : "")],
  ["SHORT THAN", (e) => num(e.shortThan ?? "")],
  ["BALANCE", (e) => num(e.balance)],
  ["Aawak", (e) => aawakText(e), "left aawak-cell", (td, e) => fillAawakCell(td, e)],
  ["WARNINGS", (e) => e.warnings.join(" "), "left warning-cell", (td, e) => fillWarningCell(td, e)],
];

// The Aawak column: the Aawak rows (gate arrivals) the slip came on, each a link to that row; "No Aawak found" when there
// is no arrival row, including when the slip was marked as not needing one.
const NO_Aawak_TEXT = "No Aawak found";
const Aawak_NOT_NEEDED_TEXT = "No Aawak needed";
function aawakText(entry) {
  if (entry.aawak?.length) return entry.aawak.map((a) => a.number).join(", ");
  return entry.aawakState === "none" || entry.aawakState === "notNeeded" ? NO_Aawak_TEXT : "";
}

function fillAawakCell(td, entry) {
  if (!entry.aawak?.length) {
    const text = aawakText(entry);
    if (text) td.append(el("span", { class: entry.aawakState === "none" ? "aawak-none" : "muted", text }));
    return;
  }
  entry.aawak.forEach((arrival, index) => {
    if (index) td.append(", ");
    td.append(el("a", {
      href: "#", class: "aawak-link", text: arrival.number,
      title: `Open Aawak ${arrival.number} of ${formatMonth(arrival.aawakMonth)} (${formatDate(arrival.arrivalDate)}, ${arrival.transporter}, ${num(arrival.nag)} NAG)`,
      onclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof openArrival === "function") openArrival(arrival.id);
      },
    }));
  });
}

// ---------- Columns: Main / JAWAK / All (like Excel) ----------
// Main and JAWAK each fit a laptop screen without sideways scrolling; All is every column, as in the Excel register.
const DISPATCH_TITLES = [0, 1, 2].flatMap((i) => [`JAWAK NAG ${i + 1}`, `GATE PASS NO ${i + 1}`, `DATE ${i + 1}`]);
const COLUMN_SETS = {
  main: ["INW. NO.", "DATE", "PARTY", "D.N.", "LOT N.", "REP.", "THAN", "TP", "NAG", "FINISH", "NETT THAN", "BILL NO.", "LINKED ENTRY", "BALANCE", "WARNINGS"],
  jawak: ["INW. NO.", "DATE", "PARTY", "LOT N.", "NAG", "NETT THAN", "TWO PART", ...DISPATCH_TITLES, "MORE JAWAK", "SHORT THAN", "BALANCE"],
};
// The laptop layout (css/layout/laptop.css) starts at the same height. A short window starts on Main, a tall one on All.
const SHORT_WINDOW = matchMedia("(max-height: 820px)");
// Register entries ticked in JAWAK to be marked sent in full on one gate pass (by entry id).
const sendPicks = new Set();
const COLUMN_CELLS = ":is(thead th, tr[data-entry-id] > td)";

function columnSetStyles() {
  const hidden = (set) => COLUMNS.flatMap(([title], i) => (COLUMN_SETS[set].includes(title) ? [] : [`:nth-child(${i + 1})`])).join(", ");
  const balance = COLUMNS.findIndex(([title]) => title === "BALANCE") + 1;
  return [
    ...Object.keys(COLUMN_SETS).map((set) => `table.cols-${set} ${COLUMN_CELLS}:is(${hidden(set)}) { display: none; }`),
    // In All, BALANCE stays at the right edge while the wide table is scrolled; the row's own colour still shows.
    `table.cols-all ${COLUMN_CELLS}:nth-child(${balance}) { position: sticky; right: 0; box-shadow: -2px 0 0 var(--line); }`,
    `:where(table.cols-all) tr[data-entry-id] > td:nth-child(${balance}) { z-index: 1; background: var(--panel); }`,
    `table.cols-all thead th:nth-child(${balance}) { z-index: 3; }`,
    `@media (max-height: 820px) { #recentTable ${COLUMN_CELLS}:is(${hidden("main")}) { display: none; } }`,
  ].join("\n");
}
document.head.append(el("style", { id: "columnSets", text: columnSetStyles() }));

function columnSetOf(table) {
  let saved = null;
  try { saved = localStorage.getItem(`mph-columns-${table.id}`); } catch { /* private mode */ }
  if (saved === "all" || COLUMN_SETS[saved]) return saved;
  return SHORT_WINDOW.matches ? "main" : "all";
}

function showColumnSet(table, set) {
  for (const name of ["all", ...Object.keys(COLUMN_SETS)]) table.classList.toggle(`cols-${name}`, name === set);
  document.querySelectorAll(`.colset[data-table="${table.id}"] button`).forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.set === set));
  });
  if (table.id === "registerTable") updateSendFullBar();
}

function cellShown(td) {
  return getComputedStyle(td).display !== "none";
}

function fillIdentifierCell(td, value) {
  const segments = String(value ?? "").split(/(,)/);
  segments.forEach((segment, index) => {
    if (segment) td.append(segment);
    if (segment === "," && index < segments.length - 1) td.append(el("wbr"));
  });
}

function fillWarningCell(td, entry) {
  const text = entry.warnings.join(" ");
  td.title = text;
  td.append(el("span", { class: "warning-text", text }));
}

// The BILL NO. column holds saved bill numbers (comma separated), a "Billed outside app" note, "No bill needed" for a party that is
// never billed, or nothing.
const OUTSIDE_BILL_PREFIX = "Billed outside app";
const NO_BILL_TEXT = "No bill needed";
function billKind(entry) {
  if (!entry.billedIn) return entry.noBillNeeded ? "none" : "blank";
  return entry.billedIn.startsWith(OUTSIDE_BILL_PREFIX) ? "other" : "bill";
}

function fillBillNoCell(td, entry) {
  const kind = billKind(entry);
  // The text wraps inside a clamped box; hovering shows all of it as a tooltip and clicking the cell opens it out.
  const box = el("span", { class: "bill-text" });
  td.append(box);
  if (kind === "none") {
    box.append(el("span", { class: "muted", text: NO_BILL_TEXT }));
    return;
  }
  if (kind !== "bill") {
    box.textContent = entry.billedIn || "";
    td.title = entry.billedIn || "";
    return;
  }
  td.title = entry.billedIn;
  entry.billedIn.split(", ").forEach((invoiceNo, index) => {
    if (index) box.append(", ");
    box.append(el("a", {
      href: "#", class: "bill-link", text: invoiceNo, title: "Open this bill in Saved bills",
      onclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        openSavedBill(invoiceNo);
      },
    }));
  });
}

const OPEN_ENTRY_TIP = "Click an INW. NO. to open the whole entry";

function headerRow() {
  return el("thead", {}, [el("tr", {}, COLUMNS.map(([title], i) => el("th", i === 0 ? { text: title, title: OPEN_ENTRY_TIP } : { text: title })))]);
}

// ---------- In-place cell editing (like a spreadsheet) ----------
// Clicking a cell edits just that value and saves it on Enter, Tab or clicking away; Esc puts it back.
// INW. NO. opens the whole entry in the form; NAG, NETT THAN, BALANCE and the like are worked out, so they are not edited.
const CELL_EDITORS = {
  "DATE": { kind: "date", field: "entryDate" },
  "PARTY": { kind: "list", field: "party", items: () => state.masters.parties },
  "D.N.": { kind: "text", field: "designNo" },
  "LOT N.": { kind: "text", field: "lotNo" },
  "REP.": { kind: "yesno", field: "repair" },
  "THAN": { kind: "number", field: "than" },
  "TP": { kind: "number", field: "tp" },
  "FINISH": { kind: "list", field: "finish", items: () => state.masters.finishes },
  "TWO PART": { kind: "number", field: "twoPart" },
  "SHORT THAN": { kind: "number", field: "shortThan" },
};
[0, 1, 2].forEach((i) => {
  CELL_EDITORS[`JAWAK NAG ${i + 1}`] = { kind: "number", dispatch: i, part: "qty" };
  CELL_EDITORS[`GATE PASS NO ${i + 1}`] = { kind: "text", dispatch: i, part: "gatePass" };
  CELL_EDITORS[`DATE ${i + 1}`] = { kind: "date", dispatch: i, part: "date" };
});
const CELL_SPECS = COLUMNS.map(([title]) => CELL_EDITORS[title] || null);
const DISPATCH_PART_LABEL = { qty: "JAWAK NAG", gatePass: "GATE PASS NO", date: "DATE" };
const DRAFT_TIP = "Not saved yet: fill JAWAK NAG and GATE PASS NO";
const ENTRY_STATUSES = ["pending", "partial", "done", "over", "allZero"];

const rowEntry = new WeakMap();
// A new dispatch typed into the first empty JAWAK NAG / GATE PASS NO / DATE slot, kept until it has a quantity and a gate pass.
const dispatchDrafts = new Map();

function dispatchDraft(entry, index) {
  const draft = dispatchDrafts.get(entry.id);
  return draft && draft.index === index && index === entry.dispatches.length ? draft : null;
}

function cellEditable(entry, index) {
  const spec = CELL_SPECS[index];
  if (!spec) return false;
  return spec.dispatch === undefined || spec.dispatch <= entry.dispatches.length;
}

function cellValue(entry, spec) {
  if (spec.dispatch !== undefined) {
    const dispatch = entry.dispatches[spec.dispatch] || dispatchDraft(entry, spec.dispatch);
    const value = dispatch ? dispatch[spec.part] : null;
    return value === null || value === undefined ? "" : String(value);
  }
  if (spec.field === "repair") return entry.repair ? "Yes" : "No";
  const value = entry[spec.field];
  // TP and TWO PART show blank for 0, so they edit as blank too.
  if ((spec.field === "tp" || spec.field === "twoPart") && !value) return "";
  return value === null || value === undefined ? "" : String(value);
}

function draftCellText(draft, part) {
  if (part === "qty") return draft.qty === null ? "" : num(draft.qty);
  if (part === "date") return draft.date ? formatDate(draft.date) : "";
  return draft.gatePass;
}

// "22/Nov/26 21:40" from an import's time.
function importWhen(importedAt) {
  const [day, time = ""] = importedAt.split(" ");
  return `${formatDate(day)} ${time.slice(0, 5)}`.trim();
}

// "Added by the import of NOV.xlsm on 22/Nov/26 21:40" — the row's tooltip says what the latest import did to it.
function importNote(mark) {
  if (!mark) return "";
  const when = importWhen(mark.importedAt);
  if (mark.action === "added") return `Added by the import of ${mark.fileName} on ${when}`;
  return `Updated by the import of ${mark.fileName} (${formatMonth(mark.registerMonth)}) on ${when}${mark.changes ? `: ${mark.changes}` : ""}`;
}

// The inward number; an entry an import has updated also gets a Δ that opens what the import changed (import-history.js).
function fillInwardCell(td, entry) {
  td.append(String(entry.inwardNo));
  if (!entry.importUpdatedAt) return;
  const when = importWhen(entry.importUpdatedAt);
  td.append(el("button", {
    type: "button", class: "import-tag", text: "Δ", title: `Updated by an import on ${when}. Click to see what changed`,
    "aria-label": `See what the import of ${when} changed in INW. NO. ${entry.inwardNo}`,
    onclick: (event) => {
      event.preventDefault();
      event.stopPropagation();
      openImportHistory(entry.id, event.currentTarget.closest("tbody"));
    },
  }));
}

function fillEntryRow(tr, entry) {
  rowEntry.set(tr, entry);
  tr.dataset.entryId = String(entry.id);
  tr.classList.remove(...ENTRY_STATUSES);
  tr.classList.add(entry.status);
  tr.classList.toggle("carried", entry.carriedOver);
  tr.classList.toggle("has-warning", entry.warnings.length > 0);
  const tips = entry.status === "allZero" ? [ALL_ZERO_TIP, ...entry.warnings] : [...entry.warnings];
  const imported = importNote(entry.lastImport);
  if (imported) tips.push(imported);
  tr.title = tips.join("\n");
  [...tr.cells].forEach((td, index) => { if (!td.classList.contains("cell-editing")) fillEntryCell(td, entry, index); });
}

function fillEntryCell(td, entry, index) {
  const [, value, cls, render] = COLUMNS[index];
  const spec = CELL_SPECS[index];
  td.className = typeof cls === "function" ? cls(entry) : cls || "";
  td.removeAttribute("title");
  // The tick box survives a redraw of its row: a click on it first ends a cell edit in the same row, which redraws the
  // row, and a new box would miss that click.
  const pick = index === 0 && canSendFull(entry) ? td.querySelector(":scope > .send-pick") || sendPickBox() : null;
  for (const node of [...td.childNodes]) if (node !== pick) node.remove();
  const draft = spec?.dispatch !== undefined ? dispatchDraft(entry, spec.dispatch) : null;
  if (draft) {
    td.textContent = draftCellText(draft, spec.part);
    td.classList.add("cell-draft");
    td.title = DRAFT_TIP;
  } else if (render) render(td, entry);
  else td.append(String(value(entry)));
  if (cellEditable(entry, index)) td.classList.add("editable");
  if (pick) {
    pick.checked = sendPicks.has(entry.id);
    pick.setAttribute("aria-label", `Tick INW. NO. ${entry.inwardNo} to send it in full`);
    if (td.firstChild !== pick) td.prepend(pick);
  }
}
