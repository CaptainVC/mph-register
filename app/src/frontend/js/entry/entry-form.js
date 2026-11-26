"use strict";

// New entry form: moving field to field, calculated fields, dispatch rows, reading and filling the form.

// ---------- Entry form ----------
const YES_NO_OPTIONS = [["No", "No"], ["Yes", "Yes"]];
// Every screen's Month filter is the same multi-select tick list.
const MULTI_MONTH_IDS = ["registerViewMonth", "partyViewMonth", "aawakMonth", "savedMonth"];
document.querySelectorAll("[data-dropdown]").forEach((control) => {
  if (control.id === "repair") setupDropdown(control, YES_NO_OPTIONS, "No", { enterOpens: false });
  else if (MULTI_MONTH_IDS.includes(control.id)) setupDropdown(control, [], "", { multiple: true, summary: monthsSummary });
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
  // An entry whose workbook typed over NETT THAN (THAN 24, NETT THAN 23) keeps that difference when corrected.
  const less = state.editing?.nettLess || 0;
  $("nett").value = num($("repair").value === "Yes" ? 0 : Math.max(0, than - less));
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
  qty.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    // An empty JAWAK NAG takes what is left to send (shown greyed in the box).
    if (!qty.value && Number(qty.dataset.offer) > 0) {
      qty.value = qty.dataset.offer;
      updateDispatchSummary();
    }
    gate.focus();
    gate.select();
  });
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

function sendAllTip(qty) {
  return `Press Enter to send all ${num(qty)}`;
}

function updateDispatchSummary() {
  const dispatched = readDispatches().reduce((sum, d) => sum + (Number.isInteger(d.qty) ? d.qty : 0), 0);
  const available = nagOfForm() + (intOrNull($("twoPart").value) || 0);
  const balance = available - dispatched;
  $("dispatchTotal").textContent = num(available);
  $("dispatchSent").textContent = num(dispatched);
  $("dispatchBalance").textContent = num(balance);
  for (const box of $("dispatchRows").querySelectorAll(".d-qty")) {
    const offer = !box.value && balance > 0 ? balance : 0;
    box.dataset.offer = String(offer);
    box.placeholder = offer ? num(offer) : "";
    box.title = offer ? sendAllTip(offer) : "";
  }
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
  scheduleLinkPreview();
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
  scheduleLinkPreview();
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
