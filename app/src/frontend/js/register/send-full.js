"use strict";

// Ticking several register rows and marking them sent in full in one go.

// ---------- JAWAK: several entries sent in full on one gate pass ----------
// In the Register's JAWAK columns each entry with something left to send has a tick box; the bar under the table then
// adds one dispatch of what is left to every ticked entry, with the gate pass and date typed once.
function canSendFull(entry) {
  return entry.balance > 0 && entry.status !== "allZero";
}

function sendPickBox() {
  const box = el("input", { type: "checkbox", class: "send-pick" });
  box.addEventListener("click", (event) => event.stopPropagation());
  box.addEventListener("change", () => {
    const id = Number(box.closest("tr").dataset.entryId);
    if (box.checked) sendPicks.add(id); else sendPicks.delete(id);
    updateSendFullBar();
  });
  return box;
}

function pickedForSending() {
  return registerShown.filter((entry) => sendPicks.has(entry.id) && canSendFull(entry));
}

function updateSendFullBar() {
  const bar = $("sendFullBar");
  const picked = $("registerTable").classList.contains("cols-jawak") ? pickedForSending() : [];
  bar.classList.toggle("hidden", picked.length === 0);
  if (!picked.length) return;
  const parties = [...new Set(picked.map((entry) => entry.party))];
  const left = picked.reduce((sum, entry) => sum + entry.balance, 0);
  $("sendFullSummary").replaceChildren(
    el("b", { text: picked.length === 1 ? "1 entry ticked" : `${num(picked.length)} entries ticked` }),
    ` · ${parties.length > 2 ? `${num(parties.length)} parties` : parties.join(", ")} · `,
    el("b", { text: `${num(left)} NAG` }),
    " still to send",
  );
  $("sendFullSave").textContent = picked.length === 1 ? "Mark it sent in full" : `Mark all ${num(picked.length)} sent in full`;
  if (!$("sendFullDate").value) $("sendFullDate").value = todayIso();
}

function clearSendPicks() {
  sendPicks.clear();
  document.querySelectorAll(".send-pick").forEach((box) => { box.checked = false; });
  updateSendFullBar();
}

$("sendFullClear").addEventListener("click", clearSendPicks);
$("sendFullGatePass").addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); $("sendFullDate").focus(); }
});
$("sendFullDate").addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); $("sendFullSave").click(); }
});
$("sendFullSave").addEventListener("click", async () => {
  const picked = pickedForSending();
  const gatePass = $("sendFullGatePass").value.trim();
  const date = $("sendFullDate").value || todayIso();
  if (!picked.length) return;
  if (!gatePass) {
    toast("Type the gate pass number first.", "err");
    $("sendFullGatePass").classList.add("invalid");
    $("sendFullGatePass").focus();
    return;
  }
  $("sendFullGatePass").classList.remove("invalid");
  const button = $("sendFullSave");
  button.disabled = true;
  const sent = [];
  const failed = [];
  for (const entry of picked) {
    const tr = $("registerTable").querySelector(`tr[data-entry-id="${entry.id}"]`);
    if (!tr) continue;
    try {
      // What is left is worked out again just before saving, on top of any save still running for this row.
      await queueEntrySave(tr, (payload) => {
        const left = rowEntry.get(tr).balance;
        if (left > 0) payload.dispatches.push({ qty: left, gatePass, date });
      });
      sendPicks.delete(entry.id);
      sent.push(entry);
    } catch (error) {
      failed.push(`INW. NO. ${entry.inwardNo}: ${error.errors ? error.errors.join(" ") : error.message}`);
    }
  }
  button.disabled = false;
  if (sent.length) {
    const numbers = sent.map((entry) => entry.inwardNo).join(", ");
    toast(`Saved ✓ ${sent.length === 1 ? "1 entry" : `${num(sent.length)} entries`} sent in full: INW. NO. ${numbers} · gate pass ${gatePass} · ${formatDate(date)}`);
    const billed = sent.filter((entry) => entry.billedIn).map((entry) => entry.inwardNo);
    if (billed.length) toast(`Already billed: INW. NO. ${billed.join(", ")}. Changing an entry does not change its bill.`, "warn");
    $("sendFullGatePass").value = "";
  }
  for (const message of failed) toast(`Not saved for ${message}`, "err");
  updateSendFullBar();
});
