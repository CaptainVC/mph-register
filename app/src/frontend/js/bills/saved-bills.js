"use strict";

// Bills → Saved bills: the list, PDF and print, and cancelling or undoing several at once.

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
  const present = new Set(invoices.map((i) => i.id));
  for (const id of billsState.selectedInvoices) if (!present.has(id)) billsState.selectedInvoices.delete(id);
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
  const months = $("savedMonth").values;
  const tokens = normalize($("savedSearch").value).split(" ").filter(Boolean);
  return billsState.invoices.filter((i) => savedPeriodFilter.matches(i.billMonth) && (!months.length || months.includes(i.billMonth)) && tokens.every((t) => normalize([i.invoiceNo, i.partyName, i.finishes, i.status].join(" ")).includes(t)));
}

function renderInvoices() {
  clearTimeout(savedSearchTimer);
  const list = shownInvoices();
  const picked = billsState.selectedInvoices;
  const all = el("input", { type: "checkbox", id: "savedAll", "aria-label": "Select every shown bill" });
  all.checked = list.length > 0 && list.every((i) => picked.has(i.id));
  all.addEventListener("change", () => {
    for (const i of list) all.checked ? picked.add(i.id) : picked.delete(i.id);
    renderInvoices();
  });
  const head = el("thead", {}, [el("tr", {}, [el("th", { class: "pick" }, [all]), ...["BILL NO.", "DATE", "PARTY", "FINISH", "THAN", "TOTAL", "ENTRIES", "STATUS", "FROM", "EXCEL"].map((h) => el("th", { text: h }))])]);
  const body = el("tbody", {}, list.map((i) => {
    const box = el("input", { type: "checkbox", "data-id": String(i.id), "aria-label": `Select bill ${i.invoiceNo}` });
    box.checked = picked.has(i.id);
    box.addEventListener("click", (event) => event.stopPropagation());
    box.addEventListener("change", () => {
      box.checked ? picked.add(i.id) : picked.delete(i.id);
      tr.classList.toggle("bill-row-selected", box.checked);
      all.checked = list.every((b) => picked.has(b.id));
      updateSavedSelection();
    });
    const tr = el("tr", { class: [i.status === "cancelled" ? "inactive" : "", i.id === billsState.openInvoice?.id ? "selected" : "", picked.has(i.id) ? "bill-row-selected" : ""].join(" ").trim(), "data-id": String(i.id) }, [
      el("td", { class: "pick" }, [box]),
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
  updateSavedSelection();
  const live = list.filter((i) => i.status !== "cancelled");
  $("savedCount").textContent = `${num(list.length)} bills`;
  $("savedTotals").replaceChildren(el("span", {}, ["Bills: ", el("b", { text: num(live.length) })]),
    el("span", {}, ["THAN: ", el("b", { text: num(live.reduce((s, i) => s + i.than, 0)) })]),
    el("span", {}, ["Total: ", el("b", { text: rupees(live.reduce((s, i) => s + i.total, 0)) })]));
}
// ---------- Cancel or undo several saved bills at once ----------
function selectedBills() {
  return billsState.invoices.filter((i) => billsState.selectedInvoices.has(i.id));
}

// Undoing releases numbers, so the ticked bills must be the newest ones of their financial year (the server checks again,
// one bill at a time). Returns the bills newest first, or why they cannot be undone.
function undoPlan(bills) {
  if (!bills.length) return { reason: "" };
  if (bills.some((i) => i.status === "cancelled")) return { reason: "A cancelled bill keeps its number and cannot be undone." };
  if (bills.some((i) => i.source !== "app")) return { reason: "Imported Excel bills cannot release their numbers." };
  const order = [];
  for (const fy of new Set(bills.map((i) => i.fy))) {
    const series = billsState.invoices.filter((i) => i.fy === fy).sort((a, b) => b.serial - a.serial);
    const ticked = bills.filter((i) => i.fy === fy);
    const newest = series.slice(0, ticked.length);
    const missed = newest.find((i) => !billsState.selectedInvoices.has(i.id));
    if (missed) return { reason: `Undo needs the latest bill to be selected too, and every bill after the oldest one selected. ${missed.invoiceNo} is not selected.` };
    order.push(...newest);
  }
  return { order };
}

function updateSavedSelection() {
  const bills = selectedBills();
  const live = bills.filter((i) => i.status !== "cancelled");
  const plan = undoPlan(bills);
  $("cancelSelected").disabled = live.length === 0;
  $("undoSelected").disabled = !plan.order;
  $("undoSelected").title = plan.reason || "";
  $("savedSelection").textContent = bills.length ? `${num(bills.length)} selected` : "";
}

function releaseNote(bills) {
  const written = bills.filter((i) => i.exportedAt);
  return written.length ? ` ${written.map((i) => i.invoiceNo).join(", ")} ${written.length === 1 ? "was" : "were"} written to Excel: remove ${written.length === 1 ? "it" : "them"} from that workbook by hand.` : "";
}

async function afterBulkChange() {
  state.entriesCache.clear();
  await refreshInvoices();
  await refreshBillYears();
  if (billsState.party) await loadCandidates(billsState.party, { force: true });
  else {
    clearBillCache();
    await refreshToBill();
  }
}

async function cancelSelectedBills() {
  const bills = selectedBills().filter((i) => i.status !== "cancelled");
  if (!bills.length) return;
  const names = bills.map((i) => i.invoiceNo);
  if (!(await showConfirm({
    title: "Cancel selected bills",
    message: `Cancel ${bills.length === 1 ? `bill ${names[0]}` : `${bills.length} bills`}?`,
    detail: `${names.join(", ")}. The numbers stay used and the bills are marked CANCELLED. Their entries become unbilled so they can be billed again.${releaseNote(bills)}`,
    confirmText: bills.length === 1 ? "Cancel bill" : "Cancel bills",
    cancelText: "Keep bills",
    tone: "danger",
  }))) return;
  const done = [];
  let failure = null;
  for (const bill of bills) {
    try {
      await api(`/api/invoices/${bill.id}/cancel`, { method: "POST" });
      billsState.selectedInvoices.delete(bill.id);
      done.push(bill.invoiceNo);
    } catch (error) {
      failure = `${bill.invoiceNo}: ${error.message}`;
      break;
    }
  }
  await finishBulk(done, failure, "Cancelled", "Could not cancel every selected bill");
}

async function undoSelectedBills() {
  const plan = undoPlan(selectedBills());
  if (!plan.order) return;
  const names = plan.order.map((i) => i.invoiceNo);
  if (!(await showConfirm({
    title: "Undo saves & release numbers",
    message: `Undo save for ${plan.order.length === 1 ? `bill ${names[0]}` : `${plan.order.length} bills`}?`,
    detail: `${names.join(", ")}. This makes the entries unbilled and releases the numbers for the next bills. Confirm only if these bills were never issued to a customer, reported for GST, or given an IRN. Undo history is kept.${releaseNote(plan.order)}`,
    confirmText: "Never issued - undo saves",
    cancelText: "Keep bills",
    tone: "danger",
  }))) return;
  const done = [];
  let failure = null;
  let next = null;
  for (const bill of plan.order) {
    try {
      const doc = await api(`/api/invoices/${bill.id}`);
      if (!doc.undoSave?.allowed) throw new Error(doc.undoSave?.reason || "This bill's save cannot be undone.");
      const result = await api(`/api/invoices/${bill.id}/undo-save`, { method: "POST", json: { neverIssued: true, token: doc.undoSave.token } });
      billsState.selectedInvoices.delete(bill.id);
      done.push(result.invoiceNo);
      next = result.nextSerial;
    } catch (error) {
      failure = `${bill.invoiceNo}: ${error.message}`;
      break;
    }
  }
  await finishBulk(done, failure, "Undid save for", "Could not undo every selected bill", next);
}

async function finishBulk(done, failure, verb, problem, next = null) {
  try {
    if (done.length) await afterBulkChange();
    else renderInvoices();
  } catch (error) {
    failure ||= `The lists could not be refreshed: ${error.message}`;
  }
  if (done.length) toast(`${verb} ${done.join(", ")}.${next === null ? "" : ` Next bill number: ${next}.`}`);
  if (failure) await showAlert({ title: problem, message: failure, detail: done.length ? `Done before it stopped: ${done.join(", ")}.` : "", tone: "danger" });
}

$("cancelSelected").addEventListener("click", cancelSelectedBills);
$("undoSelected").addEventListener("click", undoSelectedBills);

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

$("savedMonth").addEventListener("input", renderInvoices);
// A long list is drawn again once typing pauses, not on every key; a short one at once.
let savedSearchTimer = 0;
$("savedSearch").addEventListener("input", () => {
  clearTimeout(savedSearchTimer);
  if (billsState.invoices.length < SEARCH_DELAY_FROM_ROWS) renderInvoices();
  else savedSearchTimer = setTimeout(renderInvoices, 150);
});
$("excelShown").addEventListener("click", () => openExcelExport(shownInvoices().filter((i) => i.status !== "cancelled")));
$("printShown").addEventListener("click", () => {
  const ids = shownInvoices().filter((i) => i.status !== "cancelled").map((i) => i.id);
  if (ids.length) openPrint(ids.join(","));
});

$("invoiceDrawer").addEventListener("close", () => returnFrom("bill"));
