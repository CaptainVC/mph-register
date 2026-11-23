"use strict";

// Aawak (आवक): goods arriving at the gate. One row is one consignment: one party's cloth brought by one lorry wala on one
// day, with its NAG and the inward slips (INW NO) it carries. Rows are linked to their inward entries on the server; every
// linked slip is a link to that inward entry, and the inward registers' Aawak column links back here.
const aawakState = {
  rows: [], rowsKey: null, recent: [], previewSeq: 0, lastDate: "", lastTransporter: "", editing: null, totals: null, totalsSeq: 0, check: null,
  importReport: null, lorry: [],
};

const ARRIVAL_STATUS = {
  linked: ["Linked", "Every INW NO was found and the slips' NAG matches"],
  nagDiffers: ["NAG differs", "The slips were found but their NAG adds up to something else"],
  partlyLinked: ["Partly linked", "Some INW NO are not in the inward register (yet)"],
  notLinked: ["No inward found", "No inward slip was found for this Aawak row"],
};
const NO_INWARD_TEXT = "No inward found";

// ---------- Shared bits ----------
function arrivalTitle(a) {
  return `Aawak ${a.number} — ${a.party} (${formatMonth(a.aawakMonth)})`;
}

function statusBadge(status) {
  const [label, tip] = ARRIVAL_STATUS[status] || [status, ""];
  return el("span", { class: `aawak-status status-${status}`, text: label, title: tip });
}

function inwardRange(numbers) {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(", ");
}

// The slip numbers in text such as "12-14", "13 TO 17" or "19,20" (the server reads more forms; this is for hints only).
function slipNumbers(text) {
  const numbers = [];
  const pattern = /(\d+)\s*(?:-+|TO)\s*(\d+)|(\d+)/gi;
  for (const m of String(text || "").matchAll(pattern)) {
    if (m[3]) numbers.push(Number(m[3]));
    else {
      const from = Number(m[1]);
      const to = Number(m[2]);
      if (to >= from && to - from < 30) for (let n = from; n <= to; n++) numbers.push(n);
      else numbers.push(from);
    }
  }
  return numbers;
}

// Opens an inward entry in the New Entry form; finishing or cancelling the correction comes back here.
async function openInwardEntry(entryId) {
  try {
    const entry = await api(`/api/entries/${entryId}`);
    loadIntoForm(entry);
  } catch (error) {
    toast(`Could not open the inward entry: ${errorText(error)}`, "err");
  }
}

function slipLink(slip) {
  const tip = `${slip.party} · ${formatDate(slip.entryDate)} · ${num(slip.nag)} NAG${slip.share ? ` (of the slip's ${num(slip.entryNag)})` : ""}` +
    ` · ${formatMonth(slip.registerMonth)} register${slip.sisterFirm ? " · sister firm" : ""}${slip.manual ? " · linked by hand" : ""}`;
  if (slip.deleted) return el("span", { class: "slip-deleted", text: String(slip.inwardNo), title: `${tip} · deleted in the app` });
  return el("a", {
    href: "#", class: "inward-link", text: String(slip.inwardNo), title: `Open INW. NO. ${slip.inwardNo}: ${tip}`,
    onclick: (event) => {
      event.preventDefault();
      event.stopPropagation();
      openInwardEntry(slip.entryId);
    },
  });
}

function fillSlipsCell(td, a) {
  if (!a.slips.length) {
    td.append(el("span", { class: "aawak-none", text: NO_INWARD_TEXT, title: a.refs.length ? `INW NO ${inwardRange(a.refs)} not found in the inward register` : "No INW NO was written" }));
    return;
  }
  a.slips.forEach((slip, index) => {
    if (index) td.append(", ");
    td.append(slipLink(slip));
  });
  if (a.missing.length) td.append(el("span", { class: "muted", text: ` · ${inwardRange(a.missing)} not found` }));
}

function fillNameLists() {
  const fill = (id, items) => {
    let list = $(id);
    if (!list) { list = el("datalist", { id }); document.body.append(list); }
    list.replaceChildren(...(items || []).filter((i) => i.active).map((i) => el("option", { value: i.name })));
  };
  fill("aawakPartyList", state.masters?.parties);
  fill("aawakLorryList", state.masters?.transporters);
}

function partyGroup(name) {
  const party = (state.masters?.parties || []).find((p) => p.name.toLowerCase() === String(name || "").trim().toLowerCase());
  return party ? party.group || "" : "";
}

function arrivalPayload(a, changes = {}) {
  return {
    aawakMonth: a.aawakMonth, aawakNo: a.number, arrivalDate: a.arrivalDate, party: a.party, nag: a.nag,
    transporter: a.transporter, inwardText: a.inwardText, note: a.note, ...changes,
  };
}

// The slips an arrival would link to, as typed: found slips (links to the inward entries), numbers not entered yet, numbers
// more than one slip could be, the NAG check and a reading of a shortened range that matches the NAG.
function renderSlipPanel(box, preview, { nag, onSuggest, onChoose } = {}) {
  if (!preview || (!preview.numbers.length && !preview.found.length)) {
    box.replaceChildren(el("p", { class: "muted", text: "No INW NO yet: the slips can be linked later, when the office enters them." }));
    return;
  }
  const rows = preview.found.map((slip) => el("li", {}, [slipLink(slip), ` · ${formatDate(slip.entryDate)} · ${slip.party} · ${num(slip.nag)} NAG`,
    slip.sisterFirm ? el("span", { class: "muted", text: " · sister firm" }) : "", slip.manual ? el("span", { class: "muted", text: " · linked by hand" }) : ""]));
  const choiceNumbers = new Set(preview.choices.map((c) => c.inwardNo));
  for (const number of preview.missing.filter((n) => !choiceNumbers.has(n))) {
    rows.push(el("li", { class: "slip-missing" }, [el("b", { text: String(number) }), " · not in the inward register yet; it links when the office enters it"]));
  }
  for (const choice of preview.choices) {
    const [only] = choice.entries;
    if (choice.entries.length === 1) {
      rows.push(el("li", { class: "slip-missing" }, [el("b", { text: String(choice.inwardNo) }), " · is under ", slipLink(only),
        ` ${only.party} (${formatDate(only.entryDate)}, ${num(only.nag)} NAG), not this party or a sister firm `,
        onChoose ? el("button", { type: "button", class: "ghost small", text: "Link this", onclick: () => onChoose(only) }) : ""]));
      continue;
    }
    rows.push(el("li", { class: "slip-missing" }, [el("b", { text: String(choice.inwardNo) }), " · more than one slip could be it: ",
      ...choice.entries.flatMap((slip, i) => [i ? ", " : "", slipLink(slip), ` (${slip.party}, ${formatDate(slip.entryDate)}, ${num(slip.nag)} NAG)`,
        onChoose ? el("button", { type: "button", class: "ghost small", text: "Link this", onclick: () => onChoose(slip) }) : ""])]));
  }
  const matches = preview.slipsNag === Number(nag);
  const check = el("p", { class: `slip-check ${matches ? "ok" : "warn"}`, text: nag
    ? `Slips ${num(preview.slipsNag)} ${matches ? "=" : "≠"} Aawak ${num(nag)} NAG ${matches ? "✓" : ""}`.trim()
    : `Slips ${num(preview.slipsNag)} NAG` });
  const parts = [el("h3", { text: `Slips ${inwardRange(preview.numbers) || ""}`.trim() }), el("ul", { class: "slip-list" }, rows), check];
  if (preview.suggestion && onSuggest) {
    parts.push(el("button", { type: "button", class: "secondary small", id: "slipSuggestion", text: `Did you mean ${preview.suggestion}? (NAG matches)`,
      onclick: () => onSuggest(preview.suggestion) }));
  }
  box.replaceChildren(...parts);
}

async function previewSlips({ date, party, nag, inward, id }) {
  const query = new URLSearchParams({ date: date || "", party: party || "", inward: inward || "" });
  if (nag) query.set("nag", String(nag));
  if (id) query.set("id", String(id));
  return api(`/api/arrivals/preview-slips?${query}`);
}

// ---------- New Aawak form ----------
const ARRIVAL_FIELDS = ["arrivalNo", "arrivalDate", "arrivalParty", "arrivalNag", "arrivalTransporter", "arrivalInward", "arrivalNote"];

function focusArrivalNext(id) {
  const index = ARRIVAL_FIELDS.indexOf(id);
  if (index < 0) return;
  if (index === ARRIVAL_FIELDS.length - 1) { $("arrivalForm").requestSubmit(); return; }
  const next = $(ARRIVAL_FIELDS[index + 1]);
  next.focus();
  next.select?.();
}

const arrivalPartyCombo = createCombo($("arrivalPartyCombo"), () => state.masters?.parties || [], {
  onPick: (_, advance) => {
    arrivalPartyChanged();
    if (advance) focusArrivalNext("arrivalParty");
  },
});
const arrivalTransporterCombo = createCombo($("arrivalTransporterCombo"), () => state.masters?.transporters || [], {
  onPick: (_, advance) => {
    schedulePreview();
    if (advance) focusArrivalNext("arrivalTransporter");
  },
});

function arrivalPartyChanged() {
  $("arrivalGroup").textContent = partyGroup($("arrivalParty").value);
  // The lorry wala this party came with most often this month is offered first.
  if (!$("arrivalTransporter").value.trim()) {
    const counts = new Map();
    for (const a of [...aawakState.recent, ...aawakState.rows]) {
      if (a.party.toLowerCase() === $("arrivalParty").value.trim().toLowerCase()) counts.set(a.transporter, (counts.get(a.transporter) || 0) + 1);
    }
    const usual = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0];
    if (usual) $("arrivalTransporter").value = usual;
  }
  schedulePreview();
}

$("arrivalForm").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.defaultPrevented || event.shiftKey) return;
  const id = event.target.id;
  if (!ARRIVAL_FIELDS.includes(id)) return;
  event.preventDefault();
  if (id === "arrivalParty") arrivalPartyCombo.canonical();
  if (id === "arrivalTransporter") arrivalTransporterCombo.canonical();
  focusArrivalNext(id);
});

let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => refreshFormPreview().catch(() => {}), 250);
}
["arrivalDate", "arrivalParty", "arrivalNag", "arrivalInward"].forEach((id) => $(id).addEventListener("input", schedulePreview));
$("arrivalParty").addEventListener("change", arrivalPartyChanged);
$("arrivalNo").addEventListener("input", () => { $("arrivalNo").dataset.auto = ""; });
$("arrivalDate").addEventListener("change", () => {
  if ($("arrivalNo").dataset.auto === "1") suggestArrivalNumber().catch(() => {});
});

async function refreshFormPreview() {
  const seq = ++aawakState.previewSeq;
  const inward = $("arrivalInward").value.trim();
  const box = $("arrivalSlips");
  if (!inward) { renderSlipPanel(box, null); return; }
  const preview = await previewSlips({ date: $("arrivalDate").value, party: $("arrivalParty").value, nag: $("arrivalNag").value, inward });
  if (seq !== aawakState.previewSeq) return;
  renderSlipPanel(box, preview, {
    nag: $("arrivalNag").value,
    onSuggest: (text) => { $("arrivalInward").value = text; schedulePreview(); },
  });
}

async function suggestArrivalNumber() {
  const month = monthOf($("arrivalDate").value);
  const { next } = await api(`/api/arrivals/next?month=${encodeURIComponent(month)}`);
  if ($("arrivalNo").dataset.auto === "1" || !$("arrivalNo").value) {
    $("arrivalNo").value = next;
    $("arrivalNo").dataset.auto = "1";
  }
}

async function prepareArrivalForm() {
  fillNameLists();
  if (!$("arrivalDate").value) $("arrivalDate").value = aawakState.lastDate || todayIso();
  $("arrivalNo").dataset.auto = $("arrivalNo").value && $("arrivalNo").dataset.auto !== "1" ? "" : "1";
  await Promise.all([suggestArrivalNumber(), renderRecentArrivals()]);
  if (document.querySelector("#view-aawak.active #aawak-new.active")) $("arrivalParty").focus();
}

function setArrivalMessage(text, kind) {
  $("arrivalMessage").textContent = text;
  $("arrivalMessage").className = `message ${kind || ""}`;
}

$("arrivalForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  arrivalPartyCombo.canonical();
  arrivalTransporterCombo.canonical();
  const payload = {
    aawakMonth: "", aawakNo: $("arrivalNo").dataset.auto === "1" ? "" : $("arrivalNo").value.trim(), arrivalDate: $("arrivalDate").value,
    party: $("arrivalParty").value.trim(), nag: intOrNull($("arrivalNag").value), transporter: $("arrivalTransporter").value.trim(),
    inwardText: $("arrivalInward").value.trim(), note: $("arrivalNote").value.trim(),
  };
  $("arrivalSave").disabled = true;
  try {
    const saved = await api("/api/arrivals", { method: "POST", json: payload });
    aawakState.lastDate = saved.arrivalDate;
    aawakState.rowsKey = null;
    toast(`Saved ✓ Aawak ${saved.number} — ${saved.party}, ${num(saved.nag)} NAG${saved.status === "linked" ? "" : ` (${ARRIVAL_STATUS[saved.status][0]})`}`,
      saved.status === "linked" || saved.status === "notLinked" ? "ok" : "warn");
    setArrivalMessage("", "");
    // The next consignment is often of the same day and lorry wala: those stay, the rest clears.
    for (const id of ["arrivalNag", "arrivalInward", "arrivalNote", "arrivalParty"]) $(id).value = "";
    $("arrivalGroup").textContent = "";
    $("arrivalNo").value = "";
    $("arrivalNo").dataset.auto = "1";
    renderSlipPanel($("arrivalSlips"), null);
    await Promise.all([suggestArrivalNumber(), renderRecentArrivals()]);
    $("arrivalParty").focus();
  } catch (error) {
    setArrivalMessage(errorText(error), "err");
  } finally {
    $("arrivalSave").disabled = false;
  }
});

async function renderRecentArrivals() {
  aawakState.recent = await api("/api/arrivals/recent?limit=30");
  const table = $("arrivalRecentTable");
  table.replaceChildren(aawakHead(), el("tbody", {}, aawakState.recent.map((a) => aawakRow(a, { editable: false }))));
  setTableEmpty(table, aawakState.recent.length ? "" : "No Aawak row has been typed in the app yet.");
}
