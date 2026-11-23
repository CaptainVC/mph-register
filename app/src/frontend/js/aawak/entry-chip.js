"use strict";

// The Aawak row of the inward slip being entered, shown on the New entry form.

// ---------- New inward entry: the Aawak rows the slip came on ----------
let entryAawakTimer = null;
function scheduleEntryAawak() {
  clearTimeout(entryAawakTimer);
  entryAawakTimer = setTimeout(() => refreshEntryAawak().catch(() => {}), 300);
}
["inwardNo", "entryDate", "party"].forEach((id) => {
  $(id).addEventListener("input", scheduleEntryAawak);
  $(id).addEventListener("change", scheduleEntryAawak);
});
new MutationObserver(scheduleEntryAawak).observe($("formTitle"), { childList: true, characterData: true, subtree: true });

function arrivalChip(a, text) {
  return el("a", { href: "#", class: "aawak-link", text, title: "Open this Aawak row", onclick: (event) => { event.preventDefault(); openArrival(a.id); } });
}

async function refreshEntryAawak() {
  const box = $("entryAawak");
  const editing = state.editing;
  if (editing?.aawak?.length) {
    box.replaceChildren(el("span", { class: "label", text: "Came on " }), ...editing.aawak.flatMap((a, i) => [i ? ", " : "",
      arrivalChip(a, `Aawak ${a.number}`), ` (${formatDate(a.arrivalDate)}, ${a.transporter}, ${num(a.nag)} NAG)`]));
    return;
  }
  const date = $("entryDate").value;
  const party = $("party").value.trim();
  const number = Number($("inwardNo").value);
  if (!date || !party || state.info?.showAawak === false) { box.replaceChildren(); return; }
  const candidates = await api(`/api/arrivals/candidates?${new URLSearchParams({ date, party })}`);
  if (state.editing !== editing || $("party").value.trim() !== party) return;
  const naming = candidates.filter((c) => number && slipNumbers(c.inwardText).includes(number));
  if (naming.length) {
    box.replaceChildren(el("span", { class: "label", text: "Came on " }), ...naming.flatMap((a, i) => [i ? ", " : "", arrivalChip(a, `Aawak ${a.number}`),
      ` (${a.transporter}, ${num(a.nag)} NAG, slips ${a.inwardText})`]), el("span", { class: "muted", text: editing ? "" : " — it links when you save." }));
  } else if (candidates.length) {
    box.replaceChildren(el("span", { class: "label", text: "Aawak rows of this party around this date still waiting for slips: " }),
      ...candidates.slice(0, 6).flatMap((a, i) => [i ? " · " : "", arrivalChip(a, `Aawak ${a.number}`), ` (${num(a.freeNag)} of ${num(a.nag)} NAG${a.inwardText ? `, INW NO ${a.inwardText}` : ""})`]));
  } else box.replaceChildren();
}
