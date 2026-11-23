"use strict";

// Editing a register cell in place and saving the entry.

let activeCellEditor = null;
let cellSaves = Promise.resolve();
let partyTableStale = false;

// Every drawn row of an entry by id (Register, Party-wise, Recent), so a saved cell finds its rows without searching a
// page of thousands of rows. Rows no longer on the page are dropped as they are met (the Register's kept rows stay).
const entryRowsById = new Map();
let entryRowsAdded = 0;
const rowKept = (tr) => tr.isConnected || registerRows.byId.get(rowEntry.get(tr)?.id) === tr;

function trackEntryRow(tr, id) {
  let rows = entryRowsById.get(id);
  if (!rows) {
    rows = new Set();
    entryRowsById.set(id, rows);
  }
  rows.add(tr);
  if (++entryRowsAdded >= 10000) pruneEntryRows();
}

// Lets go of rows no longer on the page, so the old tables they belonged to can be freed.
function pruneEntryRows() {
  entryRowsAdded = 0;
  for (const [key, set] of entryRowsById) {
    for (const row of set) if (!rowKept(row)) set.delete(row);
    if (!set.size) entryRowsById.delete(key);
  }
}

function rowsOfEntry(id) {
  const rows = entryRowsById.get(id);
  if (!rows) return [];
  for (const tr of rows) if (!rowKept(tr)) rows.delete(tr);
  return [...rows];
}

function entryRow(entry) {
  const tr = el("tr", {}, COLUMNS.map(() => el("td")));
  fillEntryRow(tr, entry);
  trackEntryRow(tr, entry.id);
  tr.addEventListener("click", (event) => {
    const td = event.target.closest("td");
    if (!td || td.parentElement !== tr || td.classList.contains("cell-editing")) return;
    // Let a cell that is still saving finish first, so the form opens with its new value.
    if (td.cellIndex === 0) cellSaves.then(() => loadIntoForm(rowEntry.get(tr)));
    else if (td.classList.contains("bill-cell") || td.classList.contains("warning-cell")) td.classList.toggle("expanded");
    else openCellEditor(td);
  });
  return tr;
}

function canonicalName(spec, text) {
  const typed = text.trim();
  const match = spec.items().find((item) => item.name.toLowerCase() === typed.toLowerCase());
  return match ? match.name : typed;
}

function openCellEditor(td) {
  const tr = td.parentElement;
  const entry = rowEntry.get(tr);
  const index = td.cellIndex;
  const spec = CELL_SPECS[index];
  if (!entry || !spec || !cellEditable(entry, index) || td.classList.contains("cell-editing")) return false;
  discardDraftsExcept(entry, spec);
  const original = cellValue(entry, spec);
  // A new dispatch is dated today unless changed, as in the form.
  const isNewSlot = spec.dispatch !== undefined && spec.dispatch === entry.dispatches.length;
  const initial = isNewSlot && spec.part === "date" && !original ? todayIso() : original;
  let input;
  if (spec.kind === "yesno") {
    input = dropdownOf(YES_NO_OPTIONS, initial, { class: "cell-input", "aria-label": COLUMNS[index][0] }, { enterOpens: false });
  } else {
    input = el("input", { class: "cell-input", type: spec.kind === "date" ? "date" : "text", autocomplete: "off", spellcheck: "false", "aria-label": COLUMNS[index][0] });
    if (spec.kind === "number") input.inputMode = "numeric";
  }
  input.value = initial;
  const minimum = spec.kind === "date" ? 150 : spec.kind === "list" ? 200 : spec.kind === "yesno" ? 76 : 64;
  const width = Math.max(td.clientWidth - 8, minimum);
  td.classList.add("cell-editing");
  td.replaceChildren(input);
  input.style.minWidth = `${width}px`;
  const editor = { td, tr, spec, input, original, busy: false, closed: false, offer: null };
  // An empty new JAWAK NAG offers what is left to send: Enter or Tab takes it, typing replaces it.
  if (isNewSlot && spec.part === "qty" && !initial && entry.balance > 0) {
    editor.offer = entry.balance;
    input.placeholder = num(entry.balance);
    input.title = sendAllTip(entry.balance);
  }
  activeCellEditor = editor;
  if (spec.kind === "list") {
    attachSuggestions(input, (text) => masterSuggestions(spec.items, text, original), {
      handleEnter: false,
      cancelOnEscape: true,
      onPick: (_, source) => { if (source === "click") commitCellEditor(editor, null); },
    });
  }
  input.addEventListener("keydown", (event) => onCellEditorKey(editor, event));
  input.addEventListener("blur", () => { if (!editor.busy && !editor.closed) commitCellEditor(editor, null, true); });
  if (spec.kind === "yesno") input.addEventListener("change", () => commitCellEditor(editor, null));
  input.focus({ preventScroll: true });
  if (spec.kind === "yesno") openDropdownControl(input);
  else if (spec.kind !== "date") input.select();
  return true;
}

function onCellEditorKey(editor, event) {
  const key = event.key;
  let move;
  if (key === "Enter") move = { rows: event.shiftKey ? -1 : 1 };
  else if (key === "Tab") move = { cols: event.shiftKey ? -1 : 1 };
  else if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "s") move = null;
  else if (key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (!editor.busy) cancelCellEditor(editor);
    return;
  } else return;
  event.preventDefault();
  event.stopPropagation();
  if (editor.busy) return;
  commitCellEditor(editor, move);
}

function closeCellEditor(editor) {
  if (editor.closed) return;
  editor.closed = true;
  if (activeCellEditor === editor) activeCellEditor = null;
  const { td, tr } = editor;
  td.classList.remove("cell-editing", "cell-saving");
  if (td.isConnected) fillEntryCell(td, rowEntry.get(tr), td.cellIndex);
  afterCellEditing();
}

function cancelCellEditor(editor) {
  const entry = rowEntry.get(editor.tr);
  const hadDraft = dispatchDrafts.has(entry.id);
  dispatchDrafts.delete(entry.id);
  closeCellEditor(editor);
  if (hadDraft) redrawEntry(entry);
}

function redrawEntry(entry) {
  rowsOfEntry(entry.id).forEach((tr) => fillEntryRow(tr, rowEntry.get(tr)));
}

// Leaving a half-typed dispatch (no quantity or no gate pass yet) drops it instead of saving something incomplete.
function discardDraftsExcept(entry, spec) {
  for (const [id, draft] of [...dispatchDrafts]) {
    if (entry && id === entry.id && spec?.dispatch === draft.index) continue;
    dispatchDrafts.delete(id);
    rowsOfEntry(id).forEach((tr) => fillEntryRow(tr, rowEntry.get(tr)));
    toast("Dispatch not saved: it needs both JAWAK NAG and GATE PASS NO.", "err");
  }
}

// Once nothing is being edited: drop a half-typed dispatch and redraw Party-wise so its group totals catch up.
function afterCellEditing() {
  setTimeout(() => {
    if (activeCellEditor) return;
    discardDraftsExcept(null, null);
    // A hidden Party-wise draws again when it is opened (switchView), not after every saved cell.
    if (partyTableStale && $("view-partywise").classList.contains("active")) {
      partyTableStale = false;
      if ($("partyTable").tBodies.length) renderPartywise({ reuse: true }).catch(showFatal);
    }
  }, 250);
}

function moveCellEditor(editor, move) {
  if (!move) return;
  const { tr, td } = editor;
  if (!tr.isConnected) return;
  let target = null;
  if (move.rows) {
    // Walks to the next shown entry row instead of copying every row of the table on each Enter.
    let row = tr;
    for (let steps = Math.abs(move.rows); steps > 0 && row;) {
      row = move.rows > 0 ? row.nextElementSibling : row.previousElementSibling;
      if (row && rowEntry.has(row) && !row.hidden) steps--;
    }
    target = row && row !== tr ? row.cells[td.cellIndex] || null : null;
  } else {
    for (let i = td.cellIndex + move.cols; i > 0 && i < tr.cells.length; i += move.cols) {
      if (cellEditable(rowEntry.get(tr), i) && cellShown(tr.cells[i])) { target = tr.cells[i]; break; }
    }
  }
  if (target && openCellEditor(target)) target.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function entryPayload(entry) {
  return {
    registerMonth: entry.registerMonth,
    inwardNo: entry.inwardNo,
    entryDate: entry.entryDate,
    party: entry.party,
    designNo: entry.designNo,
    lotNo: entry.lotNo,
    repair: entry.repair,
    than: entry.than,
    tp: entry.tp || null,
    twoPart: entry.twoPart || null,
    finish: entry.finish,
    shortThan: entry.shortThan ?? null,
    dispatches: entry.dispatches.map((d) => ({ qty: d.qty, gatePass: d.gatePass, date: d.date })),
  };
}

// Saves run one after another, each on top of the entry the previous one returned.
function queueEntrySave(tr, change) {
  const run = async () => {
    const entry = rowEntry.get(tr);
    const payload = entryPayload(entry);
    change(payload);
    const saved = await api(`/api/entries/${entry.id}`, { method: "PUT", json: payload });
    applySavedEntry(saved);
    return saved;
  };
  const next = cellSaves.then(run, run);
  cellSaves = next.catch(() => {});
  return next;
}

function applySavedEntry(saved) {
  const update = (list) => { const found = list?.find((e) => e.id === saved.id); if (found) Object.assign(found, saved); };
  for (const list of state.entriesCache.values()) update(list);
  update(partywiseLoaded.entries);
  rowsOfEntry(saved.id).forEach((tr) => {
    const entry = rowEntry.get(tr);
    Object.assign(entry, saved);
    fillEntryRow(tr, entry);
  });
  if ($("registerTable").tBodies.length) renderTotals($("registerTotals"), registerShown);
  registerSearchPool.index = null;
  registerHaystacks = new WeakMap();
  state.entriesRevision++;
  partyTableStale = true;
}

function cellChange(entry, spec, value) {
  if (spec.dispatch === undefined) {
    if (spec.field === "repair") return (p) => { p.repair = value === "Yes"; };
    if (spec.field === "lotNo" || spec.field === "designNo") {
      // As in the form: R typed into LOT N. or D.N. sets REP. to Yes once.
      const wasMarked = hasRepairMark(entry.lotNo) || hasRepairMark(entry.designNo);
      return (p) => {
        p[spec.field] = value;
        if (!wasMarked && !p.repair && (hasRepairMark(p.lotNo) || hasRepairMark(p.designNo))) p.repair = true;
      };
    }
    return (p) => { p[spec.field] = spec.kind === "date" ? value || null : value; };
  }
  const i = spec.dispatch;
  if (spec.part === "qty" && value === null) return (p) => { p.dispatches.splice(i, 1); };
  return (p) => { p.dispatches[i][spec.part] = spec.part === "date" ? value || null : value; };
}

async function commitCellEditor(editor, move, fromBlur = false) {
  if (editor.busy || editor.closed) return;
  editor.busy = true;
  const { tr, td, spec, input } = editor;
  const entry = rowEntry.get(tr);
  let text = spec.kind === "list" ? canonicalName(spec, input.value) : input.value.trim();
  if (!text && editor.offer && !fromBlur) text = String(editor.offer);
  const fail = (message) => {
    toast(message, "err");
    if (fromBlur || activeCellEditor !== editor || !input.isConnected) {
      dispatchDrafts.delete(entry.id);
      closeCellEditor(editor);
      redrawEntry(entry);
      return;
    }
    td.classList.remove("cell-saving");
    input.readOnly = false;
    input.classList.add("invalid");
    editor.busy = false;
    input.focus({ preventScroll: true });
  };
  let value = text;
  if (spec.kind === "number") {
    value = intOrNull(text.replace(/[,\s]/g, ""));
    if (Number.isNaN(value)) { fail("Numbers must be whole numbers."); return; }
  }

  const isNewSlot = spec.dispatch !== undefined && spec.dispatch === entry.dispatches.length;
  let change;
  let draftDone = false;
  if (isNewSlot) {
    const draft = { ...(dispatchDraft(entry, spec.dispatch) || { index: spec.dispatch, qty: null, gatePass: "", date: null }) };
    draft[spec.part] = spec.part === "date" ? value || null : value;
    if (draft.qty === null && !draft.gatePass) {
      dispatchDrafts.delete(entry.id);
      closeCellEditor(editor);
      redrawEntry(entry);
      moveCellEditor(editor, move);
      return;
    }
    if (draft.qty === null || !draft.gatePass) {
      // Still half a dispatch: show what was typed and go to the box it still needs.
      dispatchDrafts.set(entry.id, draft);
      closeCellEditor(editor);
      redrawEntry(entry);
      if (!fromBlur) {
        const missing = `${DISPATCH_PART_LABEL[draft.qty === null ? "qty" : "gatePass"]} ${spec.dispatch + 1}`;
        openCellEditor(tr.cells[COLUMNS.findIndex(([title]) => title === missing)]);
      }
      return;
    }
    change = (p) => { p.dispatches.push({ qty: draft.qty, gatePass: draft.gatePass, date: draft.date || todayIso() }); };
    draftDone = true;
  } else {
    if (text === editor.original) { closeCellEditor(editor); moveCellEditor(editor, move); return; }
    change = cellChange(entry, spec, value);
  }

  const preview = entryPayload(entry);
  change(preview);
  if (spec.part === "qty" && !isNewSlot && value === null) {
    const dispatch = entry.dispatches[spec.dispatch];
    const ok = await showConfirm({
      title: "Remove this dispatch?",
      message: `Clearing JAWAK NAG removes dispatch ${spec.dispatch + 1} (${num(dispatch.qty)} JAWAK NAG, gate pass ${dispatch.gatePass || "blank"}).`,
      confirmText: "Remove dispatch",
      cancelText: "Keep it",
      tone: "danger",
    });
    if (!ok) { closeCellEditor(editor); return; }
  }
  if (isAllZeroInput(preview) && entry.status !== "allZero") {
    const ok = await showConfirm({
      title: "Save an all-zero entry?",
      message: "THAN, TP and TWO PART are all 0 and nothing is dispatched.",
      detail: ALL_ZERO_TIP,
      confirmText: "Save all-zero entry",
      cancelText: "Go back",
    });
    if (!ok) { closeCellEditor(editor); return; }
  }

  const before = { repair: entry.repair, billedIn: entry.billedIn };
  td.classList.add("cell-saving");
  input.readOnly = true;
  try {
    const saved = await queueEntrySave(tr, change);
    if (draftDone) dispatchDrafts.delete(saved.id);
    closeCellEditor(editor);
    redrawEntry(saved);
    td.classList.add("cell-saved");
    setTimeout(() => td.classList.remove("cell-saved"), 900);
    if (saved.repair && !before.repair && spec.field !== "repair") toast("REP. set to Yes: LOT N. or D.N. is marked R (repair).", "warn");
    if (before.billedIn) toast(`Already billed (${before.billedIn}). Changing this entry does not change that bill.`, "warn");
    // Unless another cell was clicked meanwhile, Enter / Tab go on to the next cell.
    if (!fromBlur && !activeCellEditor) moveCellEditor(editor, move);
  } catch (error) {
    fail(error.errors ? error.errors.join(" ") : error.message);
  }
}
