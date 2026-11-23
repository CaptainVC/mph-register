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

// ---------- Aawak register ----------
const Aawak_COLUMNS = [
  ["Aawak NO", (a) => a.number, "inward"],
  ["DATE", (a) => formatDate(a.arrivalDate), "", null, { field: "arrivalDate", kind: "date" }],
  ["PARTY", (a) => a.party, "left", null, { field: "party", kind: "list", list: "aawakPartyList" }],
  ["GROUP", (a) => (a.group && a.group.toLowerCase() !== a.party.toLowerCase() ? a.group : ""), "left muted"],
  ["NAG", (a) => num(a.nag), "big", null, { field: "nag", kind: "number" }],
  ["LORRY WALA", (a) => a.transporter, "left", null, { field: "transporter", kind: "list", list: "aawakLorryList" }],
  ["INW NO", (a) => a.inwardText, "left", null, { field: "inwardText", kind: "text" }],
  ["SLIPS", () => "", "left slips-cell", fillSlipsCell],
  ["SLIPS NAG", (a) => (a.slips.length ? num(a.slipsNag) : ""), "big"],
  ["STATUS", () => "", "", (td, a) => td.append(statusBadge(a.status))],
  ["NOTE", (a) => a.note, "left", null, { field: "note", kind: "text" }],
  ["WARNINGS", (a) => a.warnings.join(" "), "left warning-cell", (td, a) => {
    td.title = a.warnings.join(" ");
    td.append(el("span", { class: "warning-text", text: a.warnings.join(" ") }));
  }],
];

function aawakHead() {
  return el("thead", {}, [el("tr", {}, Aawak_COLUMNS.map(([title], i) => el("th", i === 0 ? { text: title, title: "Click an Aawak NO to open the whole row" } : { text: title })))]);
}

function aawakRow(a, { editable = true } = {}) {
  const tr = el("tr", { "data-id": String(a.id), class: `arrival-row status-${a.status}${a.warnings.length ? " has-warning" : ""}` });
  Aawak_COLUMNS.forEach(([, value, cls, render, edit], index) => {
    const td = el("td", { class: cls || "" });
    if (render) render(td, a);
    else td.textContent = value(a) ?? "";
    if (index === 0) {
      td.classList.add("open-cell");
      if (editable) td.addEventListener("click", () => openArrivalDrawer(a));
    } else if (editable && edit) {
      td.classList.add("editable");
      td.addEventListener("click", () => openAawakCell(td, a, edit));
    }
    tr.append(td);
  });
  if (!editable) tr.addEventListener("click", (event) => { if (event.target.closest("td") && !event.target.closest("a")) openArrivalDrawer(a); });
  return tr;
}

// Click a cell to change it: Enter (or leaving the cell) saves, Esc cancels.
function openAawakCell(td, arrival, edit) {
  if (td.querySelector("input")) return;
  const input = el("input", { class: "cell-input", type: edit.kind === "number" ? "number" : edit.kind === "date" ? "date" : "text", "aria-label": edit.field });
  if (edit.list) input.setAttribute("list", edit.list);
  input.value = arrival[edit.field] ?? "";
  const original = td.cloneNode(true);
  td.replaceChildren(input);
  input.focus();
  input.select?.();
  let done = false;
  const restore = () => td.replaceChildren(...original.childNodes);
  const commit = async () => {
    if (done) return;
    done = true;
    const value = edit.kind === "number" ? intOrNull(input.value) : input.value.trim();
    if (String(value ?? "") === String(arrival[edit.field] ?? "")) { restore(); return; }
    try {
      const saved = await api(`/api/arrivals/${arrival.id}`, { method: "PUT", json: arrivalPayload(arrival, { [edit.field]: value }) });
      replaceArrival(saved);
      toast(`Saved ✓ Aawak ${saved.number}`);
    } catch (error) {
      restore();
      toast(errorText(error), "err");
    }
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); commit(); }
    else if (event.key === "Escape") { event.preventDefault(); done = true; restore(); }
  });
  input.addEventListener("blur", () => commit());
}

function replaceArrival(saved) {
  const index = aawakState.rows.findIndex((r) => r.id === saved.id);
  if (index >= 0) aawakState.rows[index] = saved;
  const recent = aawakState.recent.findIndex((r) => r.id === saved.id);
  if (recent >= 0) aawakState.recent[recent] = saved;
  document.querySelectorAll(`.aawak-table tbody tr[data-id="${saved.id}"]`).forEach((tr) => {
    tr.replaceWith(aawakRow(saved, { editable: tr.closest("table").id === "aawakTable" }));
  });
  if (index >= 0) renderAawakTotals(shownArrivals());
}

const aawakPeriod = financialYearMonthFilter($("aawakFinancialYear"), $("aawakMonth"), () => renderAawakRegister());
$("aawakMonth").addEventListener("change", () => renderAawakRegister().catch(showFatal));
// Same chips as the inward register (rowFilters in app.js): include or exclude, ORed within a group and ANDed between groups.
const ARRIVAL_FILTERS = [
  { caption: "Status", help: "Include any statuses to show, or exclude statuses to hide", filters: Object.entries(ARRIVAL_STATUS).map(([key, [label, tip]]) => (
    { key, label, swatch: true, tip, test: (a) => a.status === key })) },
  { caption: "Other", help: "Each included condition must match; any excluded condition hides the row", filters: [
    { key: "warning", label: "Has warning", group: "warning", swatch: true, tip: "Point at the row to read the warning", test: (a) => a.warnings.length > 0 },
    { key: "note", label: "Has note", group: "note", tip: "The NOTE column is not empty", test: (a) => a.note.trim() !== "" },
    { key: "sister", label: "Sister firm", group: "sister", tip: "The party belongs to a sister-firm group", test: (a) => a.group && a.group.toLowerCase() !== a.party.toLowerCase() },
    { key: "manual", label: "Linked by hand", group: "manual", tip: "At least one slip was linked by hand rather than found by INW NO", test: (a) => a.slips.some((s) => s.manual) },
    { key: "typed", label: "Typed in app", group: "typed", tip: "Typed in the app, not read from an Aawak workbook", test: (a) => !a.imported },
  ] },
  { caption: "Last import", help: "What the latest import of the Aawak workbook did: include New or Updated to see those rows", filters: [
    { key: "importAdded", label: "New", tip: "Added as a new row by the latest import of its month's workbook", test: (a) => a.lastImport?.action === "added" },
    { key: "importUpdated", label: "Updated", tip: "Changed by the latest import of its month's workbook. Point at the row to see what changed", test: (a) => a.lastImport?.action === "updated" },
  ] },
];
const aawakRowFilter = rowFilters($("aawakFilters"), () => renderAawakRegister({ reuse: true }).catch(showFatal), $("aawakFiltersToggle"), ARRIVAL_FILTERS);
$("aawakSearch").addEventListener("input", () => renderAawakRegister({ reuse: true }).catch(showFatal));

async function fillAawakMonths(month) {
  const months = (await api("/api/arrivals/months")).map((m) => ({ month: m.month, entries: m.arrivals }));
  if (month) {
    if (!months.some((m) => m.month === month)) months.unshift({ month, entries: 0 });
    aawakPeriod.show(months, month);
  } else aawakPeriod.fill(months);
}

function shownArrivals() {
  const tokens = normalize($("aawakSearch").value).split(" ").filter(Boolean);
  const months = $("aawakMonth").values;
  const searched = aawakState.rows.filter((a) => {
    if (!aawakPeriod.matches(a.aawakMonth) || (months.length && !months.includes(a.aawakMonth))) return false;
    if (!tokens.length) return true;
    const text = normalize([a.number, a.party, a.group, a.transporter, a.inwardText, a.note, ...a.refs, formatDate(a.arrivalDate)].join(" "));
    return tokens.every((t) => text.includes(t));
  });
  return aawakRowFilter(searched);
}

async function renderAawakRegister({ reuse = false } = {}) {
  const months = $("aawakMonth").values;
  const key = months.join(",") || "all";
  if (!reuse || aawakState.rowsKey !== key) {
    // One month is asked for by name; several are read together and cut down in shownArrivals.
    aawakState.rows = await api(months.length === 1 ? `/api/arrivals?month=${encodeURIComponent(months[0])}` : "/api/arrivals");
    aawakState.rowsKey = key;
  }
  const rows = shownArrivals();
  const table = $("aawakTable");
  table.replaceChildren(aawakHead(), el("tbody", {}, rows.map((a) => aawakRow(a))));
  setTableEmpty(table, rows.length ? "" : aawakState.rows.length ? "No Aawak rows match." : "No Aawak rows in this period yet.");
  $("aawakCount").textContent = `${num(rows.length)} rows`;
  renderAawakTotals(rows);
}

function renderAawakTotals(rows) {
  const count = (status) => rows.filter((a) => a.status === status).length;
  const stats = [
    ["Rows", rows.length, ""], ["NAG", rows.reduce((s, a) => s + a.nag, 0), ""], ["Slips NAG", rows.reduce((s, a) => s + a.slipsNag, 0), ""],
    ["Linked", count("linked"), ""], ["NAG differs", count("nagDiffers"), count("nagDiffers") ? " stat-warn" : ""],
    ["Partly linked", count("partlyLinked"), count("partlyLinked") ? " stat-balance" : ""], ["No inward found", count("notLinked"), count("notLinked") ? " stat-balance" : ""],
  ];
  $("aawakTotals").replaceChildren(...stats.map(([k, v, tone]) => el("div", { class: `stat${tone}` }, [
    el("span", { class: "stat-label" }, [k, el("span", { class: "sr-only", text: ": " })]), el("b", { class: "stat-value", text: num(v) })])));
}

async function refreshAawakRegister() {
  fillNameLists();
  await fillAawakMonths();
  await renderAawakRegister();
}

$("aawakRelink").addEventListener("click", async () => {
  const months = $("aawakMonth").values;
  try {
    const relink = (month) => api(`/api/arrivals/relink${month ? `?month=${encodeURIComponent(month)}` : ""}`, { method: "POST" });
    const results = await Promise.all(months.length ? months.map(relink) : [relink("")]);
    const result = Object.fromEntries(["arrivals", "linked", "nagDiffers", "partlyLinked", "notLinked"].map((field) => [field, results.reduce((sum, r) => sum + r[field], 0)]));
    toast(`Linked again ✓ ${num(result.arrivals)} rows: ${num(result.linked)} linked, ${num(result.nagDiffers)} NAG differs, ${num(result.partlyLinked + result.notLinked)} with slips not found`);
    aawakState.rowsKey = null;
    await renderAawakRegister();
  } catch (error) {
    toast(errorText(error), "err");
  }
});

// Shows a sub-view without running its loader (the caller fills it).
function showAawakSubview(sub) {
  document.querySelectorAll(".subtabs[data-group=aawak] .subtab").forEach((b) => b.classList.toggle("active", b.dataset.sub === sub));
  document.querySelectorAll('[id^="aawak-"].subview').forEach((v) => v.classList.toggle("active", v.id === `aawak-${sub}`));
}

// Opened from an inward register's Aawak column: the row opens in the Aawak register; closing it goes back there.
async function openArrival(id) {
  try {
    const arrival = await api(`/api/arrivals/${id}`);
    rememberReturn("arrival", "aawak");
    showAawakSubview("register");
    await switchView("aawak");
    $("aawakSearch").value = "";
    aawakRowFilter.clear();
    await fillAawakMonths(arrival.aawakMonth);
    aawakState.rowsKey = null;
    await renderAawakRegister();
    document.querySelector(`#aawakTable tbody tr[data-id="${id}"]`)?.scrollIntoView({ block: "center" });
    openArrivalDrawer(arrival);
  } catch (error) {
    toast(`Could not open the Aawak row: ${errorText(error)}`, "err");
    await returnFrom("arrival");
  }
}

// ---------- One Aawak row in a slide-in window ----------
function openArrivalDrawer(arrival) {
  aawakState.editing = arrival;
  markRow("aawakTable", "data-id", String(arrival.id));
  fillNameLists();
  const form = $("arrivalEditor");
  const make = (id, value, props = {}) => {
    const node = el("input", { id, type: "text", ...props });
    node.value = value ?? "";
    return node;
  };
  const no = make("ae-no", arrival.number, { maxlength: "8" });
  const date = make("ae-date", arrival.arrivalDate, { type: "date" });
  const party = make("ae-party", arrival.party, { list: "aawakPartyList" });
  const nag = make("ae-nag", arrival.nag, { type: "number", min: "1" });
  const lorry = make("ae-lorry", arrival.transporter, { list: "aawakLorryList" });
  const inward = make("ae-inward", arrival.inwardText, { placeholder: "12-14, 20" });
  const note = make("ae-note", arrival.note);
  const slips = el("div", { class: "aawak-slips", id: "ae-slips" });
  let seq = 0;
  const refresh = async () => {
    const mine = ++seq;
    const preview = await previewSlips({ date: date.value, party: party.value, nag: nag.value, inward: inward.value, id: arrival.id });
    if (mine !== seq) return;
    renderSlipPanel(slips, preview, {
      nag: nag.value,
      onSuggest: (text) => { inward.value = text; form.dataset.dirty = "1"; refresh().catch(() => {}); },
      onChoose: (slip) => linkSlip(arrival, slip.entryId),
    });
  };
  let timer = null;
  for (const node of [date, party, nag, inward]) node.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => refresh().catch(() => {}), 250); });

  const manual = arrival.slips.filter((s) => s.manual);
  const manualList = manual.length ? section("Linked by hand", [el("ul", { class: "slip-list" }, manual.map((s) => el("li", {}, [slipLink(s), ` · ${s.party} · ${num(s.nag)} NAG `,
    el("button", { type: "button", class: "ghost small", text: "Take off", onclick: () => unlinkSlip(arrival, s.entryId) })])))]) : "";
  const save = el("button", { type: "submit", id: "ae-save", text: "Save changes" });
  const remove = el("button", { type: "button", class: "secondary", id: "ae-delete", text: "Delete row", onclick: () => deleteArrival(arrival) });
  drawerForm(form, {
    key: `arrival:${arrival.id}`,
    title: `Aawak ${arrival.number}`,
    subtitle: `${formatMonth(arrival.aawakMonth)} · ${arrival.party}`,
    body: [
      section("Aawak row", [fieldsGrid([field("Aawak NO", no), field("DATE", date), field("PARTY", party), field("NAG", nag), field("LORRY WALA", lorry),
        field("INW NO", inward, "The inward slips: 12-14, 13 TO 17, 19,20"), field("NOTE", note)], 2)]),
      section("Inward slips", [slips], "Click an INW NO to open that inward entry"),
      manualList,
      arrival.warnings.length ? section("Warnings", [el("ul", { class: "warnings" }, arrival.warnings.map((w) => el("li", { text: w })))]) : "",
    ],
    actions: [save, remove, el("button", { type: "button", class: "ghost", text: "Close", onclick: () => closeDrawer($("arrivalDrawer")) })],
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const saved = await api(`/api/arrivals/${arrival.id}`, { method: "PUT", json: {
        aawakMonth: arrival.aawakMonth, aawakNo: no.value.trim(), arrivalDate: date.value, party: party.value.trim(), nag: intOrNull(nag.value),
        transporter: lorry.value.trim(), inwardText: inward.value.trim(), note: note.value.trim(),
      } });
      markSaved(form);
      replaceArrival(saved);
      toast(`Saved ✓ ${arrivalTitle(saved)}`);
      openArrivalDrawer(saved);
    } catch (error) {
      formMessage(form, errorsOf(error));
    } finally {
      save.disabled = false;
    }
  };
  openDrawer($("arrivalDrawer"), party);
  refresh().catch(() => {});
}

async function linkSlip(arrival, entryId) {
  try {
    const saved = await api(`/api/arrivals/${arrival.id}/links`, { method: "POST", json: { entryId, nag: null } });
    replaceArrival(saved);
    openArrivalDrawer(saved);
    toast("Linked ✓");
  } catch (error) {
    toast(errorText(error), "err");
  }
}

async function unlinkSlip(arrival, entryId) {
  try {
    const saved = await api(`/api/arrivals/${arrival.id}/links/${entryId}`, { method: "DELETE" });
    replaceArrival(saved);
    openArrivalDrawer(saved);
    toast("Taken off ✓");
  } catch (error) {
    toast(errorText(error), "err");
  }
}

async function deleteArrival(arrival) {
  if (!(await showConfirm({
    title: "Delete Aawak row",
    message: `Delete ${arrivalTitle(arrival)}?`,
    detail: "It goes to Deleted rows and can be restored from there.",
    confirmText: "Delete row", cancelText: "Cancel", tone: "danger",
  }))) return;
  try {
    const result = await api(`/api/arrivals/${arrival.id}`, { method: "DELETE" });
    await closeDrawer($("arrivalDrawer"), true);
    aawakState.rows = aawakState.rows.filter((r) => r.id !== arrival.id);
    aawakState.recent = aawakState.recent.filter((r) => r.id !== arrival.id);
    document.querySelectorAll(`.aawak-table tbody tr[data-id="${arrival.id}"]`).forEach((tr) => tr.remove());
    renderAawakTotals(shownArrivals());
    for (const note of result.notes) toast(note, "warn");
    toast(`Deleted ✓ Aawak ${arrival.number}`, "ok", { id: "undoArrival", label: "Undo", run: () => restoreArrival(arrival.id) });
  } catch (error) {
    toast(errorText(error), "err");
  }
}

async function restoreArrival(id) {
  try {
    const restored = await api(`/api/arrivals/deleted/${id}/restore`, { method: "POST" });
    aawakState.rowsKey = null;
    toast(`Restored ✓ ${arrivalTitle(restored)}`);
    if ($("aawak-register").classList.contains("active")) await renderAawakRegister();
    if ($("aawak-new").classList.contains("active")) await renderRecentArrivals();
    return true;
  } catch (error) {
    toast(errorText(error), "err");
    return false;
  }
}

$("arrivalDrawer").addEventListener("close", () => {
  aawakState.editing = null;
  markRow("aawakTable", "data-id", null);
  returnFrom("arrival").catch(showFatal);
});

$("openDeletedArrivals").addEventListener("click", () => showDeletedArrivals().catch(showFatal));

async function showDeletedArrivals() {
  const rows = await api("/api/arrivals/deleted");
  const form = $("deletedArrivalsForm");
  const body = rows.length ? [el("table", { class: "register" }, [
    el("thead", {}, [el("tr", {}, ["Aawak NO", "Month", "DATE", "PARTY", "NAG", "LORRY WALA", "INW NO", "Deleted", ""].map((t) => el("th", { text: t })))]),
    el("tbody", {}, rows.map((d) => el("tr", {}, [
      el("td", { text: d.number }), el("td", { text: formatMonth(d.aawakMonth) }), el("td", { text: formatDate(d.arrivalDate) }), el("td", { class: "left", text: d.party }),
      el("td", { text: num(d.nag) }), el("td", { class: "left", text: d.transporter }), el("td", { text: d.inwardText }), el("td", { text: d.deletedAt }),
      el("td", {}, [d.canRestore
        ? el("button", { type: "button", class: "secondary small", text: "Restore", onclick: async () => { if (await restoreArrival(d.id)) await showDeletedArrivals(); } })
        : el("span", { class: "muted", title: d.problems.join(" "), text: "Cannot restore yet" })]),
    ]))),
  ])] : [el("p", { class: "muted", text: "No Aawak rows have been deleted." })];
  drawerForm(form, {
    key: "deleted-arrivals", title: "Deleted Aawak rows", subtitle: `${num(rows.length)} rows`, body,
    actions: [el("button", { type: "button", class: "ghost", text: "Close", onclick: () => closeDrawer($("deletedArrivalsDrawer")) })],
  });
  openDrawer($("deletedArrivalsDrawer"));
}

// ---------- Totals ----------
const TOTALS_PERIODS = [
  ["firstHalf", "1–15 this month"], ["secondHalf", "16 to month end"], ["thisMonth", "This month"], ["lastMonth", "Last month"],
  ["thisFy", "This financial year"], ["custom", "Choose dates"],
];
setDropdownOptions($("totalsPeriod"), TOTALS_PERIODS, "thisMonth");
setDropdownOptions($("totalsOrder"), [["nag", "Most NAG first"], ["first", "First arrival first"]], "nag");

function isoDay(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function periodDates(kind) {
  const [year, month] = todayIso().split("-").map(Number);
  const last = new Date(year, month, 0).getDate();
  if (kind === "firstHalf") return [isoDay(year, month, 1), isoDay(year, month, 15)];
  if (kind === "secondHalf") return [isoDay(year, month, 16), isoDay(year, month, last)];
  if (kind === "lastMonth") {
    const [y, m] = month === 1 ? [year - 1, 12] : [year, month - 1];
    return [isoDay(y, m, 1), isoDay(y, m, new Date(y, m, 0).getDate())];
  }
  if (kind === "thisFy") {
    const start = Number(financialYearOf(todayIso().slice(0, 7)));
    return [isoDay(start, 4, 1), isoDay(start + 1, 3, 31)];
  }
  return [isoDay(year, month, 1), isoDay(year, month, last)];
}

$("totalsPeriod").addEventListener("change", () => {
  if ($("totalsPeriod").value !== "custom") [$("totalsFrom").value, $("totalsTo").value] = periodDates($("totalsPeriod").value);
  renderTotalsView().catch(showFatal);
});
for (const id of ["totalsFrom", "totalsTo"]) $(id).addEventListener("change", () => { $("totalsPeriod").value = "custom"; renderTotalsView().catch(showFatal); });
$("totalsOrder").addEventListener("change", () => renderTotalsView().catch(showFatal));
$("totalsGroup").addEventListener("change", () => renderTotalsView().catch(showFatal));

function totalsQuery() {
  if (!$("totalsFrom").value && !$("totalsTo").value && $("totalsPeriod").value !== "custom") {
    [$("totalsFrom").value, $("totalsTo").value] = periodDates($("totalsPeriod").value);
  }
  return new URLSearchParams({ from: $("totalsFrom").value, to: $("totalsTo").value, group: String($("totalsGroup").checked), order: $("totalsOrder").value });
}

function nagShare(nag, total) {
  return total ? `${(nag / total * 100).toLocaleString("en-IN", { maximumFractionDigits: 1 })}%` : "0%";
}

function totalsTable(caption, lines, total) {
  return el("table", { class: "totals-table" }, [
    el("caption", { class: "sr-only", text: caption }),
    el("thead", {}, [el("tr", {}, ["Name", "Rows", "Share", "NAG"].map((text) => el("th", { scope: "col", text })))]),
    el("tbody", {}, lines.map((l) => el("tr", {}, [
      el("td", { class: "report-name", "data-no-i18n": "all" }, [el("span", { text: l.name }), l.isGroup ? el("small", { text: l.members.join(", ") }) : ""]),
      el("td", { text: num(l.arrivals) }),
      el("td", { class: "report-share" }, [
        el("span", { text: nagShare(l.nag, total) }),
        el("span", { class: "report-meter", "aria-hidden": "true" }, [el("span", { style: `width:${total ? l.nag / total * 100 : 0}%` })]),
      ]),
      el("td", { class: "report-nag", text: num(l.nag) }),
    ]))),
    el("tfoot", {}, [el("tr", {}, [
      el("th", { scope: "row", text: "Period total" }), el("th", { text: num(lines.reduce((s, l) => s + l.arrivals, 0)) }),
      el("th", { text: nagShare(total, total) }), el("th", { text: num(total) }),
    ])]),
  ]);
}

function totalsCard(title, note, lines, nag) {
  const search = el("input", { type: "search", placeholder: "Find a name...", "aria-label": `Search ${title.replace(/^By /, "")} totals` });
  const count = el("span", { class: "count-pill", text: num(lines.length) });
  const table = totalsTable(title, lines, nag);
  const empty = el("p", { class: "report-no-match muted", role: "status", hidden: "", text: "No matching names. Try a different search." });
  search.addEventListener("input", () => {
    const term = search.value.trim().toLocaleLowerCase();
    let visible = 0;
    [...table.tBodies[0].rows].forEach((row, i) => {
      row.hidden = ![lines[i].name, ...lines[i].members].some((name) => name.toLocaleLowerCase().includes(term));
      if (!row.hidden) visible++;
    });
    count.textContent = term ? `${num(visible)} / ${num(lines.length)}` : num(lines.length);
    empty.hidden = visible > 0;
  });
  return el("section", { class: "report-card", "aria-label": title }, [
    el("div", { class: "report-card-heading" }, [el("h2", { text: title }), count]),
    el("p", { class: "muted report-card-note", text: note }), search, table, empty,
  ]);
}

function renderTotalsReport(totals) {
  const stats = [
    ["Total NAG", totals.nag, "Across all arrivals"],
    ["Aawak rows", totals.arrivals, "Entries in this period"],
    [totals.groupSisters ? "Parties / groups" : "Parties", totals.parties.length, totals.groupSisters ? "Sister firms combined" : "Each party separately"],
    ["Lorry walas", totals.transporters.length, `${num(totals.days.length)} arrival days`],
  ];
  const daily = totalsTable("NAG by day", totals.days.map((d) => ({ name: formatDate(d.date), members: [], arrivals: d.arrivals, nag: d.nag })), totals.nag);
  daily.tHead.rows[0].cells[0].textContent = "Date";
  const transporters = totals.transporters;
  const parties = totals.parties;
  const cells = new Map(totals.matrix.map((c) => [JSON.stringify([c.transporter, c.party]), c.nag]));
  const matrix = el("table", { class: "totals-table report-matrix" }, [
    el("caption", { class: "sr-only", text: "NAG by lorry wala and party" }),
    el("thead", {}, [el("tr", {}, [
      el("th", { scope: "col", text: "Lorry wala" }),
      ...parties.map((p) => el("th", { scope: "col", text: p.name, "data-no-i18n": "all" })),
      el("th", { scope: "col", text: "Total NAG" }),
    ])]),
    el("tbody", {}, transporters.map((t) => el("tr", {}, [
      el("th", { scope: "row", text: t.name, "data-no-i18n": "all" }),
      ...parties.map((p) => el("td", { text: cells.has(JSON.stringify([t.name, p.name])) ? num(cells.get(JSON.stringify([t.name, p.name]))) : "\u2014" })),
      el("td", { class: "report-nag", text: num(t.nag) }),
    ]))),
    el("tfoot", {}, [el("tr", {}, [el("th", { scope: "row", text: "Total NAG" }), ...parties.map((p) => el("th", { text: num(p.nag) })), el("th", { text: num(totals.nag) })])]),
  ]);
  $("totalsResult").replaceChildren(
    el("div", { class: "report-stats", "aria-label": "Period summary" }, stats.map(([label, value, hint], i) => el("div", { class: `report-stat${i === 0 ? " report-stat-primary" : ""}` }, [
      el("span", { text: label }), el("b", { text: num(value) }), el("small", { text: hint }),
    ]))),
    el("div", { class: "report-breakdowns" }, [
      totalsCard(totals.groupSisters ? "By party / group" : "By party", totals.groupSisters ? "Share of period NAG. Search also finds a sister firm's name." : "Share of period NAG. Each party is shown separately.", totals.parties, totals.nag),
      el("div", { class: "report-side" }, [
        totalsCard("By lorry wala", "Who brought the goods, and how much.", totals.transporters, totals.nag),
        el("section", { class: "report-card", "aria-label": "Daily breakdown" }, [
          el("div", { class: "report-card-heading" }, [el("h2", { text: "Daily breakdown" }), el("span", { class: "count-pill", text: `${num(totals.days.length)} days` })]),
          el("p", { class: "muted report-card-note", text: "Arrival dates in calendar order." }),
          el("div", { class: "report-daily", tabindex: "0", role: "region", "aria-label": "Daily NAG totals" }, [daily]),
        ]),
      ]),
    ]),
    el("details", { class: "report-card report-cross" }, [
      el("summary", {}, [el("span", { text: "Lorry wala \u00d7 party" }), el("span", { class: "muted", text: "View NAG cross-check" })]),
      el("p", { class: "muted", text: "Each cell is NAG for one lorry wala and party. A dash means no arrivals. Row and column totals reconcile to the period total." }),
      el("div", { class: "report-matrix-wrap", tabindex: "0", role: "region", "aria-label": "NAG by lorry wala and party; scroll for more columns" }, [matrix]),
    ]),
    el("p", { class: "muted report-footnote", text: "Rows = Aawak entries, not inward slips. Searches only hide summary lines; period totals and the printed report always include all names." }),
  );
}

async function renderTotalsView() {
  const seq = ++aawakState.totalsSeq;
  const query = totalsQuery();
  const box = $("totalsResult");
  aawakState.totals = null;
  $("totalsPrint").disabled = true;
  $("statementsPrint").disabled = true;
  box.setAttribute("aria-busy", "false");
  const from = query.get("from"), to = query.get("to");
  if (!from || !to || from > to) {
    $("totalsStatus").textContent = !from || !to ? "Choose both dates to see your totals." : "The From date must be on or before the To date.";
    box.replaceChildren(el("div", { class: "report-empty", role: "alert", text: "Check the report dates above." }));
    return;
  }
  $("totalsStatus").textContent = "Updating totals...";
  box.setAttribute("aria-busy", "true");
  box.replaceChildren(el("div", { class: "report-empty muted", text: "Loading your report..." }));
  let totals;
  try {
    totals = await api(`/api/arrivals/totals?${query}`);
  } catch (error) {
    if (seq !== aawakState.totalsSeq) return;
    box.setAttribute("aria-busy", "false");
    $("totalsStatus").textContent = `Could not load totals: ${errorText(error)}`;
    box.replaceChildren(el("div", { class: "report-empty", role: "alert" }, [
      el("p", { text: "The report could not be loaded. Your data has not been changed." }),
      el("button", { type: "button", class: "secondary", text: "Try again", onclick: () => renderTotalsView().catch(showFatal) }),
    ]));
    return;
  }
  if (seq !== aawakState.totalsSeq) return;
  aawakState.totals = totals;
  box.setAttribute("aria-busy", "false");
  $("totalsStatus").replaceChildren(`${formatDate(totals.from)} to ${formatDate(totals.to)} \u00b7 `,
    el("span", { text: totals.groupSisters ? "Sister firms grouped" : "Individual parties" }), " \u00b7 ",
    el("span", { text: totals.order === "first" ? "First arrival first" : "Most NAG first" }));
  if (!totals.arrivals) {
    box.replaceChildren(el("div", { class: "report-empty" }, [
      el("h2", { text: "No arrivals in this period" }),
      el("p", { class: "muted", text: "Try another period or widen the dates. Totals appear here once Aawak entries are available." }),
    ]));
    return;
  }
  renderTotalsReport(totals);
  $("totalsPrint").disabled = false;
  $("statementsPrint").disabled = false;
}

function printArrivalReport(kind) {
  const { from, to, groupSisters, order } = aawakState.totals;
  window.open(`print-aawak.html?${new URLSearchParams({ kind, from, to, group: String(groupSisters), order })}`, "_blank", "noopener");
}
$("totalsPrint").addEventListener("click", () => printArrivalReport("totals"));
$("statementsPrint").addEventListener("click", () => printArrivalReport("statements"));

// ---------- Check ----------
function checkRange() {
  if (!$("checkFrom").value) $("checkFrom").value = `${todayIso().slice(0, 7)}-01`;
  if (!$("checkTo").value) $("checkTo").value = todayIso();
  return new URLSearchParams({ from: $("checkFrom").value, to: $("checkTo").value });
}

function checkCard(title, note, head, rows, empty) {
  return el("div", { class: "card check-card" }, [
    el("h2", {}, [title, el("span", { class: "count-pill", text: num(rows.length) })]),
    note ? el("p", { class: "muted", text: note }) : "",
    rows.length
      ? el("div", { class: "table-wrap" }, [el("table", { class: "register" }, [el("thead", {}, [el("tr", {}, head.map((h) => el("th", { text: h })))]), el("tbody", {}, rows)])])
      : el("p", { class: "muted", text: empty }),
  ]);
}

function arrivalLinkCell(a) {
  return el("td", {}, [el("a", { href: "#", class: "aawak-link", text: a.number, title: `Open ${arrivalTitle(a)}`, onclick: (event) => { event.preventDefault(); openArrival(a.id); } })]);
}

async function runCheck() {
  const check = await api(`/api/arrivals/check?${checkRange()}`);
  aawakState.check = check;
  const notLinked = check.notLinked.map((a) => el("tr", {}, [arrivalLinkCell(a), el("td", { text: formatDate(a.arrivalDate) }), el("td", { class: "left", text: a.party }),
    el("td", { text: num(a.nag) }), el("td", { class: "left", text: a.inwardText || "—" }), el("td", { class: "left slips-cell" }, [fillSlipsCellNode(a)])]));
  const nagDiffers = check.nagDiffers.map((a) => el("tr", {}, [arrivalLinkCell(a), el("td", { text: formatDate(a.arrivalDate) }), el("td", { class: "left", text: a.party }),
    el("td", { text: num(a.nag) }), el("td", { text: num(a.slipsNag) }), el("td", { class: "left slips-cell" }, [fillSlipsCellNode(a)])]));
  const without = check.slipsWithout.map((s) => el("tr", {}, [
    el("td", {}, [slipLink({ ...s, deleted: false, share: null, entryNag: s.nag, sisterFirm: false, manual: false })]), el("td", { text: formatMonth(s.registerMonth) }),
    el("td", { text: formatDate(s.entryDate) }), el("td", { class: "left", text: s.party }), el("td", { text: num(s.nag) }),
    el("td", {}, [el("button", { type: "button", class: "ghost small", text: Aawak_NOT_NEEDED_TEXT, title: "This slip never comes through the gate (moved inside the factory, re-slipped)",
      onclick: () => markNoAawak(s) })]),
  ]));
  const over = check.overlinked.map((s) => el("tr", {}, [
    el("td", {}, [slipLink({ ...s, deleted: false, share: null, entryNag: s.nag, sisterFirm: false, manual: false })]), el("td", { text: formatDate(s.entryDate) }),
    el("td", { class: "left", text: s.party }), el("td", { text: num(s.nag) }), el("td", { text: num(s.arrivedNag) }),
    el("td", {}, s.arrivalIds.flatMap((id, i) => [i ? ", " : "", el("a", { href: "#", class: "aawak-link", text: s.numbers[i], onclick: (event) => { event.preventDefault(); openArrival(id); } })])),
  ]));
  $("checkResult").replaceChildren(
    checkCard(NO_INWARD_TEXT, "Aawak rows with INW NO that are not in the inward register (yet), or with no INW NO.", ["Aawak NO", "DATE", "PARTY", "NAG", "INW NO", "SLIPS"], notLinked, "Every Aawak row found its slips."),
    checkCard("NAG differs", "The slips were found but their NAG adds up to something else: a part load, or a typo in NAG or INW NO.", ["Aawak NO", "DATE", "PARTY", "NAG", "SLIPS NAG", "SLIPS"], nagDiffers, "Every linked Aawak row has the slips' NAG."),
    checkCard(NO_Aawak_TEXT, check.checkSlipsFrom ? `Inward slips from ${formatDate(check.checkSlipsFrom)} on that are on no Aawak row.` : "There are no Aawak rows yet, so slips are not checked.",
      ["INW. NO.", "Register", "DATE", "PARTY", "NAG", ""], without, "Every inward slip has its Aawak row."),
    checkCard("Slip on more Aawak rows than its NAG", "", ["INW. NO.", "DATE", "PARTY", "NAG", "ARRIVED NAG", "Aawak"], over, "No slip came more often than its NAG."),
  );
}

function fillSlipsCellNode(a) {
  const span = el("span");
  fillSlipsCell(span, a);
  return span;
}

async function markNoAawak(slip) {
  try {
    await api(`/api/arrivals/no-arrival/${slip.entryId}`, { method: "PUT", json: { note: "Marked in Aawak → Check" } });
    toast(`INW. NO. ${slip.inwardNo} needs no Aawak ✓`, "ok", { id: "undoNoAawak", label: "Undo", run: async () => {
      await api(`/api/arrivals/no-arrival/${slip.entryId}`, { method: "DELETE" });
      await runCheck();
    } });
    await runCheck();
  } catch (error) {
    toast(errorText(error), "err");
  }
}

$("checkRun").addEventListener("click", () => runCheck().catch(showFatal));
for (const id of ["checkFrom", "checkTo"]) $(id).addEventListener("change", () => runCheck().catch(showFatal));
$("checkRelink").addEventListener("click", async () => {
  try {
    const result = await api("/api/arrivals/relink", { method: "POST" });
    toast(`Linked again ✓ ${num(result.arrivals)} rows: ${num(result.linked)} linked, ${num(result.nagDiffers)} NAG differs`);
    await runCheck();
  } catch (error) {
    toast(errorText(error), "err");
  }
});

// ---------- The Aawak screen ----------
subviewHandlers["aawak-new"] = prepareArrivalForm;
subviewHandlers["aawak-register"] = refreshAawakRegister;
subviewHandlers["aawak-totals"] = renderTotalsView;
subviewHandlers["aawak-check"] = runCheck;

async function showAawak() {
  fillNameLists();
  const active = document.querySelector('[id^="aawak-"].subview.active')?.id || "aawak-new";
  // Opening a row from another tab (or the import report) fills the register itself.
  if (active === "aawak-register" && ["arrival", "import"].includes(returnTrips.at(-1)?.kind)) return;
  await subviewHandlers[active]?.();
}

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

// ---------- Masters → Lorry walas ----------
async function renderLorryMasters() {
  aawakState.lorry = await api("/api/masters/transporters");
  const showInactive = $("showInactiveLorry").checked;
  const rows = aawakState.lorry.filter((t) => showInactive || t.active);
  const table = $("lorryTable");
  table.replaceChildren(
    el("thead", {}, [el("tr", {}, ["LORRY WALA", "Active", "Other spellings", "Own vehicle", "Aawak rows", "Last arrival"].map((t) => el("th", { text: t })))]),
    el("tbody", {}, rows.map((t) => {
      const tr = el("tr", { "data-lorry": t.name, class: t.active ? "" : "inactive" }, [
        el("td", { class: "left", text: t.name }), el("td", { text: t.active ? "Yes" : "No" }), el("td", { class: "left", text: t.otherSpellings.join(", ") }),
        el("td", { text: t.ownVehicle ? "Yes" : "" }), el("td", { text: num(t.arrivals) }), el("td", { text: t.lastArrival ? formatDate(t.lastArrival) : "" }),
      ]);
      tr.addEventListener("click", () => openLorryForm(t));
      return tr;
    })),
  );
  setTableEmpty(table, rows.length ? "" : "No lorry walas yet. Add them here, or import an Aawak workbook.");
  $("lorryCount").textContent = `${num(rows.length)} lorry walas`;
}

$("showInactiveLorry").addEventListener("change", () => renderLorryMasters().catch(showFatal));
$("addLorry").addEventListener("click", () => openLorryForm(null));
subviewHandlers["masters-lorry"] = renderLorryMasters;

function openLorryForm(lorry) {
  const t = lorry || { name: "", active: true, otherSpellings: [], ownVehicle: false, arrivals: 0 };
  markRow("lorryTable", "data-lorry", lorry ? lorry.name : null);
  const form = $("lorryForm");
  const name = el("input", { type: "text", id: "lf-name", maxlength: "100" });
  name.value = t.name;
  const active = el("input", { type: "checkbox", id: "lf-active" });
  active.checked = t.active;
  const own = el("input", { type: "checkbox", id: "lf-own" });
  own.checked = t.ownVehicle;
  const spellings = el("textarea", { id: "lf-spellings", rows: "3", placeholder: "One per line" });
  spellings.value = t.otherSpellings.join("\n");
  const merge = el("input", { type: "checkbox", id: "lf-merge" });
  const save = el("button", { type: "submit", id: "lf-save", text: lorry ? "Save changes" : "Add lorry wala" });
  const remove = lorry && !t.arrivals ? el("button", { type: "button", class: "secondary", id: "lf-delete", text: "Delete", onclick: async () => {
    try {
      await api(`/api/masters/transporter?name=${encodeURIComponent(t.name)}`, { method: "DELETE" });
      await Promise.all([loadMasters(), renderLorryMasters()]);
      await closeDrawer($("lorryDrawer"), true);
      toast(`Deleted ${t.name}`);
    } catch (error) {
      formMessage(form, errorsOf(error));
    }
  } }) : "";
  drawerForm(form, {
    key: `lorry:${t.name}`,
    title: lorry ? t.name : "Add a lorry wala",
    subtitle: lorry ? `${num(t.arrivals)} Aawak rows` : "",
    body: [
      section("Lorry wala", [fieldsGrid([field("LORRY WALA", name)], 1), el("div", { class: "checks" }, [checkbox(active, "Active (offered when typing Aawak rows)"),
        checkbox(own, "The party's own vehicle (not a hired lorry)")])]),
      section("Other spellings", [spellings], "Names the gate's workbook writes for this lorry wala; the Aawak import reads them as this one."),
      lorry ? section("Merge", [checkbox(merge, "If another lorry wala has the new name, move this one's Aawak rows to it")]) : "",
    ],
    actions: [save, remove, el("button", { type: "button", class: "ghost", text: "Close", onclick: () => closeDrawer($("lorryDrawer")) })],
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const saved = await api("/api/masters/transporter", { method: "POST", json: {
        originalName: lorry ? lorry.name : null, name: name.value, active: active.checked, ownVehicle: own.checked, merge: merge.checked,
        otherSpellings: spellings.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
      } });
      markSaved(form);
      await Promise.all([loadMasters(), renderLorryMasters()]);
      fillNameLists();
      openLorryForm(aawakState.lorry.find((x) => x.name === saved.name) || saved);
      toast(`Saved ${saved.name}`);
    } catch (error) {
      formMessage(form, errorsOf(error));
    } finally {
      save.disabled = false;
    }
  };
  openDrawer($("lorryDrawer"), name);
}

// ---------- Import → Aawak workbook ----------
async function sendAawakImport(commit) {
  const file = $("aawakImportFile").files[0];
  if (!file) { toast("Choose an Aawak workbook first.", "err"); return null; }
  const form = new FormData();
  form.append("file", file);
  form.append("month", $("aawakImportMonth").value);
  form.append("commit", commit ? "true" : "false");
  form.append("groups", $("aawakImportGroups").checked ? "true" : "false");
  return api("/api/import/aawak", { method: "POST", body: form });
}

function issueList(title, issues, kind = "") {
  if (!issues.length) return "";
  return el("details", { class: `report-list ${kind}`, ...(kind === "err" ? { open: "" } : {}) }, [el("summary", { text: `${title} (${num(issues.length)})` }),
    el("ul", {}, issues.map((i) => el("li", { text: i.row ? `Row ${i.row}: ${i.message}` : i.message })))]);
}

function renderAawakReport(report) {
  aawakState.importReport = report;
  const facts = [
    ["File", report.fileName], ["Aawak month", report.aawakMonth ? formatMonth(report.aawakMonth) : "—"], ["Rows", num(report.rows)], ["NAG", num(report.nag)],
    ["New rows", num(report.added)], ["Updated", num(report.updated)], ["Unchanged", num(report.unchanged)], ["Removed", num(report.removed)],
    ["Kept deleted", num(report.keptDeleted)], ["Typed in the app, kept", num(report.keptTyped)],
  ];
  if (report.links) facts.push(["Linked to slips", num(report.links.linked)], ["NAG differs", num(report.links.nagDiffers)],
    ["Slips not found", num(report.links.partlyLinked + report.links.notLinked)]);
  const heading = report.errors.length ? "Cannot import this file" : report.imported ? "Imported ✓" : report.upToDate ? "Already up to date: nothing new in this file" : "Checked: nothing is saved yet";
  const groups = report.groups.length ? el("details", { class: "report-list" }, [el("summary", { text: `Party groups in the workbook (${num(report.groups.length)})` }),
    el("ul", {}, report.groups.map((g) => el("li", { text: g.currentGroup ? `${g.party}: ${g.group} in the workbook, ${g.currentGroup} in the app (kept)`
      : `${g.party} → ${g.group}${g.applied ? " ✓ given" : " (tick the box above to give it)"}` })))]) : "";
  $("aawakImportResult").replaceChildren(el("div", { class: `report ${report.errors.length ? "err" : "ok"}` }, [
    el("h2", { text: heading }),
    el("dl", { class: "report-facts" }, facts.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })])),
    report.addedParties.length ? el("p", { text: `Parties added as inactive: ${report.addedParties.join(", ")}` }) : "",
    report.addedTransporters.length ? el("p", { text: `Lorry walas ${report.imported ? "added" : "to add"}: ${report.addedTransporters.join(", ")}` }) : "",
    groups,
    issueList("Errors", report.errors, "err"), issueList("Changes from the workbook", report.changes), issueList("Kept as in the app", report.kept),
    issueList("No longer in the workbook", report.notInWorkbook), issueList("Warnings", report.warnings, "warn"),
    report.imported ? el("button", { type: "button", class: "secondary", id: "aawakShowImported", text: "Show in Aawak register", onclick: async () => {
      aawakRowFilter.clear();
      showAawakSubview("register");
      returnTrips.push({ kind: "import", view: "import", scroll: [] });
      await switchView("aawak");
      returnTrips.pop();
      await fillAawakMonths(report.aawakMonth);
      aawakState.rowsKey = null;
      await renderAawakRegister();
    } }) : "",
  ]));
}

$("aawakImportFile").addEventListener("change", () => {
  $("aawakImportRun").disabled = true;
  $("aawakImportResult").replaceChildren();
});
$("aawakImportCheck").addEventListener("click", async () => {
  try {
    const report = await sendAawakImport(false);
    if (!report) return;
    renderAawakReport(report);
    $("aawakImportRun").disabled = report.errors.length > 0 || (report.upToDate && !report.groups.some((g) => !g.currentGroup));
  } catch (error) {
    toast(errorText(error), "err");
  }
});
$("aawakImportRun").addEventListener("click", async () => {
  $("aawakImportRun").disabled = true;
  try {
    const report = await sendAawakImport(true);
    if (!report) return;
    renderAawakReport(report);
    if (report.imported) {
      aawakState.rowsKey = null;
      await loadMasters();
      toast(`Imported ✓ ${formatMonth(report.aawakMonth)}: ${num(report.added)} new, ${num(report.updated)} updated`);
    }
  } catch (error) {
    toast(errorText(error), "err");
  }
});
