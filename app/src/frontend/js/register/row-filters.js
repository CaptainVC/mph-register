"use strict";

// Row filters of the Register and Party-wise screens.

// ---------- Row filters (the colour chips double as the legend) ----------
// Inclusions within a group are ORed; different groups are ANDed. Exclusions always veto a match.
const ROW_FILTERS = [
  { caption: "Dispatch", help: "Include any dispatch states to show, or exclude states to hide", filters: [
    { key: "pending", label: "Nothing", swatch: true, tip: "Nothing dispatched yet", test: (e) => e.status === "pending" },
    { key: "partial", label: "Partly", swatch: true, tip: "Partly dispatched: some still to send", test: (e) => e.status === "partial" },
    { key: "done", label: "Completed", swatch: true, tip: "Completed: nothing left to dispatch", test: (e) => e.status === "done" },
    { key: "over", label: "Over", swatch: true, tip: "Over-dispatched: more sent than NAG + TWO PART", test: (e) => e.status === "over" },
    { key: "allZero", label: "All zero", swatch: true, tip: ALL_ZERO_TIP, test: (e) => e.status === "allZero" },
  ] },
  { caption: "Bill", help: "Include any bill types to show, or exclude types to hide", filters: [
    { key: "billNo", label: "Bill no.", tip: "BILL NO. holds a saved bill number (click it to open that bill)", test: (e) => billKind(e) === "bill" },
    { key: "billBlank", label: "Blank", tip: "BILL NO. is empty and the party needs a bill", test: (e) => billKind(e) === "blank" },
    { key: "billNone", label: "No bill needed", tip: "The party is marked No bill needed in Masters, so BILL NO. stays empty", test: (e) => billKind(e) === "none" },
    { key: "billOther", label: "Other", tip: "BILL NO. holds something else, such as a note that it was billed outside the app", test: (e) => billKind(e) === "other" },
  ] },
  { caption: "Other", help: "Each included condition must match; any excluded condition hides the row", filters: [
    { key: "repair", label: "Repair", group: "repair", tip: "REP. is Yes: NETT THAN is 0 and it is never billed", test: (e) => e.repair },
    { key: "carried", label: "Carryover", group: "carried", swatch: true, tip: "Slip repeated from the previous month's register", test: (e) => e.carriedOver },
    { key: "balance", label: "Has balance", group: "balance", tip: "Still to dispatch: BALANCE is above 0, so some stock is still with you", test: (e) => e.balance > 0 },
    { key: "warning", label: "Has warning", group: "warning", swatch: true, tip: "Point at the row to read the warning", test: (e) => e.warnings.length > 0 },
    { key: "aawakNone", label: "No Aawak", group: "aawakNone", tip: "No Aawak row (gate arrival) was found for the slip", test: (e) => e.aawakState === "none" },
    { key: "linkCheck", label: "Check link", group: "linkCheck", tip: "An all-zero entry whose D.N. names a slip that was not found, or that is under another party", test: (e) => linkNeedsCheck(e) },
  ] },
  { caption: "Last import", help: "What the latest import of each month's inward workbook did: include New or Updated to see those entries", filters: [
    { key: "importAdded", label: "New", tip: "Added as a new row by the latest import of its month's workbook", test: (e) => e.lastImport?.action === "added" },
    { key: "importUpdated", label: "Updated", tip: "Changed by the latest import of a month's workbook (a later month's carryover rows can change an earlier entry). Click the Δ next to its INW. NO. to see what changed", test: (e) => e.lastImport?.action === "updated" },
  ] },
];

const ROW_FILTER_MODES = [
  { key: "any", label: "Any", help: "Do not filter on this category" },
  { key: "include", label: "Include", help: "Show matching rows" },
  { key: "exclude", label: "Exclude", help: "Hide matching rows" },
];

function rowFilterMenu(id, label, trigger, onPick) {
  const menu = el("div", { id, popover: "auto", class: "filter-menu", role: "menu", "aria-label": `${label} filter options` });
  const options = ROW_FILTER_MODES.map(({ key, label: name, help }) => el("button", {
    type: "button", role: "menuitemradio", class: "filter-option", tabindex: "-1", "aria-checked": "false",
    onclick: () => { menu.hidePopover(); trigger.focus(); onPick(key); },
  }, [el("span", { class: "filter-option-label", text: name }), el("span", { class: "filter-option-help", text: help })]));
  menu.append(el("div", { class: "filter-menu-title", text: label, "aria-hidden": "true" }), ...options);
  const select = (mode) => options.forEach((option, i) => option.setAttribute("aria-checked", String(ROW_FILTER_MODES[i].key === mode)));
  select("any");
  menu.addEventListener("beforetoggle", (event) => {
    trigger.setAttribute("aria-expanded", String(event.newState === "open"));
    if (event.newState === "open") {
      const chip = trigger.parentElement.getBoundingClientRect();
      menu.style.setProperty("--menu-left", `${chip.left}px`);
      menu.style.setProperty("--menu-top", `${chip.bottom + 4}px`);
      menu.style.setProperty("--menu-bottom", `${window.innerHeight - chip.top + 4}px`);
      menu.classList.toggle("opens-up", window.innerHeight - chip.bottom < 190 && chip.top > window.innerHeight - chip.bottom);
    }
  });
  menu.addEventListener("toggle", (event) => {
    if (event.newState === "open" && menu.matches(":popover-open") && !options.includes(document.activeElement)) {
      options.find((option) => option.getAttribute("aria-checked") === "true").focus();
    }
  });
  menu.addEventListener("keydown", (event) => {
    const index = options.indexOf(document.activeElement);
    switch (event.key) {
      case "ArrowDown": options[(index + 1) % options.length].focus(); break;
      case "ArrowUp": options[(index <= 0 ? options.length : index) - 1].focus(); break;
      case "Home": options[0].focus(); break;
      case "End": options.at(-1).focus(); break;
      case "Escape": menu.hidePopover(); trigger.focus(); break;
      // Let the normal tab order continue from the split button, not from inside the menu.
      case "Tab": menu.hidePopover(); trigger.focus(); return;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
  });
  trigger.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (!menu.matches(":popover-open")) trigger.click();
    options[event.key === "ArrowDown" ? 0 : options.length - 1].focus();
  });
  return { menu, select };
}

function rowFilters(container, onChange, toggle, definitions = ROW_FILTERS) {
  const badge = toggle.querySelector(".filter-toggle-count");
  toggle.addEventListener("click", () => {
    const open = container.classList.toggle("hidden") === false;
    toggle.setAttribute("aria-expanded", String(open));
  });
  const modes = new Map();
  const chips = [];
  const setMode = (key, mode) => {
    if (mode === "any") modes.delete(key);
    else modes.set(key, mode);
  };
  const groups = definitions.map(({ caption, help, filters }) => el("div", { class: "filter-group" }, [
    el("span", { class: "filter-caption", text: caption, title: help }),
    el("div", { class: "filter-chips" }, filters.map((filter) => {
      const id = `${container.id}-${filter.key}`;
      const count = el("span", { id: `${id}-count`, class: "chip-count", title: "Category matches before exclusions" });
      const button = el("button", { type: "button", class: "filter-chip", "data-filter": filter.key, "aria-pressed": "false",
        "aria-describedby": count.id, "aria-label": `${filter.label}: Any`, title: `${filter.tip}. Click to include.` },
      [el("span", { class: "filter-minus", text: "⊖", "aria-hidden": "true" }),
        ...(filter.swatch ? [el("i", { class: `swatch ${filter.key}`, "aria-hidden": "true" })] : []),
        el("span", { class: "chip-label", text: filter.label }), count]);
      button.addEventListener("click", () => {
        setMode(filter.key, modes.has(filter.key) ? "any" : "include");
        onChange();
      });
      const trigger = el("button", {
        type: "button", class: "filter-trigger", popovertarget: `${id}-menu`, "aria-haspopup": "menu",
        "aria-controls": `${id}-menu`, "aria-expanded": "false", "aria-label": `${filter.label} filter options`,
      });
      const { menu, select } = rowFilterMenu(`${id}-menu`, filter.label, trigger, (mode) => {
        setMode(filter.key, mode);
        onChange();
      });
      const chip = el("div", { class: "filter-split", "data-mode": "any" }, [button, trigger, menu]);
      chips.push({ filter, group: filter.group || caption, chip, button, count, select });
      return chip;
    })),
  ]));
  const summary = el("div", { class: "filter-summary", role: "status", "aria-atomic": "true" });
  const clear = el("button", { type: "button", class: "filter-clear off", text: "Clear filters",
    title: "Clear all include and exclude filters",
    onclick: () => {
      modes.clear();
      onChange();
      chips[0].button.focus();
    } });
  container.replaceChildren(...groups, el("div", { class: "filter-actions" }, [summary, clear]));

  let summaryText = "";
  const apply = (entries) => {
    const included = new Map();
    const excluded = [];
    for (const { filter, group } of chips) {
      const mode = modes.get(filter.key);
      if (mode === "include") included.set(group, [...(included.get(group) || []), filter]);
      else if (mode === "exclude") excluded.push(filter);
    }
    const passesIncludes = (entry, skipGroup) => {
      for (const [group, filters] of included) if (group !== skipGroup && !filters.some((f) => f.test(entry))) return false;
      return true;
    };
    // One pass over the entries counts every chip: all its matches, and those that also pass the other groups' includes.
    const totals = new Array(chips.length).fill(0);
    const counts = new Array(chips.length).fill(0);
    for (const e of entries) {
      let failed = null;
      for (const [group, filters] of included) {
        if (filters.some((f) => f.test(e))) continue;
        failed ??= new Set();
        failed.add(group);
      }
      for (let i = 0; i < chips.length; i++) {
        if (!chips[i].filter.test(e)) continue;
        totals[i]++;
        if (!failed || (failed.size === 1 && failed.has(chips[i].group))) counts[i]++;
      }
    }
    chips.forEach(({ filter, chip, button, count, select }, i) => {
      const n = counts[i];
      const mode = modes.get(filter.key) || "any";
      count.textContent = num(n);
      count.style.minWidth = `${num(totals[i]).length}ch`;
      if (chip.dataset.mode !== mode) {
        chip.dataset.mode = mode;
        button.setAttribute("aria-pressed", String(mode !== "any"));
        button.setAttribute("aria-label", `${filter.label}: ${ROW_FILTER_MODES.find((option) => option.key === mode).label}`);
        button.title = `${filter.tip}. ${mode === "any" ? "Click to include." : "Click to clear this filter."}`;
        select(mode);
      }
      chip.dataset.zero = String(mode === "any" && n === 0);
    });
    const nextSummary = excluded.length ? `Excluding: ${excluded.map((filter) => filter.label).join(", ")}` : "";
    if (summaryText !== nextSummary) {
      summaryText = nextSummary;
      summary.textContent = nextSummary;
      summary.title = nextSummary;
    }
    clear.classList.toggle("off", !modes.size);
    badge.textContent = num(modes.size);
    badge.classList.toggle("hidden", !modes.size);
    return modes.size ? entries.filter((e) => passesIncludes(e) && !excluded.some((filter) => filter.test(e))) : entries;
  };
  apply.clear = () => modes.clear();
  // Which filters are set, so a screen can tell when nothing changed since it was drawn.
  apply.signature = () => [...modes].map(([key, mode]) => `${key}:${mode}`).join(",");
  // Shows only the rows matching these filters (with the filter bar open, so it is clear why).
  apply.only = (keys) => {
    modes.clear();
    keys.forEach((key) => modes.set(key, "include"));
    container.classList.remove("hidden");
    toggle.setAttribute("aria-expanded", "true");
  };
  return apply;
}
