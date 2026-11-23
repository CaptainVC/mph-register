"use strict";

// Saving, deleting and restoring entries, and the keyboard shortcuts of the entry form.

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

// Returns true when the deleted entries were removed for good.
async function purgeDeletedEntries(count) {
  const ok = await showConfirm({
    title: "Delete all permanently?",
    message: count === 1 ? "The deleted entry will be removed for good and cannot be restored." : `All ${num(count)} deleted entries will be removed for good and cannot be restored.`,
    detail: "Importing a workbook again can bring back any of these rows that it still contains.",
    confirmText: "Delete permanently",
    cancelText: "Keep them",
    tone: "danger",
  });
  if (!ok) return false;
  try {
    const result = await api("/api/entries/deleted", { method: "DELETE" });
    setMessage(`Permanently deleted ${num(result.removed)} ${result.removed === 1 ? "entry" : "entries"} ✓`, "ok");
    return true;
  } catch (error) {
    await showAlert({ title: "Entries not deleted", message: errorText(error), tone: "danger" });
    return false;
  }
}

async function showDeletedEntries() {
  const dialog = $("deletedDrawer");
  const items = await api("/api/entries/deleted");
  const close = el("button", { type: "button", class: "secondary", text: "Close", onclick: () => closeDrawer(dialog) });
  const purge = el("button", {
    type: "button", class: "danger", id: "purgeDeletedEntries", text: "Delete all permanently",
    title: "Remove every deleted entry for good; none can be restored afterwards",
    onclick: async () => {
      if (await purgeDeletedEntries(items.length)) await showDeletedEntries();
    },
  });
  drawerForm($("deletedForm"), {
    title: "Deleted entries",
    subtitle: items.length ? `${num(items.length)} deleted` : "",
    body: [
      el("p", { class: "muted", text: "Entries deleted in the app stay here until they are restored or deleted permanently. One can be restored while its INW. NO. and slip are still free." }),
      items.length ? el("ul", { class: "deleted-list" }, items.map(deletedEntryItem)) : el("p", { class: "deleted-empty", text: "No deleted entries." }),
    ],
    actions: items.length ? [close, purge] : [close],
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
