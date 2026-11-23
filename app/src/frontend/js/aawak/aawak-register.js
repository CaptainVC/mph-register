"use strict";

// Aawak → Register: the rows of the chosen month, editing, deleting and restoring them.

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
// Same chips as the inward register (rowFilters in js/register/row-filters.js): include or exclude, ORed within a group and ANDed between groups.
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
// A long table is drawn again once typing pauses, not on every key; a short one at once.
let aawakSearchTimer = 0;
$("aawakSearch").addEventListener("input", () => {
  clearTimeout(aawakSearchTimer);
  const draw = () => renderAawakRegister({ reuse: true }).catch(showFatal);
  if (aawakState.rows.length < SEARCH_DELAY_FROM_ROWS) draw();
  else aawakSearchTimer = setTimeout(draw, 150);
});

async function fillAawakMonths(month) {
  const months = (await api("/api/arrivals/months")).map((m) => ({ month: m.month, entries: m.arrivals }));
  if (month) {
    if (!months.some((m) => m.month === month)) months.unshift({ month, entries: 0 });
    aawakPeriod.show(months, month);
  } else aawakPeriod.fill(months);
}

// Each row's search text, worked out once (a saved row is a new object, so it is worked out again).
const aawakSearchText = new WeakMap();
function shownArrivals() {
  const tokens = normalize($("aawakSearch").value).split(" ").filter(Boolean);
  const months = $("aawakMonth").values;
  const searched = aawakState.rows.filter((a) => {
    if (!aawakPeriod.matches(a.aawakMonth) || (months.length && !months.includes(a.aawakMonth))) return false;
    if (!tokens.length) return true;
    let text = aawakSearchText.get(a);
    if (text === undefined) {
      text = normalize([a.number, a.party, a.group, a.transporter, a.inwardText, a.note, ...a.refs, formatDate(a.arrivalDate)].join(" "));
      aawakSearchText.set(a, text);
    }
    return tokens.every((t) => text.includes(t));
  });
  return aawakRowFilter(searched);
}

let aawakRenderVersion = 0;
async function renderAawakRegister({ reuse = false } = {}) {
  clearTimeout(aawakSearchTimer);
  const months = $("aawakMonth").values;
  // One month is asked for by name; several are read together and cut down in shownArrivals. Only one financial year is
  // read when the months (or the year picked with no month) are all in it.
  const years = new Set(months.map(financialYearOf));
  const year = months.length ? (years.size === 1 ? [...years][0] : "") : aawakPeriod.year || "";
  const path = months.length === 1 ? `/api/arrivals?month=${encodeURIComponent(months[0])}`
    : year ? `/api/arrivals?fy=${encodeURIComponent(year)}` : "/api/arrivals";
  const key = `${months.join(",")}|${path}`;
  if (!reuse || aawakState.rowsKey !== key) {
    // Only the newest read draws; a redraw from the rows in hand (a search or filter) meanwhile does not cancel it.
    const version = ++aawakRenderVersion;
    const rows = await api(path);
    if (version !== aawakRenderVersion) return;
    aawakState.rows = rows;
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
  document.body.dataset.aawakSub = sub;
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
