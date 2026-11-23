"use strict";

// The Party-wise screen: entries grouped by party and finish.

const partyFilterCombo = createCombo($("partyFilterCombo"), () => state.masters.parties, {
  onPick: () => renderPartywise(),
});
$("partyFilter").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); renderPartywise(); } });
// Editing the text away from the party being shown (clearing it, or typing past its name) drops that filter at once.
$("partyFilter").addEventListener("input", () => {
  const typed = $("partyFilter").value.trim().toLowerCase();
  if (partywiseLoaded.party && typed !== partywiseLoaded.party.toLowerCase()) renderPartywise();
});
$("clearPartyFilter").addEventListener("click", () => { $("partyFilter").value = ""; renderPartywise(); });
$("partyViewMonth").addEventListener("input", renderPartywise);

const partyRowFilter = rowFilters($("partyFilters"), () => renderPartywise({ reuse: true }), $("partyFiltersToggle"));
let partywiseLoaded = { key: null, party: "", entries: [] };
let partyRenderVersion = 0;
const expandedParties = new Set();
const collapsedFinishes = new Set();
// Re-applies open/closed state to the rows on screen; renderPartywise points it at the current table.
let applyPartyVisibility = () => {};
let shownParties = [];
let shownFinishKeys = [];
// One button: offers "Collapse all" once everything shown is open, otherwise "Expand all".
const allPartiesOpen = () => shownParties.length > 0 && shownParties.every((name) => expandedParties.has(name))
  && !shownFinishKeys.some((key) => collapsedFinishes.has(key));
function syncToggleAllParties() {
  const button = $("toggleAllParties");
  const open = allPartiesOpen();
  button.textContent = open ? "Collapse all" : "Expand all";
  button.title = open ? "Close every party" : "Open every party and finish";
  button.disabled = shownParties.length === 0;
}
$("toggleAllParties").addEventListener("click", () => {
  if (allPartiesOpen()) {
    for (const name of shownParties) expandedParties.delete(name);
  } else {
    for (const name of shownParties) expandedParties.add(name);
    for (const key of shownFinishKeys) collapsedFinishes.delete(key);
  }
  applyPartyVisibility();
});

// Ticking a filter re-uses the rows already loaded; anything else reads them again.
async function renderPartywise(options) {
  const version = ++partyRenderVersion;
  partyTableStale = false;
  const months = $("partyViewMonth").values;
  const party = partyFilterCombo.canonical();
  const query = party ? `&party=${encodeURIComponent(party.name)}` : "";
  // One month is asked for by name; several are read together (to keep the party order) and cut down here. Only one
  // financial year is read when the months (or the year picked with no month) are all in it.
  const years = new Set(months.map(financialYearOf));
  const year = months.length ? (years.size === 1 ? [...years][0] : "") : partyPeriodFilter.year || "";
  const scope = months.length === 1 ? `month=${encodeURIComponent(months[0])}` : year ? `fy=${encodeURIComponent(year)}` : "month=";
  const key = `${months}|${scope}${query}`;
  if (options?.reuse !== true || partywiseLoaded.key !== key) {
    const loaded = await api(`/api/partywise?${scope}${query}`);
    if (version !== partyRenderVersion) return;
    partywiseLoaded = { key, party: party ? party.name : "", entries: months.length > 1 ? loaded.filter((e) => months.includes(e.registerMonth)) : loaded };
  }
  const all = partywiseLoaded.entries.filter((e) => partyPeriodFilter.matches(e.registerMonth));
  const entries = partyRowFilter(all);
  const body = el("tbody");
  // All-zero slips have no finish; they close each party in a group of their own instead of "(no finish)".
  const ALL_ZERO_GROUP = "\u0000allZero";
  const groupSummaryRow = (kind, name, list, toggle, allZero = false) => {
    const s = (f) => list.reduce((t, e) => t + f(e), 0);
    const balance = s((e) => e.balance);
    const balanceTone = balance > 0 ? " is-balance" : balance < 0 ? " is-over" : " is-clear";
    const metrics = [
      ["THAN", s((e) => e.than), ""],
      ["NETT THAN", s((e) => e.nettThan), ""],
      ["NAG", s((e) => e.nag), ""],
      ["JAWAK", s((e) => e.dispatched), ""],
      ["BALANCE", balance, balanceTone],
    ];
    const isParty = kind === "group";
    const nameClass = isParty ? "group-name party-name" : (name && !allZero ? "group-name finish-name" : "group-name group-name-empty");
    const countText = list.length === 1 ? "1 entry" : `${num(list.length)} entries`;
    const identity = el("span", { class: "group-identity" }, [
      el("span", { class: "group-chevron", "aria-hidden": "true" }),
      el("span", { class: "group-kicker", text: isParty ? "Party" : allZero ? "Slips" : "Finish" }),
      el("span", { class: nameClass, text: allZero ? "All zero" : name || "(no finish)", ...(allZero ? { title: ALL_ZERO_TIP } : {}) }),
      el("span", { class: "group-count", text: countText }),
    ]);
    const stats = el("span", { class: "group-stats" }, metrics.map(([label, value, tone]) =>
      el("span", { class: `group-stat${tone}` }, [
        el("span", { class: "group-stat-label", text: label }),
        el("b", { class: "group-stat-value", text: num(value) }),
      ])));
    return el("tr", { class: kind, onclick: toggle }, [
      el("td", { colspan: String(COLUMNS.length) }, [
        el("button", { type: "button", class: "group-bar", "aria-expanded": "false" }, [identity, stats]),
      ]),
    ]);
  };
  const parties = new Map();
  for (const entry of entries) {
    if (!parties.has(entry.party)) parties.set(entry.party, []);
    parties.get(entry.party).push(entry);
  }
  const visibilityUpdaters = [];
  const finishKeys = [];
  for (const [partyName, partyEntries] of parties) {
    const finishGroups = [];
    const updateVisibility = () => {
      const partyExpanded = expandedParties.has(partyName);
      partyRow.querySelector("button").setAttribute("aria-expanded", String(partyExpanded));
      for (const { row, entryRows, finishKey } of finishGroups) {
        const finishExpanded = !collapsedFinishes.has(finishKey);
        row.hidden = !partyExpanded;
        row.querySelector("button").setAttribute("aria-expanded", String(finishExpanded));
        for (const entry of entryRows) entry.hidden = !partyExpanded || !finishExpanded;
      }
    };
    const partyRow = groupSummaryRow("group", partyName, partyEntries, () => {
      if (expandedParties.has(partyName)) expandedParties.delete(partyName);
      else expandedParties.add(partyName);
      updateVisibility();
      syncToggleAllParties();
    });
    body.append(partyRow);
    const finishes = new Map();
    for (const entry of partyEntries) {
      const group = entry.status === "allZero" ? ALL_ZERO_GROUP : entry.finish;
      if (!finishes.has(group)) finishes.set(group, []);
      finishes.get(group).push(entry);
    }
    for (const [finishName, finishEntries] of finishes) {
      const finishKey = JSON.stringify([partyName, finishName]);
      finishKeys.push(finishKey);
      const allZero = finishName === ALL_ZERO_GROUP;
      const row = groupSummaryRow("subgroup", allZero ? "" : finishName, finishEntries, () => {
        if (collapsedFinishes.has(finishKey)) collapsedFinishes.delete(finishKey);
        else collapsedFinishes.add(finishKey);
        updateVisibility();
        syncToggleAllParties();
      }, allZero);
      const entryRows = finishEntries.map(entryRow);
      finishGroups.push({ row, entryRows, finishKey });
      body.append(row, ...entryRows);
    }
    updateVisibility();
    visibilityUpdaters.push(updateVisibility);
  }
  shownParties = [...parties.keys()];
  shownFinishKeys = finishKeys;
  applyPartyVisibility = () => { visibilityUpdaters.forEach((update) => update()); syncToggleAllParties(); };
  syncToggleAllParties();
  $("partyTable").replaceChildren(headerRow(), body);
  pruneEntryRows();
  setTableEmpty($("partyTable"), entries.length ? "" : all.length ? "No entries match the filters."
    : months.length ? `No entries in ${months.length > 1 ? "these months" : "this month"}.` : partyPeriodFilter.year ? "No entries in this financial year." : "No entries.");
  const partyCountEl = $("partyCount");
  partyCountEl.textContent = `${entries.length === all.length ? num(all.length) : `${num(entries.length)} of ${num(all.length)}`} entries${party ? ` for ${party.name}` : ""}`;
  partyCountEl.classList.toggle("filtered", entries.length !== all.length || Boolean(party));
  renderTotals($("partyTotals"), entries);
}
