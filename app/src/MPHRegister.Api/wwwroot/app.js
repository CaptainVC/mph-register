"use strict";

const state = {
  masters: { parties: [], finishes: [] },
  entryMonth: "",
  editing: null,
  entriesCache: new Map(),
};

const $ = (id) => document.getElementById(id);

// Indian digit grouping everywhere on screen: 1,23,45,678 and ₹1,23,456.00.
const INDIAN = new Intl.NumberFormat("en-IN");
const INDIAN_MONEY = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function num(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? INDIAN.format(n) : String(value);
}
function money(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? `₹${INDIAN_MONEY.format(n)}` : String(value);
}
const ENTRY_FIELDS = ["inwardNo", "entryDate", "party", "designNo", "lotNo", "repair", "than", "tp", "finish", "twoPart"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function api(path, options = {}) {
  const init = { ...options, headers: { ...(options.headers || {}) } };
  if (init.method && init.method !== "GET") init.headers["X-MPH-Request"] = "1";
  if (init.json !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(init.json);
    delete init.json;
  }
  const response = await fetch(path, init);
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const errors = body && body.errors ? body.errors : [`Request failed (${response.status}).`];
    const error = new Error(errors.join(" "));
    error.errors = errors;
    throw error;
  }
  return body;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthOf(iso) {
  return iso && /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : todayIso().slice(0, 7);
}

function financialYearOf(month) {
  const [year, number] = month.split("-").map(Number);
  return String(year - (number < 4 ? 1 : 0));
}

function formatFinancialYear(year) {
  return `${year}-${Number(year) + 1}`;
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${MONTHS[Number(m) - 1]}/${y.slice(2)}`;
}

function formatMonth(month) {
  if (!month) return "";
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

function normalize(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function intOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

// Says why a table is empty, centred under its header in the visible part of the table box (even when the table is
// wider than the box). Pass "" once the table has rows again.
function setTableEmpty(table, text) {
  const wrap = table.parentElement;
  let note = [...wrap.children].find((node) => node.classList.contains("table-empty"));
  if (!text) { note?.remove(); return; }
  if (!note) { note = el("div", { class: "table-empty", role: "status" }); wrap.append(note); }
  if (note.dataset.text !== text) { note.textContent = text; note.dataset.text = text; }
}

// ---------- Layout helpers: fields, sections, slide-in edit windows, toasts ----------
function field(label, input, hint, className = "") {
  const target = input.id ? input : input.querySelector?.("[id]");
  const children = [el("label", target?.id ? { for: target.id, text: label } : { text: label }), input];
  if (hint) children.push(el("span", { class: "hint", text: hint }));
  return el("div", { class: `field ${className}`.trim() }, children);
}

function fieldsGrid(nodes, cols = 2) {
  return el("div", { class: `fields${cols > 2 ? ` cols-${cols}` : ""}`, style: cols === 1 ? "--cols: 1" : "" }, nodes);
}

function checkbox(input, text) {
  return el("label", { class: "check" }, [input, text]);
}

function section(title, children, note) {
  return el("section", { class: "section" }, [el("div", { class: "section-head" }, [el("h3", { text: title }), note ? el("span", { class: "muted", text: note }) : ""]), ...children]);
}

// Fills an edit window: fixed title bar, scrolling sections, fixed button bar. Inputs marked data-instant save on their own
// and do not count as unsaved changes.
function drawerForm(form, { title, subtitle, body, actions, key = "" }) {
  const dialog = form.closest("dialog");
  const keepScroll = dialog.open && form.dataset.key === key ? form.querySelector(".drawer-body")?.scrollTop || 0 : 0;
  const close = el("button", { type: "button", class: "icon-btn", title: "Close (Esc)", "aria-label": "Close", text: "×", onclick: () => closeDrawer(dialog) });
  form.replaceChildren(
    el("header", { class: "drawer-head" }, [el("h2", {}, [title, subtitle ? el("span", { class: "sub", text: subtitle }) : ""]), close]),
    el("div", { class: "drawer-body" }, body),
    el("footer", { class: "drawer-foot" }, [...actions, el("div", { class: "form-message message", role: "status" })]),
  );
  form.dataset.dirty = "";
  form.dataset.key = key;
  form.oninput = (event) => { if (!event.target.closest("[data-instant]")) form.dataset.dirty = "1"; };
  form.onchange = form.oninput;
  if (keepScroll) form.querySelector(".drawer-body").scrollTop = keepScroll;
}

// ---------- Modal confirmation and notice dialogs (never use browser alert/confirm) ----------
let modalQueue = Promise.resolve();

function openAppDialog({ title, message, detail = "", confirmText = "OK", cancelText = null, tone = "primary" }) {
  const run = () => new Promise((resolve) => {
    const dialog = $("appDialog");
    const previousFocus = document.activeElement;
    let settled = false;

    const closeIcon = el("button", { type: "button", class: "icon-btn", title: "Close (Esc)", "aria-label": "Close", text: "×" });
    const confirmBtn = el("button", {
      type: "button",
      id: "appDialogConfirm",
      class: tone === "danger" ? "danger-solid" : "",
      text: confirmText,
    });
    const cancelBtn = cancelText !== null
      ? el("button", { type: "button", id: "appDialogCancel", class: "secondary", text: cancelText })
      : null;

    const bodyNodes = [];
    if (message) bodyNodes.push(el("p", { class: "modal-message", text: message }));
    if (detail) bodyNodes.push(el("p", { class: "modal-detail", text: detail }));

    dialog.replaceChildren(
      el("div", { class: "modal-box" }, [
        el("header", { class: "modal-head" }, [el("h2", { id: "appDialogTitle", text: title }), closeIcon]),
        el("div", { class: "modal-body", id: "appDialogBody" }, bodyNodes),
        el("footer", { class: "modal-foot" }, cancelBtn ? [cancelBtn, confirmBtn] : [confirmBtn]),
      ]),
    );

    const finish = (result) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown, true);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("mousedown", onBackdrop);
      if (dialog.open) dialog.close();
      if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === "function") {
        previousFocus.focus({ preventScroll: true });
      }
      resolve(result);
    };

    const onKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    };
    const onCancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    const onBackdrop = (event) => {
      if (event.target === dialog) finish(false);
    };

    closeIcon.addEventListener("click", () => finish(false));
    cancelBtn?.addEventListener("click", () => finish(false));
    confirmBtn.addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onKeydown, true);
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("mousedown", onBackdrop);

    dialog.showModal();
    const initialFocus = cancelBtn && tone === "danger" ? cancelBtn : confirmBtn;
    initialFocus.focus({ preventScroll: true });
  });

  const next = modalQueue.then(run, run);
  modalQueue = next.then(() => {}, () => {});
  return next;
}

function showConfirm({ title, message, detail = "", confirmText = "Confirm", cancelText = "Cancel", tone = "primary" }) {
  return openAppDialog({ title, message, detail, confirmText, cancelText, tone });
}

function showAlert({ title = "Notice", message, detail = "", okText = "OK", tone = "primary" }) {
  return openAppDialog({ title, message, detail, confirmText: okText, cancelText: null, tone }).then(() => {});
}

// Opens the window; returns true when it was closed before (so the first field should get the focus).
function openDrawer(dialog, first) {
  if (dialog.open) return false;
  dialog.showModal();
  first?.focus({ preventScroll: true });
  return true;
}

async function closeDrawer(dialog, force = false) {
  if (!dialog.open) return true;
  const form = dialog.querySelector("form");
  if (!force && form?.dataset.dirty) {
    if ($("appDialog")?.open) return false;
    const discard = await showConfirm({
      title: "Unsaved changes",
      message: "Close without saving your changes?",
      confirmText: "Discard changes",
      cancelText: "Keep editing",
      tone: "danger",
    });
    if (!discard) return false;
  }
  if (form) form.dataset.dirty = "";
  if (dialog.open) dialog.close();
  return true;
}

document.querySelectorAll("dialog.drawer").forEach((dialog) => {
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDrawer(dialog);
  });
  dialog.addEventListener("mousedown", (event) => { if (event.target === dialog) closeDrawer(dialog); });
});

function markSaved(form) {
  form.dataset.dirty = "";
}

// Toasts live in the browser's top layer (a popover), re-raised each time so they show above an open edit window.
// An action ({ id, label, run }) adds a button, such as Undo, and keeps the toast up longer.
function toast(text, kind = "ok", action = null) {
  const box = $("toasts");
  const item = el("div", { class: `toast ${kind}` }, [el("span", { text })]);
  if (action) {
    item.append(el("button", { type: "button", id: action.id, class: "secondary small toast-action", text: action.label, onclick: () => { item.remove(); action.run(); } }));
  }
  box.append(item);
  if (box.showPopover) {
    if (box.matches(":popover-open")) box.hidePopover();
    box.showPopover();
  }
  setTimeout(() => {
    item.classList.add("leaving");
    setTimeout(() => {
      item.remove();
      if (!box.children.length && box.matches?.(":popover-open")) box.hidePopover();
    }, 300);
  }, action ? 10000 : Math.max(kind === "err" ? 5000 : 2600, Math.min(1200 + text.length * 45, 8000)));
}

// ---------- Searchable combo box ----------
function masterSuggestions(getItems, text, current) {
  function rank(item, tokens, joined) {
    const name = normalize(item.name);
    if (!tokens.every((t) => name.includes(t))) return -1;
    if (name === joined) return 0;
    if (name.startsWith(joined)) return 1;
    if (name.split(" ").some((word) => word.startsWith(tokens[0]))) return 2;
    return 3;
  }

  const joined = normalize(text);
  const tokens = joined ? joined.split(" ") : [];
  const scored = [];
  for (const item of getItems()) {
    const score = tokens.length ? rank(item, tokens, joined) : 3;
    if (score < 0) continue;
    if (!item.active && item.name !== current && tokens.join("").length < 2) continue;
    scored.push({ item, score: score + (item.active ? 0 : 10) });
  }
  scored.sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name));
  return scored.map(({ item }) => ({ value: item.name, label: item.name, tag: item.active ? "" : "inactive", item }));
}

function createCombo(container, getItems, { onPick } = {}) {
  const input = container.querySelector("input");
  function canonical() {
    const exact = getItems().find((item) => item.name.toLowerCase() === input.value.trim().toLowerCase());
    if (exact) input.value = exact.name;
    return exact || null;
  }

  const { close } = attachSuggestions(input, (text) => masterSuggestions(getItems, text), {
    acceptOnTab: () => !canonical(),
    onPick: ({ item }, source) => {
      input.classList.remove("invalid");
      onPick?.(item, source !== "Tab");
    },
  });
  input.addEventListener("focus", () => input.select());
  input.addEventListener("blur", canonical);

  return { input, canonical, close };
}

// ---------- Entry form ----------
const YES_NO_OPTIONS = [["No", "No"], ["Yes", "Yes"]];
document.querySelectorAll("[data-dropdown]").forEach((control) => {
  if (control.id === "repair") setupDropdown(control, YES_NO_OPTIONS, "No", { enterOpens: false });
  else setupDropdown(control);
});
const partyCombo = createCombo($("partyCombo"), () => state.masters.parties, {
  onPick: (_, advance) => { if (advance) focusNext("party"); },
});
const finishCombo = createCombo($("finishCombo"), () => state.masters.finishes, {
  onPick: (_, advance) => { if (advance) focusNext("finish"); },
});

function focusNext(currentId) {
  const index = ENTRY_FIELDS.indexOf(currentId);
  if (index < 0) return;
  if (index === ENTRY_FIELDS.length - 1) {
    $("entryForm").requestSubmit();
    return;
  }
  const next = $(ENTRY_FIELDS[index + 1]);
  next.focus();
  if (next.select) next.select();
}

for (const id of ENTRY_FIELDS) {
  if (id === "party" || id === "finish") continue;
  $(id).addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      focusNext(id);
    }
  });
}
for (const id of ["party", "finish"]) {
  $(id).addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.defaultPrevented) {
      event.preventDefault();
      if (id === "party") partyCombo.canonical(); else finishCombo.canonical();
      focusNext(id);
    }
  });
}

function nagOfForm() {
  return (intOrNull($("than").value) || 0) + (intOrNull($("tp").value) || 0);
}

function updateCalculated() {
  const than = intOrNull($("than").value) || 0;
  $("nag").value = num(nagOfForm());
  $("nett").value = num($("repair").value === "Yes" ? 0 : than);
  updateDispatchSummary();
}
["than", "tp", "repair", "twoPart"].forEach((id) => $(id).addEventListener("input", updateCalculated));

// R in LOT N. or D.N. marks a repair, which is not charged (the server's RepairMark): leaving the box with it sets REP.
// to Yes once, and REP. can still be set back to No. "change" (not every key) so a lot like RAJWADI is judged whole.
function hasRepairMark(text) {
  const letters = String(text || "").replace(/[^A-Za-z]/g, "").toUpperCase();
  return letters === "R" || letters === "REP" || letters === "REPAIR";
}
const formHasRepairMark = () => hasRepairMark($("lotNo").value) || hasRepairMark($("designNo").value);
let repairMarkSeen = false;
function syncRepairMark() {
  const marked = formHasRepairMark();
  if (marked && !repairMarkSeen && $("repair").value !== "Yes") {
    $("repair").value = "Yes";
    updateCalculated();
  }
  repairMarkSeen = marked;
}
["lotNo", "designNo"].forEach((id) => $(id).addEventListener("change", syncRepairMark));

function dispatchRow(data = {}) {
  const tr = el("tr");
  const qty = el("input", { type: "number", min: "1", class: "d-qty" });
  const gate = el("input", { type: "text", class: "d-gate" });
  const date = el("input", { type: "date", class: "d-date" });
  qty.value = data.qty ?? "";
  gate.value = data.gatePass ?? "";
  date.value = data.date ?? (data.dateText ? "" : todayIso());
  if (data.dateText) date.title = `Original text: ${data.dateText}`;
  qty.addEventListener("input", updateDispatchSummary);
  // Enter walks JAWAK NAG → GATE PASS NO → DATE, then saves like the last entry box does.
  qty.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); gate.focus(); gate.select(); } });
  gate.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); date.focus(); } });
  date.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); $("entryForm").requestSubmit(); } });
  const remove = el("button", { type: "button", class: "link", text: "Remove", title: "Remove this dispatch row", onclick: () => {
    tr.remove();
    ensureDispatchRow();
    renumberDispatches();
  } });
  const note = data.dateText ? el("span", { class: "muted", text: ` was "${data.dateText}" — enter the correct date` }) : "";
  tr.append(el("td", { class: "d-num" }), el("td", {}, [qty]), el("td", {}, [gate]), el("td", { class: "d-date-cell" }, [date, note]), el("td", {}, [remove]));
  $("dispatchRows").append(tr);
  renumberDispatches();
  return tr;
}

// The dispatch rows are always open for typing: there is always at least one row, and an empty row is not saved.
function ensureDispatchRow() {
  if (!$("dispatchRows").children.length) dispatchRow();
}

function fillDispatches(dispatches) {
  $("dispatchRows").replaceChildren();
  dispatches.forEach((d) => dispatchRow(d));
  dispatchRow();
}

function renumberDispatches() {
  [...$("dispatchRows").children].forEach((tr, i) => { tr.querySelector(".d-num").textContent = String(i + 1); });
  updateDispatchSummary();
}

function readDispatches() {
  return [...$("dispatchRows").children].map((tr) => ({
    qty: intOrNull(tr.querySelector(".d-qty").value),
    gatePass: tr.querySelector(".d-gate").value.trim(),
    date: tr.querySelector(".d-date").value || null,
  })).filter((d) => d.qty !== null || d.gatePass !== "");
}

function updateDispatchSummary() {
  const dispatched = readDispatches().reduce((sum, d) => sum + (Number.isInteger(d.qty) ? d.qty : 0), 0);
  const available = nagOfForm() + (intOrNull($("twoPart").value) || 0);
  const balance = available - dispatched;
  $("dispatchTotal").textContent = num(available);
  $("dispatchSent").textContent = num(dispatched);
  $("dispatchBalance").textContent = num(balance);
  const stat = $("dispatchBalanceStat");
  stat.classList.toggle("pending", balance > 0 && dispatched > 0);
  stat.classList.toggle("done", balance === 0 && available > 0);
  stat.classList.toggle("over", balance < 0);
}

$("addDispatch").addEventListener("click", (event) => {
  event.preventDefault();
  dispatchRow().querySelector(".d-qty").focus();
});

function readForm() {
  return {
    registerMonth: state.editing ? state.editing.registerMonth : monthOf($("entryDate").value),
    inwardNo: intOrNull($("inwardNo").value),
    entryDate: $("entryDate").value || null,
    party: $("party").value.trim(),
    designNo: $("designNo").value.trim(),
    lotNo: $("lotNo").value.trim(),
    repair: $("repair").value === "Yes",
    than: intOrNull($("than").value),
    tp: intOrNull($("tp").value),
    twoPart: intOrNull($("twoPart").value),
    finish: $("finish").value.trim(),
    shortThan: intOrNull($("shortThan").value),
    dispatches: readDispatches(),
  };
}

// Confirmations ("Saved", "Edit cancelled.") pop up as toasts; problems stay in the form beside what needs fixing.
function setMessage(text, kind) {
  const popup = text && kind !== "err";
  $("formMessage").textContent = popup ? "" : text;
  $("formMessage").className = `message ${popup ? "" : kind || ""}`;
  if (popup) toast(text, kind === "warn" ? "warn" : "ok");
}

function showWarnings(list) {
  $("entryWarnings").replaceChildren(...(list || []).map((w) => el("li", { text: w })));
}

async function syncEntryMonth(month) {
  state.entryMonth = month;
  $("formTitle").textContent = `New inward entry — ${formatMonth(month)} register`;
  try {
    const { next } = await api(`/api/next-inward?month=${encodeURIComponent(month)}`);
    if (!state.editing && state.entryMonth === month) $("inwardNo").value = next;
  } catch (error) {
    if (!state.editing && state.entryMonth === month) setMessage(error.message, "err");
  }
}

async function resetForm({ keepDate = true } = {}) {
  const typedDate = state.editing ? state.newEntryDate : $("entryDate").value;
  const date = keepDate && typedDate ? typedDate : todayIso();
  $("entryForm").reset();
  $("repair").value = "No";
  $("entryDate").value = date;
  fillDispatches([]);
  state.editing = null;
  $("entryForm").classList.remove("editing");
  $("cancelEdit").classList.add("hidden");
  $("deleteEntry").classList.add("hidden");
  $("saveButton").textContent = "Save entry (Enter)";
  document.querySelectorAll("#entryForm .invalid").forEach((n) => n.classList.remove("invalid"));
  showWarnings([]);
  updateCalculated();
  repairMarkSeen = false;
  await syncEntryMonth(monthOf(date));
}

function loadIntoForm(entry) {
  if (!state.editing) state.newEntryDate = $("entryDate").value;
  state.editing = entry;
  $("entryForm").classList.add("editing");
  $("formTitle").textContent = `Correcting INW. NO. ${entry.inwardNo} — ${entry.party} (${formatMonth(entry.registerMonth)} register${entry.carriedOver ? ", carryover" : ""})`;
  $("cancelEdit").classList.remove("hidden");
  $("deleteEntry").classList.remove("hidden");
  $("saveButton").textContent = "Save correction";
  $("inwardNo").value = entry.inwardNo;
  $("entryDate").value = entry.entryDate;
  $("party").value = entry.party;
  $("designNo").value = entry.designNo;
  $("lotNo").value = entry.lotNo;
  $("repair").value = entry.repair ? "Yes" : "No";
  $("than").value = entry.than;
  $("tp").value = entry.tp || "";
  $("finish").value = entry.finish;
  $("twoPart").value = entry.twoPart || "";
  $("shortThan").value = entry.shortThan ?? "";
  fillDispatches(entry.dispatches);
  updateCalculated();
  repairMarkSeen = formHasRepairMark();
  showWarnings(entry.billedIn ? [`Already billed (${entry.billedIn}). Changing this entry does not change that bill.`, ...entry.warnings] : entry.warnings);
  setMessage("", "");
  rememberReturn("entry", "entry");
  switchView("entry");
  $("party").focus();
}

async function cancelEditing() {
  await resetForm();
  setMessage("Edit cancelled.", "");
  await returnFrom("entry");
}

// The warnings shown under the form are toasted instead when finishing an entry takes the user back to another tab.
async function returnFromEntry(warnings) {
  if (!(await returnFrom("entry"))) return;
  showWarnings([]);
  for (const warning of warnings || []) toast(warning, "warn");
}

$("cancelEdit").addEventListener("click", cancelEditing);

// ---------- Deleting an entry and putting it back ----------
// A deleted entry is kept whole on the server, so it can be restored under the same id. The server refuses to delete an entry
// on a saved bill, and to restore one whose INW. NO. or slip is in use again or whose party or finish left the lists.
function slipText(entry) {
  return `INW. NO. ${entry.inwardNo} — ${entry.party} (${formatMonth(entry.registerMonth)} register)`;
}

function errorText(error) {
  return (error.errors || [error.message]).join(" ");
}

async function deleteEditingEntry() {
  const entry = state.editing;
  if (!entry) return;
  const ok = await showConfirm({
    title: "Delete this entry?",
    message: slipText(entry),
    detail: "It moves to Register → Deleted entries and can be restored from there, as long as nothing has taken its INW. NO. or slip.",
    confirmText: "Delete entry",
    cancelText: "Keep entry",
    tone: "danger",
  });
  if (!ok) return;
  $("deleteEntry").disabled = true;
  try {
    const result = await api(`/api/entries/${entry.id}`, { method: "DELETE" });
    state.entriesCache.clear();
    await resetForm();
    toast(`Deleted ✓ ${slipText(result.deleted)}`, "ok", { id: "undoDelete", label: "Undo", run: () => undoDelete(result.deleted.id) });
    showWarnings(result.notes);
    await Promise.all([refreshRecent(), refreshInfo()]);
    await returnFromEntry(result.notes);
  } catch (error) {
    await showAlert({ title: "Entry not deleted", message: errorText(error), tone: "danger" });
  } finally {
    $("deleteEntry").disabled = false;
  }
}

$("deleteEntry").addEventListener("click", deleteEditingEntry);

// Asks the server for the entry's restore check first, so a clash is shown before anything is changed.
async function undoDelete(id) {
  try {
    const item = (await api("/api/entries/deleted")).find((d) => d.id === id);
    if (!item) {
      setMessage("This entry is no longer among the deleted entries.", "err");
      return;
    }
    if (await restoreDeleted(item)) showWarnings([]);
  } catch (error) {
    setMessage(errorText(error), "err");
  }
}

// Returns the restored entry, or null when it was not restored.
async function restoreDeleted(item) {
  const check = item.restore;
  if (!check.allowed) {
    await showAlert({ title: "This entry cannot be restored", message: slipText(item), detail: check.clashes.join(" "), tone: "danger" });
    return null;
  }
  const ok = await showConfirm({
    title: "Restore this entry?",
    message: slipText(item),
    detail: check.warnings.length ? `Check first: ${check.warnings.join(" ")}` : "It goes back into the register as it was when it was deleted.",
    confirmText: "Restore entry",
    cancelText: "Cancel",
  });
  if (!ok) return null;
  try {
    const entry = await api(`/api/entries/deleted/${item.id}/restore`, { method: "POST" });
    state.entriesCache.clear();
    setMessage(`Restored ✓ ${slipText(entry)}`, "ok");
    await Promise.all([refreshRecent(), refreshInfo()]);
    if ($("view-register").classList.contains("active")) await renderRegister();
    return entry;
  } catch (error) {
    await showAlert({ title: "This entry cannot be restored", message: slipText(item), detail: errorText(error), tone: "danger" });
    return null;
  }
}

function deletedEntryItem(item) {
  const facts = [
    formatDate(item.entryDate),
    item.designNo ? `D.N. ${item.designNo}` : "",
    item.lotNo ? `LOT N. ${item.lotNo}` : "",
    `${num(item.than)} THAN`,
    item.finish,
    item.repair ? "Repair" : "",
    item.dispatches ? `${num(item.dispatches)} dispatch${item.dispatches === 1 ? "" : "es"}` : "",
    item.carriedOver ? "Carryover" : "",
    item.imported ? "From Excel" : "",
  ].filter(Boolean).join(" · ");
  const restore = el("button", {
    type: "button", class: "secondary small", text: "Restore",
    onclick: async () => {
      restore.disabled = true;
      if (await restoreDeleted(item)) await showDeletedEntries();
      else restore.disabled = !item.restore.allowed;
    },
  });
  if (!item.restore.allowed) {
    restore.disabled = true;
    restore.title = "Something now clashes with this entry; see the reasons below";
  }
  const notes = [
    ...item.restore.clashes.map((text) => el("li", { class: "clash", text })),
    ...item.restore.warnings.map((text) => el("li", { class: "warn", text })),
  ];
  return el("li", { class: "deleted-item", "data-id": String(item.id) }, [
    el("div", { class: "deleted-head" }, [
      el("div", {}, [
        el("b", { text: `INW. NO. ${item.inwardNo}` }), " — ", el("span", { class: "party-name", text: item.party }),
        el("span", { class: "muted", text: ` · ${formatMonth(item.registerMonth)} register` }),
      ]),
      restore,
    ]),
    el("div", { class: "deleted-facts", text: facts }),
    el("div", { class: "muted deleted-when", text: `Deleted ${formatDate(item.deletedAt.slice(0, 10))} ${item.deletedAt.slice(11, 16)}` }),
    notes.length ? el("ul", { class: "deleted-notes" }, notes) : "",
  ]);
}

async function showDeletedEntries() {
  const dialog = $("deletedDrawer");
  const items = await api("/api/entries/deleted");
  const close = el("button", { type: "button", class: "secondary", text: "Close", onclick: () => closeDrawer(dialog) });
  drawerForm($("deletedForm"), {
    title: "Deleted entries",
    subtitle: items.length ? `${num(items.length)} deleted` : "",
    body: [
      el("p", { class: "muted", text: "Entries deleted in the app stay here until they are restored. One can be restored while its INW. NO. and slip are still free." }),
      items.length ? el("ul", { class: "deleted-list" }, items.map(deletedEntryItem)) : el("p", { class: "deleted-empty", text: "No deleted entries." }),
    ],
    actions: [close],
    key: "deleted",
  });
  openDrawer(dialog, close);
}

$("openDeletedEntries").addEventListener("click", () => showDeletedEntries().catch(showFatal));

$("entryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  partyCombo.canonical();
  finishCombo.canonical();
  // Ctrl+S in LOT N. or D.N. saves before the box's change event.
  syncRepairMark();
  const payload = readForm();
  const local = [];
  if (Number.isNaN(payload.than) || Number.isNaN(payload.tp) || Number.isNaN(payload.twoPart) || Number.isNaN(payload.inwardNo)) {
    local.push("Numbers must be whole numbers.");
  }
  if (local.length) { setMessage(local.join(" "), "err"); return; }
  if (isAllZeroInput(payload) && state.editing?.status !== "allZero") {
    const ok = await showConfirm({
      title: "Save an all-zero entry?",
      message: "THAN, TP and TWO PART are all 0 and nothing is dispatched.",
      detail: ALL_ZERO_TIP,
      confirmText: "Save all-zero entry",
      cancelText: "Go back",
    });
    if (!ok) { $("than").focus(); return; }
  }

  $("saveButton").disabled = true;
  try {
    const wasEditing = state.editing;
    const saved = wasEditing
      ? await api(`/api/entries/${wasEditing.id}`, { method: "PUT", json: payload })
      : await api("/api/entries", { method: "POST", json: payload });
    state.entriesCache.clear();
    await resetForm();
    const what = saved.status === "allZero" ? "all zero (slip number only)" : `${num(saved.than)} THAN ${saved.finish}`;
    setMessage(`${wasEditing ? "Corrected" : "Saved"} ✓ INW. NO. ${saved.inwardNo} — ${saved.party}, ${what}`, "ok");
    showWarnings(saved.warnings);
    await Promise.all([refreshRecent(), refreshInfo()]);
    if (wasEditing) await returnFromEntry(saved.warnings);
    if ($("view-entry").classList.contains("active")) $("party").focus();
  } catch (error) {
    setMessage(error.errors ? error.errors.join(" ") : error.message, "err");
    highlightInvalid(error.errors || []);
  } finally {
    $("saveButton").disabled = false;
  }
});

function highlightInvalid(errors) {
  const text = errors.join(" ").toLowerCase();
  const map = { inwardNo: "inward", entryDate: "valid date", party: "party", finish: "finish", than: "than" };
  for (const [id, word] of Object.entries(map)) $(id).classList.toggle("invalid", text.includes(word));
}

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if ($("view-entry").classList.contains("active")) $("entryForm").requestSubmit();
  } else if (event.key === "Escape" && state.editing && $("view-entry").classList.contains("active")) {
    cancelEditing();
  }
});

// ---------- Register-style tables ----------
// A slip kept only for its inward number (the server's AllZeroSlip): THAN, TP and TWO PART are 0 and nothing is dispatched.
const ALL_ZERO_TIP = "All zero: slip kept only for its number; its THAN were entered and billed in an earlier register";

function isAllZeroInput(payload) {
  return !payload.than && !payload.tp && !payload.twoPart && payload.dispatches.length === 0;
}

const COLUMNS = [
  ["INW. NO.", (e) => e.inwardNo, "inward"],
  ["DATE", (e) => formatDate(e.entryDate)],
  ["PARTY", (e) => e.party, "left"],
  ["D.N.", (e) => e.designNo],
  ["LOT N.", (e) => e.lotNo],
  ["REP.", (e) => (e.repair ? "Yes" : "No"), (e) => (e.repair ? "rep-yes" : "rep-no")],
  ["THAN", (e) => num(e.than), "big"],
  ["TP", (e) => (e.tp ? num(e.tp) : "")],
  ["NAG", (e) => num(e.nag), "big"],
  ["FINISH", (e) => e.finish],
  ["NETT THAN", (e) => num(e.nettThan), "big"],
  ["BILL NO.", (e) => e.billedIn || "", "left bill-cell", (td, e) => fillBillNoCell(td, e)],
  ["TWO PART", (e) => (e.twoPart ? num(e.twoPart) : "")],
  ...[0, 1, 2].flatMap((i) => [
    [`JAWAK NAG ${i + 1}`, (e) => num(e.dispatches[i]?.qty ?? ""), "big"],
    [`GATE PASS NO ${i + 1}`, (e) => e.dispatches[i]?.gatePass ?? ""],
    [`DATE ${i + 1}`, (e) => (e.dispatches[i] ? (e.dispatches[i].date ? formatDate(e.dispatches[i].date) : e.dispatches[i].dateText || "") : "")],
  ]),
  ["MORE JAWAK", (e) => (e.dispatches.length > 3 ? e.dispatches.slice(3).map((d) => `${num(d.qty)}/${d.gatePass}`).join(", ") : "")],
  ["SHORT THAN", (e) => num(e.shortThan ?? "")],
  ["BALANCE", (e) => num(e.balance)],
  ["WARNINGS", (e) => e.warnings.join(" "), "left"],
];

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
let activeCellEditor = null;
let cellSaves = Promise.resolve();
let partyTableStale = false;

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

// "Added by the import of NOV.xlsm on 22/Nov/26 21:40" — the row's tooltip says what the latest import did to it.
function importNote(mark) {
  if (!mark) return "";
  const [day, time = ""] = mark.importedAt.split(" ");
  const when = `${formatDate(day)} ${time.slice(0, 5)}`.trim();
  if (mark.action === "added") return `Added by the import of ${mark.fileName} on ${when}`;
  return `Updated by the import of ${mark.fileName} (${formatMonth(mark.registerMonth)}) on ${when}${mark.changes ? `: ${mark.changes}` : ""}`;
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
  td.replaceChildren();
  const draft = spec?.dispatch !== undefined ? dispatchDraft(entry, spec.dispatch) : null;
  if (draft) {
    td.textContent = draftCellText(draft, spec.part);
    td.classList.add("cell-draft");
    td.title = DRAFT_TIP;
  } else if (render) render(td, entry);
  else td.textContent = String(value(entry));
  if (cellEditable(entry, index)) td.classList.add("editable");
}

function entryRow(entry) {
  const tr = el("tr", {}, COLUMNS.map(() => el("td")));
  fillEntryRow(tr, entry);
  tr.addEventListener("click", (event) => {
    const td = event.target.closest("td");
    if (!td || td.parentElement !== tr || td.classList.contains("cell-editing")) return;
    // Let a cell that is still saving finish first, so the form opens with its new value.
    if (td.cellIndex === 0) cellSaves.then(() => loadIntoForm(rowEntry.get(tr)));
    else if (td.classList.contains("bill-cell")) td.classList.toggle("expanded");
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
  const editor = { td, tr, spec, input, original, busy: false, closed: false };
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
  document.querySelectorAll(`tr[data-entry-id="${entry.id}"]`).forEach((tr) => fillEntryRow(tr, rowEntry.get(tr)));
}

// Leaving a half-typed dispatch (no quantity or no gate pass yet) drops it instead of saving something incomplete.
function discardDraftsExcept(entry, spec) {
  for (const [id, draft] of [...dispatchDrafts]) {
    if (entry && id === entry.id && spec?.dispatch === draft.index) continue;
    dispatchDrafts.delete(id);
    document.querySelectorAll(`tr[data-entry-id="${id}"]`).forEach((tr) => fillEntryRow(tr, rowEntry.get(tr)));
    toast("Dispatch not saved: it needs both JAWAK NAG and GATE PASS NO.", "err");
  }
}

// Once nothing is being edited: drop a half-typed dispatch and redraw Party-wise so its group totals catch up.
function afterCellEditing() {
  setTimeout(() => {
    if (activeCellEditor) return;
    discardDraftsExcept(null, null);
    if (partyTableStale) {
      partyTableStale = false;
      if ($("partyTable").tBodies.length) renderPartywise().catch(showFatal);
    }
  }, 250);
}

function moveCellEditor(editor, move) {
  if (!move) return;
  const { tr, td } = editor;
  if (!tr.isConnected) return;
  let target = null;
  if (move.rows) {
    const rows = [...tr.parentElement.rows].filter((row) => rowEntry.has(row) && !row.hidden);
    target = rows[rows.indexOf(tr) + move.rows]?.cells[td.cellIndex] || null;
  } else {
    for (let i = td.cellIndex + move.cols; i > 0 && i < tr.cells.length; i += move.cols) {
      if (cellEditable(rowEntry.get(tr), i)) { target = tr.cells[i]; break; }
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
  document.querySelectorAll(`tr[data-entry-id="${saved.id}"]`).forEach((tr) => {
    const entry = rowEntry.get(tr);
    Object.assign(entry, saved);
    fillEntryRow(tr, entry);
  });
  if ($("registerTable").tBodies.length) renderTotals($("registerTotals"), registerShown);
  registerSearchPool.index = null;
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
  const text = spec.kind === "list" ? canonicalName(spec, input.value) : input.value.trim();
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

function totalsText(entries) {
  const sum = (f) => entries.reduce((s, e) => s + f(e), 0);
  return [
    ["Entries", entries.length], ["THAN", sum((e) => e.than)], ["TP", sum((e) => e.tp)], ["NAG", sum((e) => e.nag)],
    ["NETT THAN", sum((e) => e.nettThan)], ["TWO PART", sum((e) => e.twoPart)], ["JAWAK NAG", sum((e) => e.dispatched)],
    ["Balance", sum((e) => e.balance)], ["Warnings", entries.filter((e) => e.warnings.length).length],
  ];
}

function renderTotals(node, entries) {
  node.replaceChildren(...totalsText(entries).map(([k, v]) => {
    let tone = "";
    if (k === "Balance" && v > 0) tone = " stat-balance";
    else if ((k === "Warnings" && v > 0) || (k === "Balance" && v < 0)) tone = " stat-warn";
    return el("div", { class: `stat${tone}` }, [
      el("span", { class: "stat-label" }, [k, el("span", { class: "sr-only", text: ": " })]),
      el("b", { class: "stat-value", text: num(v) }),
    ]);
  }));
}

async function getEntries(month) {
  const key = month || "all";
  if (!state.entriesCache.has(key)) {
    state.entriesCache.set(key, await api(`/api/entries${month ? `?month=${encodeURIComponent(month)}` : ""}`));
  }
  return state.entriesCache.get(key);
}

async function refreshRecent() {
  const recent = await api("/api/entries/recent?limit=30");
  const table = $("recentTable");
  table.replaceChildren(headerRow(), el("tbody", {}, recent.map(entryRow)));
  setTableEmpty(table, recent.length ? "" : "Nothing has been entered in the app yet.");
}

async function fillMonthSelect(select, includeAll) {
  const months = await api("/api/months");
  if (select.id === "registerViewMonth") registerPeriodFilter.fill(months);
  else if (select.id === "partyViewMonth") partyPeriodFilter.fill(months);
  else fillMonthOptions(select, months, includeAll);
}

function fillMonthOptions(select, months, includeAll) {
  const previous = select.value;
  const options = months.map((m) => [m.month, `${formatMonth(m.month)}${m.entries === undefined ? "" : ` (${num(m.entries)})`}`]);
  if (includeAll) options.unshift(["", "All months"]);
  const currentMonth = todayIso().slice(0, 7);
  const selected = [previous, currentMonth].find((value) => options.some(([v]) => v === value));
  setDropdownOptions(select, options, selected);
}

function fillFinancialYearOptions(select, months, year, emptyLabel = "All financial years") {
  const current = financialYearOf(todayIso());
  const selected = year ?? current;
  const years = [...new Set([current, ...months.map((m) => financialYearOf(m.month)), ...(selected ? [selected] : [])])]
    .sort((a, b) => Number(b) - Number(a));
  setDropdownOptions(select, [
    ...(emptyLabel ? [["", emptyLabel]] : []),
    ...years.map((value) => [value, formatFinancialYear(value)]),
  ], selected);
  return selected;
}

function financialYearMonthFilter(yearSelect, monthSelect, onChange) {
  let year = null;
  let months = [];
  const fillMonths = () => {
    const scoped = months.filter((m) => !year || financialYearOf(m.month) === year);
    if (!scoped.some((m) => m.month === monthSelect.value)) monthSelect.value = "";
    fillMonthOptions(monthSelect, scoped, true);
  };
  yearSelect.addEventListener("change", () => {
    year = yearSelect.value;
    fillMonths();
    Promise.resolve(onChange()).catch(showFatal);
  });
  return {
    get year() { return year; },
    matches: (month) => !year || financialYearOf(month) === year,
    fill: (available) => {
      months = available;
      year = fillFinancialYearOptions(yearSelect, months, year);
      fillMonths();
    },
    // Picks one month (and its financial year), as when the import report opens the Register.
    show: (available, month) => {
      months = available;
      year = fillFinancialYearOptions(yearSelect, months, financialYearOf(month));
      fillMonths();
      monthSelect.value = month;
    },
  };
}

// Date-entry screens need one concrete month, not an "All months" choice.
function financialYearMonthInput(yearSelect, monthInput, onChange, { automatic = false } = {}) {
  let months = [];
  const sync = () => {
    const year = monthInput.value ? financialYearOf(monthInput.value) : automatic ? "" : null;
    fillFinancialYearOptions(yearSelect, months, year, automatic ? "From workbook" : null);
    if (yearSelect.value) {
      monthInput.min = `${yearSelect.value}-04`;
      monthInput.max = `${Number(yearSelect.value) + 1}-03`;
    } else {
      monthInput.removeAttribute("min");
      monthInput.removeAttribute("max");
    }
  };
  yearSelect.addEventListener("change", () => {
    const year = yearSelect.value;
    if (!year) monthInput.value = "";
    else {
      const number = (monthInput.value || todayIso()).slice(5, 7);
      monthInput.value = `${Number(year) + (Number(number) < 4 ? 1 : 0)}-${number}`;
    }
    sync();
    Promise.resolve(onChange()).catch(showFatal);
  });
  monthInput.addEventListener("change", sync);
  return {
    sync,
    fill: (available) => { months = available; sync(); },
  };
}

const registerPeriodFilter = financialYearMonthFilter($("registerFinancialYear"), $("registerViewMonth"), renderRegister);
const partyPeriodFilter = financialYearMonthFilter($("partyFinancialYear"), $("partyViewMonth"), () => renderPartywise({ reuse: true }));

// ---------- Row filters (the colour chips double as the legend) ----------
// Inclusions within a group are ORed; different groups are ANDed. Exclusions always veto a match.
const ROW_FILTERS = [
  { caption: "Dispatch", help: "Include any dispatch states to show, or exclude states to hide", filters: [
    { key: "pending", label: "Nothing", swatch: true, tip: "Nothing dispatched yet", test: (e) => e.status === "pending" },
    { key: "partial", label: "Partly", swatch: true, tip: "Partly dispatched: some still to send", test: (e) => e.status === "partial" },
    { key: "done", label: "Completed", swatch: true, tip: "Completed: nothing left to dispatch", test: (e) => e.status === "done" },
    { key: "over", label: "Over", swatch: true, tip: "Over-dispatched: more sent than NAG + TWO PART", test: (e) => e.status === "over" },
    { key: "allZero", label: "All zero", swatch: true, tip: ALL_ZERO_TIP, test: (e) => e.status === "allZero" },
  ] },
  { caption: "Bill", help: "Include any bill types to show, or exclude types to hide", filters: [
    { key: "billNo", label: "Bill no.", tip: "BILL NO. holds a saved bill number (click it to open that bill)", test: (e) => billKind(e) === "bill" },
    { key: "billBlank", label: "Blank", tip: "BILL NO. is empty and the party needs a bill", test: (e) => billKind(e) === "blank" },
    { key: "billNone", label: "No bill needed", tip: "The party is marked No bill needed in Masters, so BILL NO. stays empty", test: (e) => billKind(e) === "none" },
    { key: "billOther", label: "Other", tip: "BILL NO. holds something else, such as a note that it was billed outside the app", test: (e) => billKind(e) === "other" },
  ] },
  { caption: "Other", help: "Each included condition must match; any excluded condition hides the row", filters: [
    { key: "repair", label: "Repair", group: "repair", tip: "REP. is Yes: NETT THAN is 0 and it is never billed", test: (e) => e.repair },
    { key: "carried", label: "Carryover", group: "carried", swatch: true, tip: "Slip repeated from the previous month's register", test: (e) => e.carriedOver },
    { key: "balance", label: "Has balance", group: "balance", tip: "Still to dispatch: BALANCE is above 0, so some stock is still with you", test: (e) => e.balance > 0 },
    { key: "warning", label: "Has warning", group: "warning", swatch: true, tip: "Point at the row to read the warning", test: (e) => e.warnings.length > 0 },
  ] },
  { caption: "Last import", help: "What the latest import of each month's inward workbook did: include New or Updated to see those entries", filters: [
    { key: "importAdded", label: "New", tip: "Added as a new row by the latest import of its month's workbook", test: (e) => e.lastImport?.action === "added" },
    { key: "importUpdated", label: "Updated", tip: "Changed by the latest import of a month's workbook (a later month's carryover rows can change an earlier entry). Point at the row to see what changed", test: (e) => e.lastImport?.action === "updated" },
  ] },
];

const ROW_FILTER_MODES = [
  { key: "any", label: "Any", help: "Do not filter on this category" },
  { key: "include", label: "Include", help: "Show matching rows" },
  { key: "exclude", label: "Exclude", help: "Hide matching rows" },
];

function rowFilterMenu(id, label, trigger, onPick) {
  const menu = el("div", { id, popover: "auto", class: "filter-menu", role: "menu", "aria-label": `${label} filter options` });
  const options = ROW_FILTER_MODES.map(({ key, label: name, help }) => el("button", {
    type: "button", role: "menuitemradio", class: "filter-option", tabindex: "-1", "aria-checked": "false",
    onclick: () => { menu.hidePopover(); trigger.focus(); onPick(key); },
  }, [el("span", { class: "filter-option-label", text: name }), el("span", { class: "filter-option-help", text: help })]));
  menu.append(el("div", { class: "filter-menu-title", text: label, "aria-hidden": "true" }), ...options);
  const select = (mode) => options.forEach((option, i) => option.setAttribute("aria-checked", String(ROW_FILTER_MODES[i].key === mode)));
  select("any");
  menu.addEventListener("beforetoggle", (event) => {
    trigger.setAttribute("aria-expanded", String(event.newState === "open"));
    if (event.newState === "open") {
      const chip = trigger.parentElement.getBoundingClientRect();
      menu.style.setProperty("--menu-left", `${chip.left}px`);
      menu.style.setProperty("--menu-top", `${chip.bottom + 4}px`);
      menu.style.setProperty("--menu-bottom", `${window.innerHeight - chip.top + 4}px`);
      menu.classList.toggle("opens-up", window.innerHeight - chip.bottom < 190 && chip.top > window.innerHeight - chip.bottom);
    }
  });
  menu.addEventListener("toggle", (event) => {
    if (event.newState === "open" && menu.matches(":popover-open") && !options.includes(document.activeElement)) {
      options.find((option) => option.getAttribute("aria-checked") === "true").focus();
    }
  });
  menu.addEventListener("keydown", (event) => {
    const index = options.indexOf(document.activeElement);
    switch (event.key) {
      case "ArrowDown": options[(index + 1) % options.length].focus(); break;
      case "ArrowUp": options[(index <= 0 ? options.length : index) - 1].focus(); break;
      case "Home": options[0].focus(); break;
      case "End": options.at(-1).focus(); break;
      case "Escape": menu.hidePopover(); trigger.focus(); break;
      // Let the normal tab order continue from the split button, not from inside the menu.
      case "Tab": menu.hidePopover(); trigger.focus(); return;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
  });
  trigger.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (!menu.matches(":popover-open")) trigger.click();
    options[event.key === "ArrowDown" ? 0 : options.length - 1].focus();
  });
  return { menu, select };
}

function rowFilters(container, onChange, toggle) {
  const badge = toggle.querySelector(".filter-toggle-count");
  toggle.addEventListener("click", () => {
    const open = container.classList.toggle("hidden") === false;
    toggle.setAttribute("aria-expanded", String(open));
  });
  const modes = new Map();
  const chips = [];
  const setMode = (key, mode) => {
    if (mode === "any") modes.delete(key);
    else modes.set(key, mode);
  };
  const groups = ROW_FILTERS.map(({ caption, help, filters }) => el("div", { class: "filter-group" }, [
    el("span", { class: "filter-caption", text: caption, title: help }),
    el("div", { class: "filter-chips" }, filters.map((filter) => {
      const id = `${container.id}-${filter.key}`;
      const count = el("span", { id: `${id}-count`, class: "chip-count", title: "Category matches before exclusions" });
      const button = el("button", { type: "button", class: "filter-chip", "data-filter": filter.key, "aria-pressed": "false",
        "aria-describedby": count.id, "aria-label": `${filter.label}: Any`, title: `${filter.tip}. Click to include.` },
      [el("span", { class: "filter-minus", text: "⊖", "aria-hidden": "true" }),
        ...(filter.swatch ? [el("i", { class: `swatch ${filter.key}`, "aria-hidden": "true" })] : []),
        el("span", { class: "chip-label", text: filter.label }), count]);
      button.addEventListener("click", () => {
        setMode(filter.key, modes.has(filter.key) ? "any" : "include");
        onChange();
      });
      const trigger = el("button", {
        type: "button", class: "filter-trigger", popovertarget: `${id}-menu`, "aria-haspopup": "menu",
        "aria-controls": `${id}-menu`, "aria-expanded": "false", "aria-label": `${filter.label} filter options`,
      });
      const { menu, select } = rowFilterMenu(`${id}-menu`, filter.label, trigger, (mode) => {
        setMode(filter.key, mode);
        onChange();
      });
      const chip = el("div", { class: "filter-split", "data-mode": "any" }, [button, trigger, menu]);
      chips.push({ filter, group: filter.group || caption, chip, button, count, select });
      return chip;
    })),
  ]));
  const summary = el("div", { class: "filter-summary", role: "status", "aria-atomic": "true" });
  const clear = el("button", { type: "button", class: "filter-clear off", text: "Clear filters",
    title: "Clear all include and exclude filters",
    onclick: () => {
      modes.clear();
      onChange();
      chips[0].button.focus();
    } });
  container.replaceChildren(...groups, el("div", { class: "filter-actions" }, [summary, clear]));

  let summaryText = "";
  const apply = (entries) => {
    const included = new Map();
    const excluded = [];
    for (const { filter, group } of chips) {
      const mode = modes.get(filter.key);
      if (mode === "include") included.set(group, [...(included.get(group) || []), filter]);
      else if (mode === "exclude") excluded.push(filter);
    }
    const passesIncludes = (entry, skipGroup) => {
      for (const [group, filters] of included) if (group !== skipGroup && !filters.some((f) => f.test(entry))) return false;
      return true;
    };
    for (const { filter, group, chip, button, count, select } of chips) {
      const n = entries.reduce((acc, e) => acc + (filter.test(e) && passesIncludes(e, group) ? 1 : 0), 0);
      const mode = modes.get(filter.key) || "any";
      count.textContent = num(n);
      count.style.minWidth = `${num(entries.reduce((acc, e) => acc + (filter.test(e) ? 1 : 0), 0)).length}ch`;
      if (chip.dataset.mode !== mode) {
        chip.dataset.mode = mode;
        button.setAttribute("aria-pressed", String(mode !== "any"));
        button.setAttribute("aria-label", `${filter.label}: ${ROW_FILTER_MODES.find((option) => option.key === mode).label}`);
        button.title = `${filter.tip}. ${mode === "any" ? "Click to include." : "Click to clear this filter."}`;
        select(mode);
      }
      chip.dataset.zero = String(mode === "any" && n === 0);
    }
    const nextSummary = excluded.length ? `Excluding: ${excluded.map((filter) => filter.label).join(", ")}` : "";
    if (summaryText !== nextSummary) {
      summaryText = nextSummary;
      summary.textContent = nextSummary;
      summary.title = nextSummary;
    }
    clear.classList.toggle("off", !modes.size);
    badge.textContent = num(modes.size);
    badge.classList.toggle("hidden", !modes.size);
    return modes.size ? entries.filter((e) => passesIncludes(e) && !excluded.some((filter) => filter.test(e))) : entries;
  };
  // Shows only the rows matching these filters (with the filter bar open, so it is clear why).
  apply.only = (keys) => {
    modes.clear();
    keys.forEach((key) => modes.set(key, "include"));
    container.classList.remove("hidden");
    toggle.setAttribute("aria-expanded", "true");
  };
  return apply;
}

const registerRowFilter = rowFilters($("registerFilters"), () => renderRegister(), $("registerFiltersToggle"));
let registerRenderVersion = 0;
// The rows on screen, so a cell saved in place can update the totals without redrawing the table.
let registerShown = [];
const SEARCH_SUGGESTION_LIMIT = 5;
const SEARCH_SUGGESTION_FIELDS = [
  ["PARTY", (e) => [e.party]],
  ["D.N.", (e) => [e.designNo]],
  ["LOT N.", (e) => String(e.lotNo ?? "").split(",")],
  ["FINISH", (e) => [e.finish]],
  ["GATE PASS", (e) => e.dispatches.map((d) => d.gatePass)],
  ["INW. NO.", (e) => [e.inwardNo]],
];
// The entries the search runs over, with their suggestion index built on first use and kept until the period changes.
let registerSearchPool = { loaded: null, key: null, entries: [], index: null };
// A picked suggestion searches only its own column (LOT N. 264 is not INW. NO. 1264) until the text is changed.
let registerSearchPick = null;

function registerSearchMatcher(rawSearch) {
  const query = normalize(rawSearch);
  if (!query) return null;
  if (registerSearchPick?.text === rawSearch) {
    const valuesOf = SEARCH_SUGGESTION_FIELDS[registerSearchPick.order][1];
    return (e) => valuesOf(e).some((value) => normalize(value) === query);
  }
  const tokens = query.split(" ");
  return (e) => {
    const haystack = normalize([e.inwardNo, e.party, e.designNo, e.lotNo, e.finish, ...e.dispatches.map((d) => d.gatePass)].join(" "));
    return tokens.every((t) => haystack.includes(t));
  };
}

async function renderRegister() {
  const version = ++registerRenderVersion;
  const year = registerPeriodFilter.year;
  const loaded = await getEntries($("registerViewMonth").value);
  if (version !== registerRenderVersion) return;
  const entries = loaded.filter((e) => registerPeriodFilter.matches(e.registerMonth));
  const periodKey = `${$("registerViewMonth").value}|${year}`;
  if (registerSearchPool.loaded !== loaded || registerSearchPool.key !== periodKey) {
    registerSearchPool = { loaded, key: periodKey, entries, index: null };
  }
  const rawSearch = $("registerSearch").value;
  $("clearRegisterSearch").classList.toggle("hidden", !rawSearch);
  const searchMatches = registerSearchMatcher(rawSearch);
  const searched = searchMatches ? entries.filter(searchMatches) : entries;
  const shown = registerRowFilter(searched);
  registerShown = shown;
  const table = $("registerTable");
  table.replaceChildren(headerRow(), el("tbody", {}, shown.map(entryRow)));
  setTableEmpty(table, shown.length ? "" : entries.length ? "No entries match the search and filters."
    : $("registerViewMonth").value ? "No entries in this month." : year ? "No entries in this financial year." : "No entries yet.");
  const countEl = $("registerCount");
  countEl.textContent = `${num(shown.length)} of ${num(entries.length)} entries`;
  countEl.classList.toggle("filtered", shown.length !== entries.length);
  renderTotals($("registerTotals"), shown);
}

["registerSearch", "registerViewMonth"].forEach((id) => $(id).addEventListener("input", renderRegister));
$("registerSearch").addEventListener("input", () => { registerSearchPick = null; });
$("clearRegisterSearch").addEventListener("click", () => {
  $("registerSearch").value = "";
  registerSearchPick = null;
  renderRegister();
  $("registerSearch").focus();
});

// ---------- Register search suggestions ----------
// Typing offers the closest values from the entries in view, so every suggestion finds at least one row.

function registerSearchIndex() {
  if (registerSearchPool.index) return registerSearchPool.index;
  const byKey = new Map();
  for (const entry of registerSearchPool.entries) {
    const seen = new Set();
    SEARCH_SUGGESTION_FIELDS.forEach(([field, valuesOf], order) => {
      for (const raw of valuesOf(entry)) {
        const value = String(raw ?? "").trim();
        const norm = normalize(value);
        const key = `${order}|${norm}`;
        if (!norm || seen.has(key)) continue;
        seen.add(key);
        const found = byKey.get(key);
        if (found) {
          found.count++;
          continue;
        }
        const words = norm.split(" ");
        byKey.set(key, {
          value, field, order, norm, words, count: 1,
          compact: words.join(""), initials: words.length > 1 ? words.map((w) => w[0]).join("") : "",
        });
      }
    });
  }
  registerSearchPool.index = [...byKey.values()];
  return registerSearchPool.index;
}

// Optimal string alignment distance (a swap of two neighbouring letters is one typo); gives up past max.
function typoDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before = null;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (before && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, before[j - 2] + 1);
      current[j] = d;
      rowBest = Math.min(rowBest, d);
    }
    if (rowBest > max) return max + 1;
    before = previous;
    previous = current;
  }
  return previous[b.length];
}

// Typos between a typed word and the start of a value's word. Numbers must match exactly: 7653 is not "close" to 7654.
function wordTypos(token, word) {
  if (word.startsWith(token)) return 0;
  if (token.length < 4 || !/[a-z]/.test(token)) return Infinity;
  const max = token.length < 7 ? 1 : 2;
  let best = Infinity;
  for (let length = token.length - 1; length <= token.length + 1; length++) {
    if (length > word.length) break;
    best = Math.min(best, typoDistance(token, word.slice(0, length), max));
  }
  return best <= max ? best : Infinity;
}

// Lower is closer: whole value, start of the value, start of its words, initials, anywhere inside; -1 if none.
function suggestionRank({ norm, words, compact, initials }, query, tokens, compactQuery) {
  if (norm === query) return 0;
  if (norm.startsWith(query)) return 1;
  if (tokens.every((t) => words.some((w) => w.startsWith(t)))) return 2;
  if (compactQuery.length > 1 && initials.startsWith(compactQuery)) return 3;
  if (tokens.every((t) => norm.includes(t)) || compact.includes(compactQuery)) return 4;
  return -1;
}

function typoRank({ words }, tokens) {
  let typos = 0;
  for (const token of tokens) {
    let best = Infinity;
    for (const word of words) best = Math.min(best, wordTypos(token, word));
    if (best === Infinity) return -1;
    typos += best;
  }
  return 5 + typos;
}

function betterSuggestion(a, b) {
  return a.rank - b.rank || b.item.count - a.item.count || a.item.order - b.item.order
    || a.item.value.localeCompare(b.item.value, undefined, { numeric: true });
}

function registerSearchSuggestions(text) {
  const query = normalize(text);
  if (!query) return [];
  const tokens = query.split(" ");
  const compactQuery = tokens.join("");
  const index = registerSearchIndex();
  const best = [];
  const keep = (item, rank) => {
    const candidate = { item, rank };
    if (best.length === SEARCH_SUGGESTION_LIMIT && betterSuggestion(candidate, best[best.length - 1]) >= 0) return;
    let at = best.length;
    while (at > 0 && betterSuggestion(candidate, best[at - 1]) < 0) at--;
    best.splice(at, 0, candidate);
    if (best.length > SEARCH_SUGGESTION_LIMIT) best.pop();
  };
  const missed = [];
  for (const item of index) {
    const rank = suggestionRank(item, query, tokens, compactQuery);
    if (rank >= 0) keep(item, rank);
    else missed.push(item);
  }
  // Typo matches only fill places the exact matches leave free.
  if (best.length < SEARCH_SUGGESTION_LIMIT && /[a-z]/.test(query)) {
    for (const item of missed) {
      const rank = typoRank(item, tokens);
      if (rank >= 0) keep(item, rank);
    }
  }
  const t = window.t ?? ((text) => text);
  return best.map(({ item }) => ({
    value: item.value, label: item.value, order: item.order,
    hint: `${t(item.field)} · ${t(`${num(item.count)} ${item.count === 1 ? "entry" : "entries"}`)}`,
  }));
}

const registerSearchSuggest = attachSuggestions($("registerSearch"), registerSearchSuggestions, {
  requireNavigation: true,
  hideWhenEmpty: true,
  onPick: ({ value, order }) => {
    registerSearchPick = { text: value, order };
    renderRegister();
  },
});
// Enter keeps what was typed (the table already shows it), so it only puts the list away.
$("registerSearch").addEventListener("keydown", (event) => {
  if (event.key === "Enter") registerSearchSuggest.close();
});

const partyFilterCombo = createCombo($("partyFilterCombo"), () => state.masters.parties, {
  onPick: () => renderPartywise(),
});
$("partyFilter").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); renderPartywise(); } });
// Editing the text away from the party being shown (clearing it, or typing past its name) drops that filter at once.
$("partyFilter").addEventListener("input", () => {
  const typed = $("partyFilter").value.trim().toLowerCase();
  if (partywiseLoaded.party && typed !== partywiseLoaded.party.toLowerCase()) renderPartywise();
});
$("clearPartyFilter").addEventListener("click", () => { $("partyFilter").value = ""; renderPartywise(); });
$("partyViewMonth").addEventListener("input", renderPartywise);

const partyRowFilter = rowFilters($("partyFilters"), () => renderPartywise({ reuse: true }), $("partyFiltersToggle"));
let partywiseLoaded = { key: null, party: "", entries: [] };
let partyRenderVersion = 0;
const expandedParties = new Set();
const collapsedFinishes = new Set();
// Re-applies open/closed state to the rows on screen; renderPartywise points it at the current table.
let applyPartyVisibility = () => {};
let shownParties = [];
$("expandAllParties").addEventListener("click", () => {
  for (const name of shownParties) expandedParties.add(name);
  collapsedFinishes.clear();
  applyPartyVisibility();
});
$("collapseAllParties").addEventListener("click", () => {
  for (const name of shownParties) expandedParties.delete(name);
  applyPartyVisibility();
});

// Ticking a filter re-uses the rows already loaded; anything else reads them again.
async function renderPartywise(options) {
  const version = ++partyRenderVersion;
  const month = $("partyViewMonth").value;
  const party = partyFilterCombo.canonical();
  const query = party ? `&party=${encodeURIComponent(party.name)}` : "";
  const key = `${month}|${query}`;
  if (options?.reuse !== true || partywiseLoaded.key !== key) {
    const loaded = await api(`/api/partywise?month=${encodeURIComponent(month)}${query}`);
    if (version !== partyRenderVersion) return;
    partywiseLoaded = { key, party: party ? party.name : "", entries: loaded };
  }
  const all = partywiseLoaded.entries.filter((e) => partyPeriodFilter.matches(e.registerMonth));
  const entries = partyRowFilter(all);
  const body = el("tbody");
  // All-zero slips have no finish; they close each party in a group of their own instead of "(no finish)".
  const ALL_ZERO_GROUP = "\u0000allZero";
  const groupSummaryRow = (kind, name, list, toggle, allZero = false) => {
    const s = (f) => list.reduce((t, e) => t + f(e), 0);
    const balance = s((e) => e.balance);
    const balanceTone = balance > 0 ? " is-balance" : balance < 0 ? " is-over" : " is-clear";
    const metrics = [
      ["THAN", s((e) => e.than), ""],
      ["NETT THAN", s((e) => e.nettThan), ""],
      ["NAG", s((e) => e.nag), ""],
      ["JAWAK", s((e) => e.dispatched), ""],
      ["BALANCE", balance, balanceTone],
    ];
    const isParty = kind === "group";
    const nameClass = isParty ? "group-name party-name" : (name && !allZero ? "group-name finish-name" : "group-name group-name-empty");
    const countText = list.length === 1 ? "1 entry" : `${num(list.length)} entries`;
    const identity = el("span", { class: "group-identity" }, [
      el("span", { class: "group-chevron", "aria-hidden": "true" }),
      el("span", { class: "group-kicker", text: isParty ? "Party" : allZero ? "Slips" : "Finish" }),
      el("span", { class: nameClass, text: allZero ? "All zero" : name || "(no finish)", ...(allZero ? { title: ALL_ZERO_TIP } : {}) }),
      el("span", { class: "group-count", text: countText }),
    ]);
    const stats = el("span", { class: "group-stats" }, metrics.map(([label, value, tone]) =>
      el("span", { class: `group-stat${tone}` }, [
        el("span", { class: "group-stat-label", text: label }),
        el("b", { class: "group-stat-value", text: num(value) }),
      ])));
    return el("tr", { class: kind, onclick: toggle }, [
      el("td", { colspan: String(COLUMNS.length) }, [
        el("button", { type: "button", class: "group-bar", "aria-expanded": "false" }, [identity, stats]),
      ]),
    ]);
  };
  const parties = new Map();
  for (const entry of entries) {
    if (!parties.has(entry.party)) parties.set(entry.party, []);
    parties.get(entry.party).push(entry);
  }
  const visibilityUpdaters = [];
  for (const [partyName, partyEntries] of parties) {
    const finishGroups = [];
    const updateVisibility = () => {
      const partyExpanded = expandedParties.has(partyName);
      partyRow.querySelector("button").setAttribute("aria-expanded", String(partyExpanded));
      for (const { row, entryRows, finishKey } of finishGroups) {
        const finishExpanded = !collapsedFinishes.has(finishKey);
        row.hidden = !partyExpanded;
        row.querySelector("button").setAttribute("aria-expanded", String(finishExpanded));
        for (const entry of entryRows) entry.hidden = !partyExpanded || !finishExpanded;
      }
    };
    const partyRow = groupSummaryRow("group", partyName, partyEntries, () => {
      if (expandedParties.has(partyName)) expandedParties.delete(partyName);
      else expandedParties.add(partyName);
      updateVisibility();
    });
    body.append(partyRow);
    const finishes = new Map();
    for (const entry of partyEntries) {
      const group = entry.status === "allZero" ? ALL_ZERO_GROUP : entry.finish;
      if (!finishes.has(group)) finishes.set(group, []);
      finishes.get(group).push(entry);
    }
    for (const [finishName, finishEntries] of finishes) {
      const finishKey = JSON.stringify([partyName, finishName]);
      const allZero = finishName === ALL_ZERO_GROUP;
      const row = groupSummaryRow("subgroup", allZero ? "" : finishName, finishEntries, () => {
        if (collapsedFinishes.has(finishKey)) collapsedFinishes.delete(finishKey);
        else collapsedFinishes.add(finishKey);
        updateVisibility();
      }, allZero);
      const entryRows = finishEntries.map(entryRow);
      finishGroups.push({ row, entryRows, finishKey });
      body.append(row, ...entryRows);
    }
    updateVisibility();
    visibilityUpdaters.push(updateVisibility);
  }
  shownParties = [...parties.keys()];
  applyPartyVisibility = () => visibilityUpdaters.forEach((update) => update());
  $("partyTable").replaceChildren(headerRow(), body);
  setTableEmpty($("partyTable"), entries.length ? "" : all.length ? "No entries match the filters."
    : month ? "No entries in this month." : partyPeriodFilter.year ? "No entries in this financial year." : "No entries.");
  const partyCountEl = $("partyCount");
  partyCountEl.textContent = `${entries.length === all.length ? num(all.length) : `${num(entries.length)} of ${num(all.length)}`} entries${party ? ` for ${party.name}` : ""}`;
  partyCountEl.classList.toggle("filtered", entries.length !== all.length || Boolean(party));
  renderTotals($("partyTotals"), entries);
}

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

// ---------- App shell ----------
// Resolves once the tab has drawn its lists.
function switchView(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  $("menuSettings")?.classList.toggle("active", name === "settings");
  let loading = null;
  if (name === "register") loading = fillMonthSelect($("registerViewMonth"), true).then(renderRegister);
  if (name === "partywise") loading = fillMonthSelect($("partyViewMonth"), true).then(renderPartywise);
  if (name === "bills" && typeof showBills === "function") loading = showBills();
  if (name === "masters" && typeof showMasters === "function") loading = showMasters();
  if (name === "settings" && typeof renderFirmForm === "function") loading = renderFirmForm();
  if (name === "dashboard" && typeof showDashboard === "function") loading = showDashboard();
  if (name === "import") loading = refreshImportYears();
  refreshInfo().catch(() => {});
  return Promise.resolve(loading).catch(showFatal);
}
document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  returnTrips.length = 0;
  switchView(tab.dataset.view);
}));

// ---------- Going back after opening something from another tab ----------
// A bill opened from a BILL NO. link, or an entry opened from its INW. NO. on another tab, remembers the tab it came from
// (with its search, filters and scroll positions untouched); closing the bill or finishing the entry goes back there.
// Picking a tab by hand forgets the way back.
const returnTrips = [];

function viewScrollers(view) {
  return [$("main"), ...view.querySelectorAll(".table-wrap")];
}

// kind: what is being opened ("bill" or "entry"); target: the tab it opens on. Nothing is remembered within the same tab.
function rememberReturn(kind, target) {
  const view = document.querySelector(".view.active");
  const name = view?.id.replace(/^view-/, "");
  if (!name || name === target) return;
  returnTrips.push({ kind, view: name, scroll: viewScrollers(view).map((n) => [n.scrollTop, n.scrollLeft]) });
}

// Goes back to where the latest trip of this kind started; returns false when there is no trip to go back from.
async function returnFrom(kind) {
  if (returnTrips.at(-1)?.kind !== kind) return false;
  const trip = returnTrips.pop();
  await switchView(trip.view);
  const restore = () => viewScrollers($(`view-${trip.view}`)).forEach((n, i) => {
    const [top, left] = trip.scroll[i] || [0, 0];
    n.scrollTop = top;
    n.scrollLeft = left;
  });
  restore();
  requestAnimationFrame(restore);
  return true;
}

// ---------- Right-side menu (language, theme, settings) ----------
function openSideMenu() {
  const menu = $("sideMenu");
  if (!menu) return;
  if (openDrawer(menu, $("sideMenuClose"))) $("menuToggle")?.setAttribute("aria-expanded", "true");
}

function closeSideMenu() {
  const menu = $("sideMenu");
  if (menu?.open) closeDrawer(menu, true);
}

$("menuToggle")?.addEventListener("click", () => {
  if ($("sideMenu")?.open) closeSideMenu(); else openSideMenu();
});
$("sideMenuClose")?.addEventListener("click", closeSideMenu);
$("sideMenu")?.addEventListener("close", () => $("menuToggle")?.setAttribute("aria-expanded", "false"));
$("menuSettings")?.addEventListener("click", () => {
  closeSideMenu();
  switchView("settings");
});

const subviewHandlers = {};
function switchSubview(group, sub) {
  document.querySelectorAll(`.subtabs[data-group=${group}] .subtab`).forEach((b) => b.classList.toggle("active", b.dataset.sub === sub));
  document.querySelectorAll(`[id^="${group}-"].subview`).forEach((v) => v.classList.toggle("active", v.id === `${group}-${sub}`));
  const handler = subviewHandlers[`${group}-${sub}`];
  if (handler) Promise.resolve(handler()).catch(showFatal);
}
document.querySelectorAll(".subtabs").forEach((nav) => nav.querySelectorAll(".subtab").forEach((b) =>
  b.addEventListener("click", () => switchSubview(nav.dataset.group, b.dataset.sub))));

$("entryDate").addEventListener("change", () => {
  if (state.editing) return;
  const month = monthOf($("entryDate").value);
  if (month !== state.entryMonth) syncEntryMonth(month);
});

async function loadMasters() {
  state.masters = await api("/api/masters");
}

const FOLDER_SOURCE = { nextToApp: "next to the app", documents: "in Documents", environment: "set by MPH_DATA_DIR" };

// Answers can land out of order on a slow computer: only the newest is shown, and an answer to a request sent before the
// user picked a language or theme does not put the old choice back.
let infoRequests = 0;
let displayChoices = 0;

async function refreshInfo() {
  const request = ++infoRequests;
  const choices = displayChoices;
  const info = await api("/api/info");
  if (request !== infoRequests) return info;
  state.info = info;
  $("appInfo").textContent = `Version ${info.version} · ${num(info.entries)} entries · Data folder (${FOLDER_SOURCE[info.dataFolderSource] || info.dataFolderSource}): ${info.dataFolder} · data file mph-data.db + config file mph-config.json`;
  if (choices === displayChoices) {
    applyTheme(info.theme);
    if (typeof applyLanguage === "function") applyLanguage(info.language);
  }
  applyFeatures(info);
  showNotices(info);
  return info;
}

// ---------- Language (kept in the config file; cached so the page opens in the right language) ----------
async function setLanguageChoice(next) {
  const normalized = next === "hi" ? "hi" : "en";
  displayChoices++;
  if (typeof applyLanguage === "function") applyLanguage(normalized);
  try {
    const settings = await api("/api/settings");
    const saved = await api("/api/settings", { method: "PUT", json: { display: { ...settings.display, language: normalized } } });
    if (typeof mastersState !== "undefined" && mastersState.settings) mastersState.settings.display = saved.display;
    if (typeof applyLanguage === "function") applyLanguage(saved.display.language);
  } catch (error) {
    setMessage(`Could not save the language choice: ${error.message}`, "err");
  }
}
document.querySelectorAll("#langSwitch [data-lang]").forEach((btn) =>
  btn.addEventListener("click", () => setLanguageChoice(btn.dataset.lang)));

// ---------- Theme (kept in the config file; cached so the page opens in the right colours) ----------
function applyTheme(theme) {
  const dark = theme === "dark";
  const value = dark ? "dark" : "light";
  document.documentElement.dataset.theme = value;
  try { localStorage.setItem("mph-theme", value); } catch { /* private mode */ }
  document.querySelectorAll("#themeSwitch [data-theme]").forEach((btn) => {
    const active = btn.dataset.theme === value;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const select = $("display-theme");
  if (select && select.value !== value) select.value = value;
  document.dispatchEvent(new CustomEvent("mph-theme"));
}

async function setThemeChoice(next) {
  const value = next === "dark" ? "dark" : "light";
  displayChoices++;
  applyTheme(value);
  try {
    const settings = await api("/api/settings");
    const saved = await api("/api/settings", { method: "PUT", json: { display: { ...settings.display, theme: value } } });
    if (typeof mastersState !== "undefined" && mastersState.settings) mastersState.settings.display = saved.display;
    applyTheme(saved.display.theme);
  } catch (error) {
    setMessage(`Could not save the dark mode choice: ${error.message}`, "err");
  }
}
document.querySelectorAll("#themeSwitch [data-theme]").forEach((btn) =>
  btn.addEventListener("click", () => setThemeChoice(btn.dataset.theme)));

// UI features can be hidden or unhidden in Settings.
function toggleViewFeature(view, show) {
  document.querySelector(`.tab[data-view="${view}"]`)?.classList.toggle("hidden", !show);
  if (!show && $(`view-${view}`)?.classList.contains("active")) switchView("entry");
}

function toggleMasterSubfeature(sub, show) {
  document.querySelector(`.subtabs[data-group="masters"] .subtab[data-sub="${sub}"]`)?.classList.toggle("hidden", !show);
  if (!show && $(`masters-${sub}`)?.classList.contains("active")) switchSubview("masters", "parties");
}

function applyFeatures(info) {
  toggleViewFeature("import", info.showExcelImport !== false);
  toggleViewFeature("partywise", info.showPartywise !== false);
  toggleViewFeature("bills", info.showBills !== false);
  toggleViewFeature("dashboard", info.showDashboard !== false);
  toggleMasterSubfeature("styles", info.showBillingStyles === true);
  toggleMasterSubfeature("colors", info.showColors !== false);
}

function showNotices(info) {
  const bar = $("noticeBar");
  const items = [...(info.configProblem ? [info.configProblem] : []), ...(info.notices || [])];
  const key = items.join("\n");
  let hidden = "";
  try { hidden = localStorage.getItem("mph-hidden-notices") || ""; } catch { /* private mode */ }
  if (!items.length || hidden === key) { bar.classList.add("hidden"); return; }
  const close = el("button", { type: "button", class: "secondary small", text: "Hide", onclick: () => {
    try { localStorage.setItem("mph-hidden-notices", key); } catch { /* private mode */ }
    bar.classList.add("hidden");
  } });
  bar.replaceChildren(el("div", {}, [el("b", { text: info.configProblem ? "The config file needs attention" : "Notes about the data folder" }),
    el("ul", {}, items.map((t) => el("li", { text: t })))]), close);
  bar.classList.toggle("err", !!info.configProblem);
  bar.classList.remove("hidden");
}

function showFatal(error) {
  setMessage(`Could not reach the app: ${error.message}. Close and reopen MPH Register.`, "err");
  console.warn(error);
}

async function start() {
  try {
    await Promise.all([refreshInfo(), loadMasters()]);
    $("importMonth").value = "";
    await resetForm({ keepDate: false });
    $("party").focus();
    await refreshRecent();
    requestAnimationFrame(() => document.documentElement.classList.add("ready"));
  } catch (error) {
    showFatal(error);
  }
}

start();
