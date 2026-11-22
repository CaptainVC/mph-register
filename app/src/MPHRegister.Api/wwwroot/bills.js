"use strict";

const billsState = { party: null, candidates: null, drafts: [], numbers: [], toBill: [], invoices: [], openInvoice: null, revealInvoiceNo: null, importReport: null };
// Typing a date fires "change" per digit; only the newest answer may draw the lists.
const billRequests = { toBill: 0, candidates: 0, build: 0, invoices: 0, years: 0 };
const billPeriodInput = financialYearMonthInput($("billFinancialYear"), $("billMonth"), () => {
  applyMonthDates();
  return reloadBillPeriod();
});

// Party entries and bill counts are fetched ahead (and kept until the tab is opened again or a bill is saved) so that
// flipping through parties draws instantly from memory.
const billCache = { generation: 0, prefetch: 0, candidates: new Map(), ready: new Map(), counts: new Map(), countRequests: new Map() };
let billCountTimer = 0;
let makingBills = false;

const rupees = (n) => money(n);
const dotDate = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}` : "");
const DISPATCH_TEXT = { none: "Not sent", partial: "Part sent", full: "Sent" };

function monthBounds(month) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

// A month's bills are made from the entries of the 26th of the month before up to the 25th of the month, as in the Excel bill books.
// The bill itself still prints the whole calendar month.
function entryWindow(month) {
  const [y, m] = month.split("-").map(Number);
  const before = new Date(y, m - 2, 1);
  return { from: `${before.getFullYear()}-${String(before.getMonth() + 1).padStart(2, "0")}-26`, to: `${month}-25` };
}

// Confirmations pop up as toasts; warnings and problems stay in the layout beside what needs attention.
function setBillMessage(text, kind) {
  const popup = text && kind === "ok";
  $("billMessage").textContent = popup ? "" : text;
  $("billMessage").className = `message ${popup ? "" : kind || ""}`;
  if (popup) toast(text);
}

function clearBillCache() {
  billCache.generation++;
  billCache.prefetch++;
  billCache.candidates.clear();
  billCache.ready.clear();
  billCache.counts.clear();
  billCache.countRequests.clear();
}

async function showBills() {
  clearBillCache();
  if (!$("billMonth").value) {
    $("billMonth").value = todayIso().slice(0, 7);
    applyMonthDates();
  }
  await refreshBillYears();
  await refreshToBill();
  // Bills can be imported on the Import Excel tab, so an open Saved bills list is read again.
  if ($("bills-saved").classList.contains("active")) await refreshInvoices();
}

async function refreshBillYears() {
  const ticket = ++billRequests.years;
  const [months, invoices] = await Promise.all([api("/api/months"), api("/api/invoices")]);
  if (ticket !== billRequests.years) return;
  billPeriodInput.fill([...months, ...invoices.map((i) => ({ month: i.billMonth }))]);
}

function applyMonthDates() {
  if (!$("billMonth").value) return;
  const month = $("billMonth").value;
  const span = entryWindow(month);
  $("billDate").value = monthBounds(month).to;
  $("periodFrom").value = span.from;
  $("periodTo").value = span.to;
  billPeriodInput.sync();
}

// Bills list only the entries whose inward date is inside the bill period.
function periodQuery() {
  return `from=${encodeURIComponent($("periodFrom").value)}&to=${encodeURIComponent($("periodTo").value)}`;
}

function periodText() {
  return `${formatDate($("periodFrom").value)} to ${formatDate($("periodTo").value)}`;
}

async function reloadBillPeriod() {
  if (billsState.party) await loadCandidates(billsState.party, { force: true });
  else {
    clearBillCache();
    await refreshToBill();
  }
}

$("billMonth").addEventListener("change", () => {
  applyMonthDates();
  return reloadBillPeriod();
});
$("periodFrom").addEventListener("change", reloadBillPeriod);
$("periodTo").addEventListener("change", reloadBillPeriod);
$("billDate").addEventListener("change", () => {
  const hadDrafts = billsState.drafts.length > 0;
  clearDrafts();
  if (billsState.candidates) updateCandidateCount(false);
  if (hadDrafts) setBillMessage("Bill date changed. Make the bills again before saving.", "warn");
});

async function refreshToBill() {
  const ticket = ++billRequests.toBill;
  let parties;
  try {
    parties = await api(`/api/billing/parties?${periodQuery()}`);
  } catch (error) {
    if (ticket !== billRequests.toBill) return;
    billsState.toBill = [];
    $("toBillCount").textContent = "";
    $("toBillList").replaceChildren(el("li", { class: "muted", text: error.message }));
    return;
  }
  if (ticket !== billRequests.toBill) return;
  billsState.toBill = parties;
  billsState.toBillPeriod = periodQuery();
  renderToBillList();
  prefetchCandidates(parties);
}

function candidatesKey(party) {
  return `${party}|${periodQuery()}`;
}

function fetchCandidates(party) {
  const key = candidatesKey(party);
  if (!billCache.candidates.has(key)) {
    const generation = billCache.generation;
    const request = api(`/api/billing/candidates?party=${encodeURIComponent(party)}&${periodQuery()}`).then((data) => {
      if (generation === billCache.generation) billCache.ready.set(key, data);
      return data;
    }, (error) => {
      if (billCache.candidates.get(key) === request) billCache.candidates.delete(key);
      throw error;
    });
    billCache.candidates.set(key, request);
  }
  return billCache.candidates.get(key);
}

const billCountKey = (party, ids) => `${party}|${ids.join(",")}`;

function requestBillCount(party, ids) {
  const key = billCountKey(party, ids);
  if (billCache.counts.has(key)) return Promise.resolve(billCache.counts.get(key));
  if (!billCache.countRequests.has(key)) {
    const generation = billCache.generation;
    const request = api("/api/billing/count", { method: "POST", json: { party, entryIds: ids } }).then((count) => {
      if (generation === billCache.generation) billCache.counts.set(key, count);
      return count;
    }).finally(() => {
      if (billCache.countRequests.get(key) === request) billCache.countRequests.delete(key);
    });
    billCache.countRequests.set(key, request);
  }
  return billCache.countRequests.get(key);
}

async function prefetchCandidates(parties) {
  const ticket = ++billCache.prefetch;
  const queue = parties.map((p) => p.party);
  const worker = async () => {
    while (queue.length && ticket === billCache.prefetch) {
      try {
        const candidates = await fetchCandidates(queue.shift());
        const ids = candidates.entries.filter((e) => e.selected).map((e) => e.entryId);
        if (ids.length && ticket === billCache.prefetch) await requestBillCount(candidates.billParty, ids);
      } catch {
        // The party is loaded again, with its error shown, when it is chosen.
      }
    }
  };
  await Promise.all([worker(), worker()]);
}

function renderToBillList() {
  const query = normalize($("billParty").value);
  const parties = billsState.toBill.filter((p) => normalize(p.party).includes(query));
  $("toBillCount").textContent = query ? `${num(parties.length)} / ${num(billsState.toBill.length)}` : num(parties.length);
  $("toBillList").replaceChildren(...parties.map((p) => {
    const current = billsState.party === p.party;
    const pick = el("button", { type: "button", class: "party-choice", "aria-current": String(current) }, [
      el("span", { class: "pick-name", text: p.party }),
      el("span", { class: "pick-amount", text: `${num(p.nettThan)} THAN` }),
      el("span", { class: "pick-count", text: `${num(p.entries)} entries${p.notDispatched ? ` · ${num(p.notDispatched)} not sent` : ""}` }),
      ...(current ? [el("span", { class: "pick-selected", text: "Selected" })] : []),
    ]);
    pick.addEventListener("click", () => loadCandidates(p.party));
    return el("li", { class: current ? "current" : "" }, [pick]);
  }));
  if (!parties.length) $("toBillList").append(el("li", { class: "pick-empty", text: query ? "No party matches. Clear the search to see all parties." : `Nothing left to bill with an inward date from ${periodText()}.` }));
}

const billPartyCombo = createCombo($("billPartyCombo"), () => state.masters.parties, { onPick: (item) => loadCandidates(item.name) });
$("billParty").addEventListener("input", renderToBillList);
$("billParty").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    const picked = billPartyCombo.canonical();
    if (picked) loadCandidates(picked.name);
  }
});

// force reads everything again (after bills were saved or undone, or the party was edited).
async function loadCandidates(party, { force = false } = {}) {
  if (force) clearBillCache();
  billsState.party = party;
  const ticket = ++billRequests.candidates;
  setBillMessage("", "");
  billsState.candidates = null;
  clearDrafts();
  $("billParty").value = "";
  renderToBillList();
  let candidates = billCache.ready.get(candidatesKey(party));
  if (!candidates) {
    $("candidateHead").replaceChildren(el("div", { class: "bill-empty-state loading", role: "status" }, [
      el("h2", { text: "Loading entries..." }), el("p", { text: party, "data-no-i18n": "all" }),
    ]));
    $("candidateTools").classList.add("hidden");
    $("candidateTable").replaceChildren();
    setTableEmpty($("candidateTable"), "");
    $("billSelectedCount").textContent = "Loading entries...";
    $("billSelectedThan").textContent = "0 THAN";
    $("makeBills").disabled = true;
    $("candAll").checked = false;
    $("candAll").indeterminate = false;
    $("candAll").disabled = true;
    $("candNone").disabled = true;
  }
  try {
    candidates ??= await fetchCandidates(party);
  } catch (error) {
    if (ticket !== billRequests.candidates) return;
    billsState.candidates = null;
    $("candidateHead").replaceChildren(el("div", { class: "bill-empty-state error" }, [
      el("h2", { text: `Could not load ${party}` }),
      el("p", { text: "Check the message below, then choose the party again." }),
    ]));
    $("billSelectedCount").textContent = "No entries loaded";
    setBillMessage(error.message, "err");
    refreshToBill();
    return;
  }
  if (ticket !== billRequests.candidates) return;
  billsState.candidates = candidates;
  billsState.party = candidates.billParty;
  renderCandidates();
  if (force || billsState.toBillPeriod !== periodQuery()) refreshToBill();
}

function renderCandidates() {
  const c = billsState.candidates;
  const hasDiscount = c.discount !== null && c.discount !== undefined;
  const hasGstin = Boolean(c.gstin);
  const identity = el("div", { class: "bill-party-identity" }, [
    el("span", { class: "bill-party-label", text: "Entries for" }),
    el("h2", { text: c.billParty }),
    ...(!c.active ? [el("span", { class: "bill-party-status", text: "Inactive" })] : []),
  ]);
  const discount = el("div", { class: `bill-discount${hasDiscount ? "" : " missing"}` }, [
    el("span", { text: "Discount" }), el("strong", { text: hasDiscount ? `${num(c.discount)}%` : "Not set" }),
  ]);
  const details = el("details", { class: "bill-party-details" }, [
    el("summary", { text: "Party details" }),
    el("div", { class: hasGstin ? "bill-gstin" : "bill-gstin missing" }, [
      el("span", { text: "GSTIN" }), el("strong", { text: c.gstin || "Not set", "data-no-i18n": hasGstin ? "all" : "false" }),
    ]),
  ]);
  if (c.billBeforeDispatch) details.append(el("p", { class: "bill-party-status", text: "Bills can include unsent entries" }));
  const head = el("div", { class: "bill-party-header" }, [identity, discount, details]);
  if (c.noBillNeeded) head.append(el("div", { class: "bill-party-alert" }, [
    el("span", { text: "This party is marked No bill needed, so no bills are made for it." }),
    el("button", { type: "button", class: "secondary", text: "Change in Masters", onclick: () => fixBillParty(c.billParty) }),
  ]));
  else if (c.problems.length) head.append(el("div", { class: "bill-party-alert" }, [
    el("span", { text: `Check in Masters → Parties: ${c.problems.join(", ")}` }),
    el("button", { type: "button", class: "secondary", text: "Fix party details", onclick: () => fixBillParty(c.billParty) }),
  ]));
  $("candidateHead").replaceChildren(head);
  $("candidateTools").classList.remove("hidden");
  $("candidateCount").textContent = `${num(c.entries.length)} entries to bill`;
  $("candidateHint").textContent = c.billBeforeDispatch ? "Unsent entries are included. Untick any you do not want to bill." : "Sent entries are selected. Tick or untick to change the bill.";

  const extraColumns = new Set(["REG. MONTH", "BILL AS", "NAG", "JAWAK", "GATE PASS"]);
  const cols = ["INW. NO.", "REG. MONTH", "DATE", "D.N.", "LOT N.", "FINISH", "BILL AS", "RATE", "NETT THAN", "NAG", "JAWAK", "DISPATCH", "GATE PASS"];
  const thead = el("thead", {}, [el("tr", {}, [el("th", { text: "Select" }), ...cols.map((h) => el("th", { class: extraColumns.has(h) ? "bill-extra-column" : "", text: h }))])]);
  const body = el("tbody", {}, c.entries.map((e) => {
    const box = el("input", { type: "checkbox", class: "cand", "data-id": String(e.entryId), "aria-label": `Select inward entry ${e.inwardNo}` });
    box.checked = e.selected;
    const tr = el("tr", { class: e.dispatchState === "none" ? "pending" : e.dispatchState === "partial" ? "partial" : "" }, [
      el("td", {}, [box]), el("td", { class: "inward", text: String(e.inwardNo) }), el("td", { class: "bill-extra-column", text: formatMonth(e.registerMonth) }),
      el("td", { text: formatDate(e.entryDate) }),
      el("td", { text: e.designNo }), el("td", { text: e.lotNo }), el("td", {}, [
        el("span", { text: e.finish }),
        ...(e.billFinish !== e.finish ? [el("span", { class: "bill-finish-note", text: `Bill as ${e.billFinish}` })] : []),
      ]),
      el("td", { class: `bill-extra-column${e.billFinish !== e.finish ? " changed" : ""}`, text: e.billFinish }),
      el("td", { class: e.rate === null ? "bad" : "num", text: e.rate === null ? "no rate" : num(e.rate) }),
      el("td", { class: "big num", text: num(e.nettThan) }), el("td", { class: "bill-extra-column num", text: num(e.nag) }), el("td", { class: "bill-extra-column num", text: num(e.dispatched) }),
      el("td", {}, [el("span", { class: `bill-dispatch ${e.dispatchState}`, text: DISPATCH_TEXT[e.dispatchState] })]),
      el("td", { class: "bill-extra-column left", text: e.gatePasses }),
    ]);
    tr.addEventListener("click", (event) => { if (event.target !== box) { box.checked = !box.checked; updateCandidateCount(); } });
    box.addEventListener("input", updateCandidateCount);
    return tr;
  }));
  $("candidateTable").replaceChildren(thead, body);
  setTableEmpty($("candidateTable"), c.noBillNeeded ? "No bill needed for this party." : c.entries.length ? "" : `Nothing left to bill for this party with an inward date from ${periodText()}. Move "Period from" back to see older entries.`);
  updateCandidateCount();
}

async function fixBillParty(name) {
  let data;
  try {
    data = await loadFullMasters();
  } catch (error) {
    setBillMessage(error.message, "err");
    return;
  }
  const party = data.parties.find((p) => p.name === name);
  if (!party) {
    setBillMessage("Open Masters → Parties to fix this party.", "err");
    return;
  }
  openPartyForm(party);
  $("partyDrawer").addEventListener("close", () => {
    if (billsState.party === name) loadCandidates(name, { force: true });
  }, { once: true });
}

$("candAll").addEventListener("input", () => {
  document.querySelectorAll("#candidateTable .cand").forEach((box) => { box.checked = $("candAll").checked; });
  updateCandidateCount();
});
$("candNone").addEventListener("click", () => {
  document.querySelectorAll("#candidateTable .cand").forEach((box) => { box.checked = false; });
  updateCandidateCount();
});
$("billMoreColumns").addEventListener("click", () => {
  const expanded = $("billMoreColumns").getAttribute("aria-pressed") !== "true";
  $("billMoreColumns").setAttribute("aria-pressed", String(expanded));
  $("billMoreColumns").textContent = expanded ? "Fewer columns" : "More columns";
  $("candidateTable").classList.toggle("bill-show-extra", expanded);
});

function tickedIds() {
  return [...document.querySelectorAll("#candidateTable .cand")].filter((b) => b.checked).map((b) => Number(b.dataset.id));
}

const makeBillsText = (count) => (count === undefined ? "Make bills" : `Make ${num(count)} ${count === 1 ? "bill" : "bills"}`);

// The number of bills depends on how the ticked entries pack onto bills, so the server counts them; the label shows the
// number as soon as it is known (at once for the pre-ticked entries, which are counted ahead).
function showBillCount() {
  clearTimeout(billCountTimer);
  const c = billsState.candidates;
  if (makingBills) return;
  const ids = c ? tickedIds() : [];
  const count = ids.length ? billCache.counts.get(billCountKey(c.billParty, ids)) : undefined;
  $("makeBills").textContent = makeBillsText(count);
  if (count !== undefined || !ids.length) return;
  billCountTimer = setTimeout(async () => {
    try {
      await requestBillCount(c.billParty, ids);
    } catch {
      return;
    }
    if (billsState.candidates === c) showBillCount();
  }, 120);
}

function updateCandidateCount(resetDrafts = true) {
  if (resetDrafts) clearDrafts();
  const ids = new Set(tickedIds());
  const ticked = billsState.candidates.entries.filter((e) => ids.has(e.entryId));
  const than = ticked.reduce((s, e) => s + e.nettThan, 0);
  const notSent = ticked.filter((e) => e.dispatchState === "none").length;
  $("makeBills").disabled = ticked.length === 0;
  showBillCount();
  $("billSelectedCount").textContent = `${num(ticked.length)} of ${num(billsState.candidates.entries.length)} entries selected`;
  $("billSelectedThan").textContent = `${num(than)} THAN`;
  $("candAll").disabled = billsState.candidates.entries.length === 0;
  $("candAll").checked = ticked.length > 0 && ticked.length === billsState.candidates.entries.length;
  $("candAll").indeterminate = ticked.length > 0 && ticked.length < billsState.candidates.entries.length;
  $("candNone").disabled = ticked.length === 0;
  document.querySelectorAll("#candidateTable .cand").forEach((box) => box.closest("tr").classList.toggle("bill-row-selected", box.checked));
  setBillMessage(notSent ? `${num(notSent)} selected entr${notSent === 1 ? "y has" : "ies have"} not been dispatched yet.` : "", notSent ? "warn" : "");
}

$("makeBills").addEventListener("click", async () => {
  const c = billsState.candidates;
  const ticket = ++billRequests.build;
  const builtFor = tickedIds();
  const printed = monthBounds($("billMonth").value);
  makingBills = true;
  $("makeBills").disabled = true;
  $("makeBills").textContent = "Making bills...";
  try {
    const drafts = await api("/api/billing/build", { method: "POST", json: {
      party: c.billParty, month: $("billMonth").value, entryIds: tickedIds(),
      billDate: $("billDate").value, periodFrom: printed.from, periodTo: printed.to,
      entriesFrom: $("periodFrom").value, entriesTo: $("periodTo").value,
    } });
    if (ticket !== billRequests.build) return;
    billsState.drafts = drafts;
    billsState.numbers = [];
    billCache.counts.set(billCountKey(c.billParty, builtFor), drafts.length);
    renderDrafts();
    setBillMessage(`${num(billsState.drafts.length)} bill(s) ready to check. Nothing is saved until you press Save.`, "ok");
  } catch (error) {
    if (ticket !== billRequests.build) return;
    setBillMessage(error.message, "err");
  } finally {
    if (ticket === billRequests.build) {
      makingBills = false;
      $("makeBills").disabled = tickedIds().length === 0;
      showBillCount();
    }
  }
});

function showBillStage(stage) {
  $("billReview").classList.toggle("reviewing-bills", stage !== "entries");
  $("draftArea").classList.toggle("hidden", stage === "entries");
  $("billMakeAction").classList.toggle("hidden", stage !== "entries");
  $("draftActions").classList.toggle("hidden", stage === "entries");
  $("saveBills").classList.toggle("hidden", stage === "saved");
  $("discardBills").textContent = stage === "saved" ? "Make another bill" : "Back to entries";
}

function clearDrafts() {
  ++billRequests.build;
  billsState.drafts = [];
  billsState.numbers = [];
  $("draftArea").inert = false;
  $("saveBills").disabled = false;
  $("draftArea").replaceChildren();
  showBillStage("entries");
  makingBills = false;
  showBillCount();
}
$("discardBills").addEventListener("click", () => {
  const hadDrafts = billsState.drafts.length > 0;
  clearDrafts();
  if (billsState.candidates) updateCandidateCount(false);
  setBillMessage(hadDrafts ? "Back to entries. The draft bills were not saved." : "", "");
});

// ---------- Editable bill grid (drafts and saved bills) ----------
function billGrid(doc, onChange, { readOnly = false, moveControl } = {}) {
  const wrap = el("div", { class: "bill-card" });
  const table = el("table", { class: moveControl ? "bill-grid with-row-moves" : "bill-grid" });
  const totals = el("div", { class: "bill-totals" });
  const warnings = el("ul", { class: "warnings" });
  const calculatedCells = [];

  function cellInput(line, key, type = "text") {
    const input = el("input", { type, class: `g-${key}` });
    input.value = line[key] ?? "";
    input.disabled = readOnly;
    input.addEventListener("change", () => {
      line[key] = type === "number" ? (input.value === "" ? null : Number(input.value)) : input.value;
      onChange(false);
    });
    return input;
  }

  function renderRows() {
    calculatedCells.length = 0;
    const thead = el("thead", {}, [el("tr", {}, ["#", "G.P.N.", "D.N.", "LOT NO.", "FINISH", "THAN", "RATE", "Amount(Rs.)", ""].map((h) => el("th", { text: h })))]);
    const body = el("tbody");
    doc.lines.forEach((line, index) => {
      const tr = el("tr", { class: `k-${line.kind}` });
      const number = el("td", { class: "num", text: String(index + 1) });
      const tall = el("span", { class: "tall-tag" });
      number.append(tall);
      tr.append(number);
      let qty;
      let amount;
      if (line.kind === "blank") {
        tr.append(el("td", { colspan: "7", class: "blank-row", text: "" }));
      } else {
        tr.append(el("td", {}, [cellInput(line, "gpn")]), el("td", {}, [cellInput(line, "dn")]), el("td", {}, [cellInput(line, "lot")]));
        if (line.kind === "priced") {
          tr.append(el("td", {}, [cellInput(line, "finish")]));
          qty = cellInput(line, "qty", "number");
          amount = el("td", { class: "amount" });
          tr.append(el("td", {}, [qty]), el("td", {}, [cellInput(line, "rate", "number")]), amount);
        } else {
          tr.append(el("td", {}), el("td", {}, [cellInput(line, "qty", "number")]), el("td", {}), el("td", {}));
        }
      }
      const actions = el("td", { class: "row-actions" });
      if (!readOnly) {
        actions.append(
          el("button", { type: "button", class: "link", title: "Insert an empty row below", text: "+ row", onclick: () => { doc.lines.splice(index + 1, 0, { kind: "detail", gpn: "", dn: "", lot: "", finish: "", qty: null, rate: null, amount: null, autoSum: false, entryIds: [] }); onChange(); } }),
          el("button", { type: "button", class: "link remove", title: line.entryIds && line.entryIds.length ? "Remove this row — its entries become unbilled again" : "Remove this row", "aria-label": "Remove this row", text: "✕", onclick: () => { doc.lines.splice(index, 1); onChange(); } }),
        );
        const above = doc.lines[index - 1];
        if (line.kind === "detail" && above && above.kind === "detail") {
          actions.append(el("button", { type: "button", class: "link", title: "Combine with the row above (references and THAN are joined)", text: "merge ↑", onclick: () => { mergeUp(doc.lines, index); onChange(); } }));
        }
        if (line.kind !== "blank") {
          const kind = dropdownOf([["detail", "detail"], ["priced", "priced"], ["blank", "blank"]], line.kind, { "aria-label": "Row type" });
          kind.className = "kind-select";
          kind.addEventListener("change", () => { line.kind = kind.value; line.autoSum = false; onChange(); });
          actions.append(kind);
        }
        const move = moveControl?.(line, index);
        if (move) actions.append(move);
      }
      tr.append(actions);
      body.append(tr);
      calculatedCells.push({ tall, qty, amount });
    });
    const cols = el("colgroup", {}, ["num", "gpn", "dn", "lot", "finish", "qty", "rate", "amount", "actions"].map((c) => el("col", { class: `c-${c}` })));
    table.replaceChildren(cols, thead, body);
  }

  function renderCalculation() {
    doc.lines.forEach((line, index) => {
      const { tall, qty, amount } = calculatedCells[index];
      tall.textContent = line.rows > 1 ? `×${line.rows}` : "";
      tall.title = line.rows > 1 ? `The lot / D.N. text is long: this line prints on ${line.rows} rows in a smaller font.` : "";
      if (qty) {
        qty.disabled = readOnly || line.autoSum;
        qty.title = line.autoSum ? "Total of the lines above" : "";
        qty.parentElement.classList.toggle("sum", line.autoSum);
        if (line.autoSum) qty.value = line.qty ?? "";
        amount.classList.toggle("bad", line.amount == null);
        amount.textContent = line.amount == null ? "no rate" : rupees(line.amount);
      }
    });
    renderTotals();
  }

  function renderTotals() {
    const rows = [["Gross Total", rupees(doc.gross)], [`Less/Discount (${num(doc.discountPct)}%)`, rupees(doc.discount)], ["Net Taxable Amount", rupees(doc.taxable)]];
    if (doc.taxMode === "inter") rows.push([`IGST ${doc.igstRate}%`, rupees(doc.igst)]);
    else rows.push([`CGST ${doc.cgstRate}%`, rupees(doc.cgst)], [`SGST ${doc.sgstRate}%`, rupees(doc.sgst)]);
    rows.push(["Invoice Total", rupees(doc.total)]);
    const limit = doc.firm && doc.firm.invoiceLimit;
    totals.replaceChildren(
      el("table", {}, [el("tbody", {}, rows.map(([k, v], i) => el("tr", { class: i === rows.length - 1 ? "grand" : "" }, [el("th", { text: k }), el("td", { text: v })])))]),
      el("div", { class: "words", text: (doc.amountInWords || "").replace(/\s+/g, " ").trim() }),
      el("div", { class: "muted", text: `${num(doc.than)} THAN · ${num(doc.lines.filter((l) => l.kind !== "blank").length)} lines · ${num(doc.lines.reduce((s, l) => s + (l.rows || 1), 0))} of ${num(doc.firm ? doc.firm.rowsPerInvoice : 25)} printed rows${limit ? ` · limit ${rupees(limit)}` : ""}` }),
    );
    warnings.replaceChildren(...(doc.warnings || []).map((w) => el("li", { text: w })));
  }

  wrap.append(table, el("div", { class: "bill-foot" }, [totals, warnings]));
  renderRows();
  renderCalculation();
  return { node: wrap, renderCalculation, refresh: () => { renderRows(); renderCalculation(); } };
}

function mergeUp(lines, index) {
  const top = lines[index - 1];
  const row = lines[index];
  const join = (a, b) => [...new Set([a, b].flatMap((v) => String(v || "").split(",")).map((v) => v.trim()).filter(Boolean))].join(",");
  top.gpn = join(top.gpn, row.gpn);
  top.dn = join(top.dn, row.dn);
  top.lot = join(top.lot, row.lot);
  top.qty = (top.qty || 0) + (row.qty || 0);
  top.entryIds = [...(top.entryIds || []), ...(row.entryIds || [])];
  lines.splice(index, 1);
}

function detailSubtotal(lines, index) {
  const next = lines.findIndex((line, i) => i > index && line.kind !== "detail");
  return lines[next]?.kind === "priced" && lines[next].autoSum ? next : -1;
}

function hasRowContent(line) {
  return Boolean(line.gpn || line.dn || line.lot || line.entryIds?.length || (line.kind === "detail" && line.qty !== null));
}

function asBillDetail(line) {
  return { ...line, kind: "detail", finish: "", rate: null, amount: null, autoSum: false };
}

function appendMovedBillRow(target, row, pricing) {
  const lines = target.lines;
  const finishLabel = pricing?.finish || "";
  const finish = normalize(finishLabel);
  const rate = pricing?.rate ?? null;
  const sameFinish = (line) => line.kind === "priced" && normalize(line.finish) === finish;
  const match = finish ? lines.findLastIndex((line, i) => sameFinish(line) && line.rate === rate
    && line.autoSum === (lines[i - 1]?.kind === "detail")) : -1;
  if (match < 0 && finish && rowCapacity(target) - printedRows(target) === 1 && !lines.some(sameFinish)) {
    // Keep a standalone priced row separate from any unfinished detail rows at the end.
    const insertAt = lines.findLastIndex((line) => line.kind !== "detail") + 1;
    lines.splice(insertAt, 0, { ...row, kind: "priced", finish: finishLabel, rate, amount: null, autoSum: false });
    return;
  }

  const detail = asBillDetail(row);
  if (match >= 0 && lines[match].autoSum) {
    lines.splice(match, 0, detail);
    return;
  }

  const subtotal = { kind: "priced", gpn: "", dn: "", lot: "", finish: finishLabel, qty: null, rate, amount: null, autoSum: true, entryIds: [] };
  if (match >= 0) {
    const existing = lines[match];
    lines.splice(match, 1, asBillDetail(existing), detail, { ...subtotal, finish: existing.finish });
  } else {
    // Do not include unrelated trailing detail rows in the moved entry's subtotal.
    if (lines.at(-1)?.kind === "detail") lines.push({ ...subtotal, kind: "blank", finish: "", rate: null, autoSum: false });
    lines.push(detail, subtotal);
  }
}

function moveBillLine(source, target, index) {
  const row = source.lines[index];
  const from = [...source.lines];
  const to = { ...target, lines: [...target.lines] };
  let pricing = row;
  let removedBlock = row.kind === "priced";
  if (row.kind === "detail") {
    const end = detailSubtotal(from, index);
    pricing = from[end];
    const onlyDetail = end === index + 1 && from[index - 1]?.kind !== "detail";
    if (onlyDetail && hasRowContent(pricing)) {
      throw new Error("This subtotal has its own references. Clear them before moving its last detail row.");
    }
    if (onlyDetail) from.splice(end, 1);
    removedBlock = onlyDetail;
  }
  appendMovedBillRow(to, row, pricing);
  from.splice(index, 1);
  if (removedBlock) {
    // Drop only the separator left behind by a removed finish block, not rows with references.
    if (from[index]?.kind === "blank" && !hasRowContent(from[index]) && (!index || from[index - 1].kind === "blank")) from.splice(index, 1);
    else if (index === from.length && from.at(-1)?.kind === "blank" && !hasRowContent(from.at(-1))) from.pop();
  }
  if (!from.some((line) => line.kind === "priced")) {
    if (from.some(hasRowContent)) throw new Error("Give the remaining rows a rate or move them first before emptying this bill.");
    return [null, to];
  }
  return [{ ...source, lines: from }, to];
}

const printedRows = (doc) => doc.lines.reduce((sum, line) => sum + Math.max(1, line.rows || 1), 0);
const rowCapacity = (doc) => doc.firm?.rowsPerInvoice || 25;
const isFull = (doc) => printedRows(doc) >= rowCapacity(doc);

const computeBill = (doc, recipient) => api(`/api/billing/compute${recipient ? `?recipient=${encodeURIComponent(recipient)}` : ""}`, { method: "POST", json: doc });

function renderDrafts() {
  const area = $("draftArea");
  const drafts = billsState.drafts;
  const save = $("saveBills");
  const scrollTop = area.scrollTop;
  const recipients = billsState.candidates?.billRecipients || [];
  const calculations = new Map();
  const fullMarkers = new Set();

  async function moveRow(sourceIndex, targetIndex, rowIndex, control) {
    if (area.inert) return;
    area.inert = true;
    save.disabled = true;
    let focus = control;
    let keepScroll = true;
    let activeDrafts = drafts;
    try {
      await Promise.all(calculations.values());
      if (billsState.drafts !== drafts) return;
      const original = drafts[sourceIndex];
      const newBill = targetIndex === drafts.length;
      const destination = newBill ? { ...original, notes: "", lines: [], billSerial: null } : drafts[targetIndex];
      const [source, target] = moveBillLine(original, destination, rowIndex);
      const [freshSource, freshTarget] = await Promise.all([source ? computeBill(source) : null, computeBill(target)]);
      if (billsState.drafts !== drafts) return;
      // The server does not know the typed bill number, so carry it over to the recalculated bills.
      if (freshSource) freshSource.billSerial = original.billSerial ?? null;
      freshTarget.billSerial = destination.billSerial ?? null;
      if (printedRows(freshTarget) > rowCapacity(freshTarget)) {
        throw new Error(`Bill ${targetIndex + 1} is full (${rowCapacity(freshTarget)} printed rows). The row was not moved.`);
      }
      activeDrafts = drafts.map((doc, i) => i === sourceIndex ? freshSource : i === targetIndex ? freshTarget : doc).filter(Boolean);
      if (newBill) activeDrafts.push(freshTarget);
      billsState.drafts = activeDrafts;
      renderDrafts();
      const newTarget = !freshSource && sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      const card = area.querySelectorAll(".draft")[freshSource ? sourceIndex : newTarget];
      const moves = card.querySelectorAll(".move-bill-row");
      focus = (freshSource && moves[Math.min(rowIndex, moves.length - 1)]) || card.querySelector("h2");
      keepScroll = Boolean(freshSource);
      const moved = `Row moved to Bill ${newTarget + 1}.`;
      setBillMessage(freshSource ? moved : `${moved} The empty draft was removed.`, "ok");
    } catch (error) {
      if (billsState.drafts !== drafts) return;
      setBillMessage(error.message, "err");
    } finally {
      if (billsState.drafts === activeDrafts) {
        area.inert = false;
        save.disabled = false;
        focus.focus({ preventScroll: keepScroll });
      }
    }
  }

  async function changeRecipient(doc, select) {
    if (area.inert) return;
    const recipient = select.value;
    area.inert = true;
    save.disabled = true;
    try {
      await Promise.all(calculations.values());
      if (billsState.drafts !== drafts) return;
      const fresh = await computeBill(doc, recipient);
      if (billsState.drafts !== drafts) return;
      Object.assign(doc, fresh);
      renderDrafts();
      setBillMessage("Bill recipient updated.", "ok");
    } catch (error) {
      if (billsState.drafts !== drafts) return;
      select.value = doc.party;
      setBillMessage(error.message, "err");
    } finally {
      if (billsState.drafts === drafts) {
        area.inert = false;
        save.disabled = false;
        area.querySelectorAll(".draft-recipient")[drafts.indexOf(doc)]?.focus({ preventScroll: true });
      }
    }
  }

  const numberFields = [];
  let numberRevision = 0;
  let numberTimer = 0;

  // Shows the number each bill would get now: typed numbers as typed (flagged if they clash), the rest as the next free numbers.
  async function refreshNumbers() {
    clearTimeout(numberTimer);
    const ticket = ++numberRevision;
    try {
      const numbers = await api("/api/billing/numbers", { method: "POST", json: {
        bills: drafts.map((doc) => ({ billDate: doc.billDate, serial: doc.billSerial ?? null })),
      } });
      if (ticket !== numberRevision || billsState.drafts !== drafts) return;
      billsState.numbers = numbers;
      numbers.forEach((number, i) => numberFields[i]?.show(number));
    } catch (error) {
      if (ticket === numberRevision && billsState.drafts === drafts) setBillMessage(error.message, "err");
    }
  }

  function billNumberField(doc, i) {
    const input = el("input", { type: "number", min: "1", step: "1", inputmode: "numeric", id: `billNo${i}`, class: "bill-no-input" });
    input.setAttribute("aria-label", `Bill no. for Bill ${i + 1}`);
    const prefix = el("span", { class: "bill-no-prefix", "data-no-i18n": "all" });
    const problem = el("span", { class: "bill-no-problem", role: "alert" });
    if (doc.billSerial != null) input.value = doc.billSerial;
    input.addEventListener("input", () => {
      const text = input.value.trim();
      doc.billSerial = text === "" ? null : Number.isInteger(Number(text)) ? Number(text) : 0;
      clearTimeout(numberTimer);
      numberTimer = setTimeout(refreshNumbers, 250);
    });
    input.addEventListener("change", refreshNumbers);
    const node = el("div", { class: "bill-no-row" }, [
      el("label", { for: input.id, text: "Bill no." }), prefix, input,
      el("span", { class: "muted bill-no-hint", text: "You can change it. It cannot match a bill already saved." }), problem,
    ]);
    const show = ({ serial, invoiceNo, problem: why }) => {
      prefix.textContent = invoiceNo.slice(0, invoiceNo.length - String(serial).length);
      if (doc.billSerial == null && document.activeElement !== input) input.value = serial || "";
      input.classList.toggle("invalid", Boolean(why));
      input.setAttribute("aria-invalid", why ? "true" : "false");
      problem.textContent = why || "";
    };
    return { node, show };
  }

  area.replaceChildren();
  area.append(el("p", { class: "muted draft-move-hint", text: "Use Move… to send a row to another draft or start a new bill." }));
  drafts.forEach((doc, i) => {
    const title = el("h2", { tabindex: "-1" });
    const total = el("span");
    const recipient = recipients.length > 1 ? dropdownOf(recipients.map((name) => [name, name]), doc.party) : null;
    if (recipient) {
      recipient.className = "draft-recipient";
      recipient.setAttribute("aria-label", `Bill recipient for Bill ${i + 1}`);
      recipient.setAttribute("data-no-i18n", "all");
      recipient.addEventListener("change", () => changeRecipient(doc, recipient));
    }
    title.append(el("span", { text: `Bill ${i + 1} of ${drafts.length} — ` }), recipient || el("span", { text: doc.partyName }), total);
    const setTitle = () => { total.textContent = ` — ${rupees(doc.total)}`; };
    const targets = drafts.flatMap((_, j) => j === i ? [] : [j]);
    const moveControl = (row, index) => {
      const movable = row.kind === "detail" || (row.kind === "priced" && !row.autoSum && doc.lines[index - 1]?.kind !== "detail");
      if (!movable) return null;
      const select = dropdownOf([]);
      select.className = "move-bill-row";
      // A bill at its printed-row limit cannot take another row; refreshed after every recalculation and when the menu opens.
      const markFull = () => {
        setDropdownOptions(select, [["", "Move…"], ...targets.map((j) => {
          const full = isFull(drafts[j]);
          return [String(j), `Bill ${j + 1}${full ? " (full)" : ""}`, full];
        }), ["new", "New bill"]], select.value);
      };
      markFull();
      fullMarkers.add(markFull);
      select.setAttribute("aria-label", `Move row ${index + 1} from Bill ${i + 1}`);
      select.addEventListener("change", () => {
        const target = select.value;
        select.value = "";
        if (target !== "") moveRow(i, target === "new" ? drafts.length : Number(target), index, select);
      });
      return select;
    };
    let grid;
    let revision = 0;
    const recompute = async (redraw = true) => {
      const ticket = ++revision;
      const current = () => ticket === revision && billsState.drafts === drafts;
      if (redraw) grid.refresh();
      try {
        const { lines, ...fresh } = await computeBill(doc);
        if (!current()) return;
        Object.assign(doc, fresh);
        // Keep live inputs and move menus in place while a cell edit is being recalculated.
        const redrawMoves = lines.some((line, index) => line.autoSum !== doc.lines[index].autoSum);
        lines.forEach(({ qty, rows, amount, autoSum }, index) => Object.assign(doc.lines[index], { qty, rows, amount, autoSum }));
        setTitle();
        if (redrawMoves) grid.refresh();
        else grid.renderCalculation();
        for (const markFull of fullMarkers) markFull();
        if (!area.inert) setBillMessage("", "");
      } catch (error) {
        if (current() && !area.inert) setBillMessage(error.message, "err");
      }
    };
    grid = billGrid(doc, (redraw) => calculations.set(doc, recompute(redraw)), { moveControl });
    setTitle();
    const numberField = billNumberField(doc, i);
    numberFields.push(numberField);
    area.append(el("section", { class: "card draft" }, [title, numberField.node, grid.node]));
  });
  area.scrollTop = scrollTop;
  showBillStage(drafts.length ? "preview" : "entries");
  save.textContent = `Save and number ${drafts.length === 1 ? "this bill" : `these ${drafts.length} bills`}`;
  if (drafts.length) refreshNumbers();
}

$("saveBills").addEventListener("click", async () => {
  if ($("draftArea").inert) return;
  const party = billsState.candidates.billParty;
  const clash = billsState.numbers.find((number) => number.problem);
  if (clash) {
    setBillMessage(clash.problem, "err");
    return;
  }
  const navigation = [...document.querySelectorAll("#billMonth, #billDate, #periodFrom, #periodTo, #billParty, #toBillList button, #discardBills")].map((node) => [node, node.disabled]);
  navigation.forEach(([node]) => { node.disabled = true; });
  $("draftArea").inert = true;
  $("saveBills").disabled = true;
  try {
    const saved = await api("/api/billing/save", { method: "POST", json: {
      invoices: billsState.drafts, serials: billsState.drafts.map((doc) => doc.billSerial ?? null),
    } });
    const ids = saved.map((s) => s.id).join(",");
    state.entriesCache.clear();
    await loadCandidates(party, { force: true });
    setBillMessage(`Saved ✓ ${saved.map((s) => s.invoiceNo).join(", ")}`, "ok");
    $("draftArea").replaceChildren(el("div", { class: "report ok" }, [
      el("h2", { text: `Saved ${saved.length} bill(s)` }),
      el("ul", {}, saved.map((s) => el("li", { text: `${s.invoiceNo} — ${s.partyName} — ${num(s.than)} THAN — ${rupees(s.total)}` }))),
      el("button", { type: "button", id: "printSaved", text: "Print these bills", onclick: () => openPrint(ids) }),
      el("button", { type: "button", class: "secondary", id: "pdfSaved", text: "Save as PDF", onclick: (e) => downloadPdf(saved.map((s) => s.id), e.currentTarget) }),
      el("button", { type: "button", class: "secondary", id: "excelSaved", text: "Write to Excel…", onclick: () => openExcelExport(saved) }),
    ]));
    $("billSelectedCount").textContent = `Saved ${saved.length} bill(s)`;
    $("billSelectedThan").textContent = `${num(saved.reduce((sum, doc) => sum + doc.than, 0))} THAN`;
    showBillStage("saved");
  } catch (error) {
    setBillMessage(error.message, "err");
  } finally {
    navigation.forEach(([node, disabled]) => { node.disabled = disabled; });
    $("draftArea").inert = false;
    $("saveBills").disabled = false;
  }
});

function openPrint(ids) {
  window.open(`print.html?ids=${encodeURIComponent(ids)}`, "_blank", "noopener");
}

// Same page as Print, turned into a PDF by the app (needs Edge or Chrome installed).
async function downloadPdf(ids, button) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Making PDF…";
  try {
    const response = await fetch("/api/invoices/pdf", { method: "POST", headers: { "Content-Type": "application/json", "X-MPH-Request": "1" }, body: JSON.stringify({ ids }) });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.errors?.join(" ") || `PDF failed (${response.status}).`);
    }
    const name = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(response.headers.get("Content-Disposition") || "")?.[1];
    const url = URL.createObjectURL(await response.blob());
    const link = el("a", { href: url, download: name ? decodeURIComponent(name) : "Bills.pdf" });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    button.textContent = "PDF saved ✓";
  } catch (error) {
    button.textContent = label;
    await showAlert({
      title: "Could not save PDF",
      message: error.message,
      tone: "danger",
    });
  } finally {
    button.disabled = false;
  }
}

// ---------- Saved bills ----------
const savedPeriodFilter = financialYearMonthFilter($("savedFinancialYear"), $("savedMonth"), renderInvoices);

async function refreshInvoices() {
  const ticket = ++billRequests.invoices;
  const invoices = await api("/api/invoices");
  if (ticket !== billRequests.invoices) return;
  billsState.invoices = invoices;
  const months = [...new Set(billsState.invoices.map((i) => i.billMonth))].sort().reverse();
  savedPeriodFilter.fill(months.map((month) => ({ month })));
  renderInvoices();
  if (billsState.revealInvoiceNo) {
    const invoiceNo = billsState.revealInvoiceNo;
    billsState.revealInvoiceNo = null;
    await revealInvoice(invoiceNo);
  }
}

// Used by the BILL NO. links on the Register, Party-wise and New entry tabs: shows Saved bills and opens that bill once the
// list has loaded. Closing the bill goes back to the tab the link was on, as it was left.
function openSavedBill(invoiceNo) {
  billsState.revealInvoiceNo = invoiceNo;
  rememberReturn("bill", "bills");
  switchView("bills");
  switchSubview("bills", "saved");
}

async function revealInvoice(invoiceNo) {
  const invoice = billsState.invoices.find((i) => i.invoiceNo === invoiceNo);
  if (!invoice) {
    toast(`Bill ${invoiceNo} was not found in Saved bills`, "err");
    await returnFrom("bill");
    return;
  }
  // Widen the period and search so the bill is in the list.
  $("savedSearch").value = "";
  $("savedFinancialYear").value = financialYearOf(invoice.billMonth);
  $("savedFinancialYear").dispatchEvent(new Event("change"));
  $("savedMonth").value = invoice.billMonth;
  renderInvoices();
  try {
    await openInvoice(invoice.id);
  } finally {
    if (!$("invoiceDrawer").open) await returnFrom("bill");
  }
  document.querySelector(`#invoiceTable tbody tr[data-id="${invoice.id}"]`)?.scrollIntoView({ block: "center" });
}

function shownInvoices() {
  const month = $("savedMonth").value;
  const tokens = normalize($("savedSearch").value).split(" ").filter(Boolean);
  return billsState.invoices.filter((i) => savedPeriodFilter.matches(i.billMonth) && (!month || i.billMonth === month) && tokens.every((t) => normalize([i.invoiceNo, i.partyName, i.finishes, i.status].join(" ")).includes(t)));
}

function renderInvoices() {
  const list = shownInvoices();
  const head = el("thead", {}, [el("tr", {}, ["BILL NO.", "DATE", "PARTY", "FINISH", "THAN", "TOTAL", "ENTRIES", "STATUS", "FROM", "EXCEL"].map((h) => el("th", { text: h })))]);
  const body = el("tbody", {}, list.map((i) => {
    const tr = el("tr", { class: [i.status === "cancelled" ? "inactive" : "", i.id === billsState.openInvoice?.id ? "selected" : ""].join(" ").trim(), "data-id": String(i.id) }, [
      el("td", { class: "inward", text: i.invoiceNo }), el("td", { text: dotDate(i.billDate) }), el("td", { class: "left", text: i.partyName }),
      el("td", { text: i.finishes }), el("td", { class: "num", text: num(i.than) }), el("td", { class: "money", text: rupees(i.total) }),
      el("td", { class: "num", text: num(i.entries) }), el("td", { text: i.status === "cancelled" ? "CANCELLED" : "Saved" }),
      el("td", { text: i.source === "excel" ? "Excel" : "App" }),
      excelCell(i),
    ]);
    tr.addEventListener("click", () => openInvoice(i.id));
    return tr;
  }));
  $("invoiceTable").replaceChildren(head, body);
  setTableEmpty($("invoiceTable"), list.length ? "" : "No bills match the selected period and search.");
  const live = list.filter((i) => i.status !== "cancelled");
  $("savedCount").textContent = `${num(list.length)} bills`;
  $("savedTotals").replaceChildren(el("span", {}, ["Bills: ", el("b", { text: num(live.length) })]),
    el("span", {}, ["THAN: ", el("b", { text: num(live.reduce((s, i) => s + i.than, 0)) })]),
    el("span", {}, ["Total: ", el("b", { text: rupees(live.reduce((s, i) => s + i.total, 0)) })]));
}
// Whether a bill is in the Excel bill workbook: imported from it, or written into a copy of it (and changed since).
function excelCell(invoice) {
  if (invoice.source === "excel") return el("td", { class: "muted", text: "From Excel" });
  if (!invoice.exportedAt) return el("td", { text: "" });
  const title = `Written to ${invoice.exportedTo} on ${dotDate(invoice.exportedAt.slice(0, 10))}`;
  return invoice.changedSinceExport
    ? el("td", { class: "bad", title: `${title}; the bill was changed after that`, text: "Changed since written" })
    : el("td", { class: "good", title, text: `Written ${dotDate(invoice.exportedAt.slice(0, 10))}` });
}

function exportNote(id) {
  const invoice = billsState.invoices.find((i) => i.id === id);
  return invoice?.exportedAt ? ` It was written to ${invoice.exportedTo} on ${dotDate(invoice.exportedAt.slice(0, 10))}: remove it from that workbook by hand.` : "";
}

["savedMonth", "savedSearch"].forEach((id) => $(id).addEventListener("input", renderInvoices));
$("excelShown").addEventListener("click", () => openExcelExport(shownInvoices().filter((i) => i.status !== "cancelled")));
$("printShown").addEventListener("click", () => {
  const ids = shownInvoices().filter((i) => i.status !== "cancelled").map((i) => i.id);
  if (ids.length) openPrint(ids.join(","));
});

$("invoiceDrawer").addEventListener("close", () => returnFrom("bill"));

async function openInvoice(id) {
  const doc = await api(`/api/invoices/${id}`);
  billsState.openInvoice = doc;
  document.querySelectorAll("#invoiceTable tbody tr").forEach((tr) => tr.classList.toggle("selected", tr.dataset.id === String(id)));
  const form = $("invoiceEditor");
  const cancelled = doc.status === "cancelled";
  const billDate = el("input", { type: "date", id: "ie-date" });
  billDate.value = doc.billDate;
  const from = el("input", { type: "date", id: "ie-from" });
  from.value = doc.periodFrom;
  const to = el("input", { type: "date", id: "ie-to" });
  to.value = doc.periodTo;
  const notes = el("input", { type: "text", id: "ie-notes", placeholder: "Note (not printed)" });
  notes.value = doc.notes;
  const message = el("div", { class: "message", id: "ie-message", role: "status" });
  const say = (text, kind) => { message.textContent = text; message.className = `message ${kind || ""}`; };
  let refreshParty = false;
  const grid = billGrid(doc, async () => {
    try {
      Object.assign(doc, await api("/api/billing/compute", { method: "POST", json: doc }));
      say("Not saved yet.", "warn");
      form.dataset.dirty = "1";
    } catch (error) {
      say(error.message, "err");
    }
    grid.refresh();
  }, { readOnly: cancelled });
  const save = el("button", { type: "button", id: "ie-save", text: "Save changes" });
  save.disabled = cancelled;
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      const saved = await api(`/api/invoices/${id}`, { method: "PUT", json: { billDate: billDate.value, periodFrom: from.value, periodTo: to.value, notes: notes.value, refreshParty, lines: doc.lines } });
      markSaved(form);
      await refreshInvoices();
      await openInvoice(saved.id);
      toast(`Saved ${saved.invoiceNo}`);
      state.entriesCache.clear();
    } catch (error) {
      say(error.message, "err");
      save.disabled = false;
    }
  });
  const refresh = el("button", { type: "button", class: "secondary", text: "Use latest party details", onclick: () => {
    refreshParty = true;
    form.dataset.dirty = "1";
    say("Party name, address, GSTIN and discount will be refreshed from Masters when you save.", "warn");
  } });
  const print = el("button", { type: "button", class: "secondary", id: "ie-print", text: "Print", onclick: () => openPrint(String(id)) });
  const pdf = el("button", { type: "button", class: "secondary", id: "ie-pdf", text: "Save as PDF", onclick: (e) => downloadPdf([id], e.currentTarget) });
  const undo = el("button", {
    type: "button", class: "secondary", id: "ie-undo", text: "Undo save & release number",
    onclick: async () => {
      if (form.dataset.dirty === "1") {
        say("Save or discard your changes before undoing this bill's save.", "warn");
        return;
      }
      undo.disabled = true;
      try {
        if (!(await showConfirm({
          title: "Undo save & release number",
          message: `Undo save for bill ${doc.invoiceNo}?`,
          detail: `This makes the entries unbilled and releases the number for the next bill. Confirm only if this bill was never issued to a customer, reported for GST, or given an IRN. Undo history is kept.${exportNote(id)}`,
          confirmText: "Never issued - undo save",
          cancelText: "Keep bill",
          tone: "danger",
        }))) return;
        const result = await api(`/api/invoices/${id}/undo-save`, {
          method: "POST", json: { neverIssued: true, token: doc.undoSave.token },
        });
        markSaved(form);
        await closeDrawer($("invoiceDrawer"));
        billsState.openInvoice = null;
        state.entriesCache.clear();
        await refreshInvoices();
        await refreshBillYears();
        if (billsState.party) await loadCandidates(billsState.party, { force: true });
        else {
          clearBillCache();
          await refreshToBill();
        }
        setBillMessage(`Undid save for ${result.invoiceNo}. Next bill number: ${result.nextSerial}.`, "ok");
      } catch (error) {
        if ($("invoiceDrawer").open) say(error.message, "err");
        else await showAlert({
          title: "Could not refresh bills",
          message: error.message,
          detail: "The bill's save was undone. Reopen Bills to refresh the lists.",
          tone: "danger",
        });
      } finally {
        undo.disabled = !doc.undoSave?.allowed;
      }
    },
  });
  undo.disabled = !doc.undoSave?.allowed;
  const cancel = el("button", { type: "button", class: "danger", id: "ie-cancel", text: "Cancel this bill", onclick: async () => {
    if (!(await showConfirm({
      title: "Cancel this bill",
      message: `Cancel bill ${doc.invoiceNo}?`,
      detail: `The number stays used and the bill is marked CANCELLED. Its entries become unbilled so they can be billed again.${exportNote(id)}`,
      confirmText: "Cancel bill",
      cancelText: "Keep bill",
      tone: "danger",
    }))) return;
    try {
      await api(`/api/invoices/${id}/cancel`, { method: "POST" });
      markSaved(form);
      await refreshInvoices();
      await openInvoice(id);
      toast(`Cancelled ${doc.invoiceNo}`);
      state.entriesCache.clear();
    } catch (error) {
      say(error.message, "err");
    }
  } });
  const restore = el("button", { type: "button", id: "ie-restore", text: "Restore this bill", onclick: async () => {
    restore.disabled = true;
    try {
      if (!(await showConfirm({
        title: "Restore this bill",
        message: `Restore bill ${doc.invoiceNo}?`,
        detail: "The bill becomes saved again and its entries are marked billed on it.",
        confirmText: "Restore bill",
        cancelText: "Keep cancelled",
      }))) return;
      await api(`/api/invoices/${id}/restore`, { method: "POST" });
      state.entriesCache.clear();
      clearBillCache();
      await refreshInvoices();
      await openInvoice(id);
      toast(`Restored ${doc.invoiceNo}`);
    } catch (error) {
      say(error.message, "err");
    } finally {
      restore.disabled = !doc.restore?.allowed;
    }
  } });
  restore.disabled = !doc.restore?.allowed;
  const close = el("button", { type: "button", class: "ghost", text: "Close", onclick: () => closeDrawer($("invoiceDrawer")) });
  drawerForm(form, {
    key: `invoice:${id}`,
    title: `${doc.invoiceNo} — ${doc.partyName}${cancelled ? " — CANCELLED" : ""}`,
    subtitle: `${doc.address} ${doc.state} · GSTIN ${doc.gstin || "none"}${doc.source === "excel" ? " · imported from Excel" : ""}`,
    body: [
      section("Dates", [fieldsGrid([field("Bill date", billDate), field("Period from", from), field("Period to", to), field("Note (not printed)", notes)], 4)]),
      section("Lines", [grid.node]),
      ...(cancelled && doc.restore ? [el("p", {
        class: doc.restore.allowed ? "muted" : "message err", id: "ie-restore-help",
        text: doc.restore.reason || "Restoring puts the bill back as saved and marks its entries billed on it again.",
      })] : []),
      ...(!cancelled && doc.undoSave ? [el("p", {
        class: "muted", id: "ie-undo-help",
        text: doc.undoSave.reason || "Undo history is kept. Only the latest never-issued app bill can release its number.",
      })] : []),
    ],
    actions: cancelled ? [restore, print, pdf, close] : [save, refresh, print, pdf, ...(doc.undoSave ? [undo] : []), cancel, close],
  });
  form.querySelector(".drawer-foot").append(message);
  form.querySelector(".drawer-foot .form-message")?.remove();
  if (cancelled) form.querySelectorAll(".drawer-body input").forEach((i) => { i.disabled = true; });
  openDrawer($("invoiceDrawer"));
}

// ---------- Write saved bills into a copy of the Excel bill workbook ----------
// The workbook is uploaded, checked (where each bill goes and what is typed over its formulas), and a filled copy comes
// back as a download; the user's own file is never changed.
const EXCEL_STATUS = {
  write: ["Will be written", "good"],
  replace: ["Will be written over", "good"],
  same: ["Already in the workbook", "muted"],
  different: ["In the workbook, but different", "bad"],
  blocked: ["Cannot be written", "bad"],
};
const excelState = { bills: [], preview: null, replace: new Set(), ticket: 0 };

function openExcelExport(bills) {
  // Bills made in the app first: those imported from Excel are already in a workbook.
  const live = bills.filter((b) => b.status !== "cancelled");
  excelState.bills = [...live.filter((b) => b.source !== "excel"), ...live.filter((b) => b.source === "excel")];
  excelState.preview = null;
  excelState.replace = new Set();
  const form = $("excelForm");
  const file = el("input", { type: "file", id: "excelFile", accept: ".xlsm,.xlsx", "data-instant": "" });
  file.addEventListener("change", () => checkExcelWorkbook());
  const rows = excelState.bills.map((b) => {
    const tick = el("input", { type: "checkbox", "data-id": String(b.id), "data-instant": "", "aria-label": `Write ${b.invoiceNo}` });
    tick.checked = b.source !== "excel";
    tick.addEventListener("change", () => checkExcelWorkbook());
    return el("tr", {}, [el("td", {}, [tick]), el("td", { class: "inward", text: b.invoiceNo }), el("td", { text: dotDate(b.billDate) }),
      el("td", { class: "left", text: b.partyName }), el("td", { class: "money", text: rupees(b.total) }),
      el("td", { text: b.source === "excel" ? "Excel" : "App" }), excelCell(b)]);
  });
  const all = el("input", { type: "checkbox", id: "excelAll", "data-instant": "", "aria-label": "Tick every bill" });
  all.checked = rows.length > 0 && excelState.bills.every((b) => b.source !== "excel");
  all.addEventListener("change", () => {
    form.querySelectorAll("#excelBills tbody input[type=checkbox]").forEach((tick) => { tick.checked = all.checked; });
    checkExcelWorkbook();
  });
  const table = el("table", { class: "register", id: "excelBills" }, [
    el("thead", {}, [el("tr", {}, [el("th", {}, [all]), ...["BILL NO.", "DATE", "PARTY", "TOTAL", "FROM", "EXCEL"].map((h) => el("th", { text: h }))])]),
    el("tbody", {}, rows),
  ]);
  const check = el("button", { type: "button", class: "secondary", id: "excelCheck", text: "Check again", onclick: () => checkExcelWorkbook() });
  const download = el("button", { type: "button", id: "excelDownload", text: "Download filled workbook", onclick: (e) => downloadExcelWorkbook(e.currentTarget) });
  download.disabled = true;
  const close = el("button", { type: "button", class: "ghost", text: "Close", onclick: () => closeDrawer($("excelDrawer")) });
  drawerForm(form, {
    key: "excel",
    title: "Write bills to Excel",
    subtitle: "Into a copy of the month's bill workbook — your file is not changed",
    body: [
      section("1. Bills", [
        el("p", { class: "muted", text: "Only saved bills can be written. Each goes into the place of the workbook that has its bill no." }),
        el("div", { class: "table-wrap excel-bills" }, [table]),
      ], `${num(excelState.bills.length)} bills`),
      section("2. Bill workbook", [
        field("Bill workbook (.xlsm / .xlsx)", file, "This month's MPH BILL workbook. It is read, never changed: you download a filled copy."),
      ]),
      section("3. Check", [el("div", { id: "excelPreview" }, [el("p", { class: "muted", text: "Choose the bill workbook to see where each bill goes." })])]),
    ],
    actions: [download, check, close],
  });
  openDrawer($("excelDrawer"), file);
}

function excelRequest() {
  const ids = [...$("excelForm").querySelectorAll("#excelBills tbody input[type=checkbox]:checked")].map((tick) => Number(tick.dataset.id));
  return { ids, replace: ids.filter((id) => excelState.replace.has(id)) };
}

function excelForm(request) {
  const form = new FormData();
  form.append("file", $("excelFile").files[0]);
  form.append("request", JSON.stringify(request));
  return form;
}

function sayExcel(text, kind) {
  const message = $("excelForm").querySelector(".form-message");
  if (!message) return;
  message.textContent = text;
  message.className = `form-message message ${kind || ""}`;
}

async function checkExcelWorkbook() {
  const ticket = ++excelState.ticket;
  $("excelDownload").disabled = true;
  if (!$("excelFile")?.files[0]) return;
  const request = excelRequest();
  if (!request.ids.length) {
    $("excelPreview").replaceChildren(el("p", { class: "muted", text: "Tick the bills to write." }));
    return;
  }
  sayExcel("Checking the workbook…", "");
  try {
    const preview = await api("/api/billing/excel/preview", { method: "POST", body: excelForm(request) });
    if (ticket !== excelState.ticket) return;
    excelState.preview = preview;
    renderExcelPreview(preview);
    sayExcel(preview.toWrite ? `${num(preview.toWrite)} bill(s) will be written. Nothing is saved until you download the filled workbook.` : "Nothing to write yet.", preview.toWrite ? "ok" : "warn");
    $("excelDownload").disabled = preview.toWrite === 0;
  } catch (error) {
    if (ticket !== excelState.ticket) return;
    excelState.preview = null;
    $("excelPreview").replaceChildren(el("div", { class: "report err" }, [el("ul", {}, (error.errors || [error.message]).map((e) => el("li", { text: e })))]));
    sayExcel(error.message, "err");
  }
}

function renderExcelPreview(preview) {
  const children = [el("div", { class: "chips" }, [
    el("span", {}, ["Workbook: ", el("b", { text: preview.fileName })]),
    el("span", {}, ["Bill nos.: ", el("b", { text: preview.firstNumber ? `${preview.firstNumber} – ${preview.lastNumber}` : "none" })]),
    el("span", {}, ["Places filled: ", el("b", { text: `${num(preview.filledPlaces)} of ${num(preview.places)}` })]),
    el("span", {}, ["To write: ", el("b", { text: num(preview.toWrite) })]),
  ])];
  if (preview.problems.length) children.push(el("ul", { class: "message err", id: "excelProblems" }, preview.problems.map((p) => el("li", { text: p }))));
  if (preview.notes.length) children.push(el("ul", { class: "warnings", id: "excelNotes" }, preview.notes.map((n) => el("li", { text: n }))));
  const body = preview.bills.map((b) => {
    const [label, tone] = EXCEL_STATUS[b.status] || [b.status, ""];
    const details = [...b.problems, ...b.differences, ...b.typed];
    const result = el("td", { class: `${tone} left`, text: label });
    if (b.status === "different" || b.status === "replace") {
      const replace = el("input", { type: "checkbox", "data-instant": "", "data-replace": String(b.invoiceId) });
      replace.checked = excelState.replace.has(b.invoiceId);
      replace.addEventListener("change", () => {
        if (replace.checked) excelState.replace.add(b.invoiceId);
        else excelState.replace.delete(b.invoiceId);
        checkExcelWorkbook();
      });
      result.append(el("label", { class: "check" }, [replace, "Replace"]));
    }
    return el("tr", { "data-id": String(b.invoiceId) }, [
      el("td", { class: "inward", text: b.invoiceNo }), el("td", { class: "left", text: b.partyName }), el("td", { class: "money", text: rupees(b.total) }),
      el("td", { class: "left", text: b.place || "—" }), result,
      el("td", { class: "left excel-details" }, details.length ? [el("ul", {}, details.map((d) => el("li", { text: d })))] : []),
    ]);
  });
  children.push(el("div", { class: "table-wrap" }, [el("table", { class: "register", id: "excelResult" }, [
    el("thead", {}, [el("tr", {}, ["BILL NO.", "PARTY", "TOTAL", "PLACE", "RESULT", "TYPED / DIFFERENCES"].map((h) => el("th", { text: h })))]),
    el("tbody", {}, body),
  ])]));
  $("excelPreview").replaceChildren(...children);
}

async function downloadExcelWorkbook(button) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Writing…";
  try {
    const response = await fetch("/api/billing/excel/export", { method: "POST", headers: { "X-MPH-Request": "1" }, body: excelForm(excelRequest()) });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.errors?.join(" ") || `Writing the workbook failed (${response.status}).`);
    }
    const name = /filename\*=UTF-8''([^;]+)/i.exec(response.headers.get("Content-Disposition") || "")?.[1];
    const fileName = name ? decodeURIComponent(name) : $("excelFile").files[0].name;
    const url = URL.createObjectURL(await response.blob());
    const link = el("a", { href: url, download: fileName });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    const count = excelState.preview?.toWrite ?? 0;
    sayExcel(`Downloaded ${fileName} with ${num(count)} bill(s) written. Open it in Excel and check it, then replace your workbook with it (keep the old one until you have checked).`, "ok");
    toast(`Downloaded ${fileName}: ${num(count)} bill(s) written`);
    await refreshInvoices();
  } catch (error) {
    sayExcel(error.message, "err");
    toast(`Could not write the workbook: ${error.message}`, "err");
  } finally {
    button.textContent = label;
    button.disabled = !excelState.preview?.toWrite;
  }
}

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
