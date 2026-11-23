"use strict";

// Bills → Make bills: state, the bill period and the list of parties with entries to bill.

const billsState = { party: null, candidates: null, drafts: [], numbers: [], toBill: [], invoices: [], openInvoice: null, selectedInvoices: new Set(), revealInvoiceNo: null, importReport: null };
// Typing a date fires "change" per digit; only the newest answer may draw the lists.
const billRequests = { toBill: 0, candidates: 0, build: 0, invoices: 0, years: 0 };
const billPeriodInput = financialYearMonthInput($("billFinancialYear"), $("billMonth"), () => {
  applyMonthDates();
  return reloadBillPeriod();
});

// Party entries and bill counts are fetched ahead (and kept until the tab is opened again or a bill is saved) so that
// flipping through parties draws instantly from memory.
const billCache = { generation: 0, prefetch: 0, candidates: new Map(), ready: new Map(), counts: new Map(), countRequests: new Map() };

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
