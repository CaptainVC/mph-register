"use strict";

// A party's entries ready to bill: ticking them and making draft bills.

let billCountTimer = 0;
let makingBills = false;

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
