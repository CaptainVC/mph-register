"use strict";

// Opening a saved bill to read, correct, cancel, undo or restore it.

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
