"use strict";

let dropdownId = 0;
let openDropdown = null;
const dropdownControls = new WeakMap();

function createDropdownList(control, { onPick, searchable = false }) {
  const id = `dropdown-list-${++dropdownId}`;
  const list = el("ul", { id, class: "combo-list", role: "listbox", popover: "manual", ...(searchable ? {} : { "data-dropdown-options": "" }) });
  let choices = [];
  let active = -1;

  control.setAttribute("role", "combobox");
  control.setAttribute("aria-expanded", "false");
  control.setAttribute("aria-controls", id);
  if (searchable) {
    control.setAttribute("aria-autocomplete", "list");
    control.setAttribute("autocomplete", "off");
    control.dataset.suggestions = "";
  }

  function isOpen() { return list.matches(":popover-open"); }

  function highlight(index) {
    list.children[active]?.classList.remove("highlight");
    active = index;
    const option = index < 0 ? null : list.children[index];
    if (!option) {
      control.removeAttribute("aria-activedescendant");
      return;
    }
    option.classList.add("highlight");
    control.setAttribute("aria-activedescendant", option.id);
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  }

  function close() {
    if (isOpen()) list.hidePopover();
    control.setAttribute("aria-expanded", "false");
    control.removeAttribute("aria-activedescendant");
    if (openDropdown?.list === list) openDropdown = null;
  }

  function position() {
    const rect = control.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    if (!control.isConnected || control.disabled || !rect.width || rect.bottom <= 0 || rect.top >= height || rect.right <= 0 || rect.left >= width) {
      close();
      return;
    }
    const below = height - rect.bottom - 8;
    const above = rect.top - 8;
    const listWidth = Math.min(width - 16, Math.max(rect.width, searchable ? 220 : 140));
    list.style.minWidth = `${listWidth}px`;
    list.style.maxWidth = `${width - 16}px`;
    list.style.maxHeight = "320px";
    const flip = below < list.offsetHeight + 4 && above > below;
    list.style.maxHeight = `${Math.max(0, Math.min(320, (flip ? above : below) - 4))}px`;
    list.style.top = `${flip ? rect.top - list.offsetHeight - 4 : rect.bottom + 4}px`;
    list.style.left = `${Math.max(8, Math.min(rect.left, width - list.offsetWidth - 8))}px`;
  }

  function show(items, index = 0) {
    if (!control.isConnected || control.disabled) return;
    if (!isOpen()) {
      openDropdown?.close();
      if (list.previousElementSibling !== control) control.after(list);
      list.showPopover();
      control.setAttribute("aria-expanded", "true");
      openDropdown = { control, list, close, position };
    }
    choices = items;
    active = -1;
    list.replaceChildren(...(choices.length ? choices.map((item, i) => el("li", {
      id: `${id}-${i}`, role: "option", "aria-selected": String(Boolean(item.selected)),
      ...(item.disabled ? { "aria-disabled": "true" } : {}), "data-value": item.value,
    }, [item.label, ...(item.tag ? [el("span", { class: "tag", text: item.tag })] : []),
      ...(item.hint ? [el("span", { class: "hint", text: item.hint })] : [])]))
      : [el("li", { class: "empty", role: "presentation", text: "No match" })]));
    window.translateUi(list);
    position();
    if (isOpen()) highlight(index);
  }

  function move(step, from = active) {
    for (let index = from + step; index >= 0 && index < choices.length; index += step) {
      if (!choices[index].disabled) {
        highlight(index);
        return;
      }
    }
  }

  function pick(index = active, source = "click") {
    const item = choices[index];
    if (!item || item.disabled) return false;
    close();
    onPick(item, source);
    return true;
  }

  control.addEventListener("blur", close);
  list.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch" && event.target.closest('[role="option"]')) event.preventDefault();
  });
  list.addEventListener("mousedown", (event) => event.preventDefault());
  list.addEventListener("click", (event) => {
    const option = event.target.closest('[role="option"]');
    if (option) pick([...list.children].indexOf(option));
  });
  return { isOpen, show, close, move, pick, highlight };
}

document.addEventListener("pointerdown", (event) => {
  if (openDropdown && !openDropdown.control.contains(event.target) && !openDropdown.list.contains(event.target)) openDropdown.close();
}, true);
window.addEventListener("resize", () => openDropdown?.position());
window.addEventListener("scroll", (event) => {
  if (event.target !== openDropdown?.list) openDropdown?.position();
}, true);

function setupDropdown(control, options = [], value, { enterOpens = true } = {}) {
  control.dataset.dropdown = "";
  if (!control.id) control.id = `dropdown-${dropdownId + 1}`;
  const state = { options, value: "" };
  const label = el("span", { class: "dropdown-value" });
  control.replaceChildren(label);
  const popup = createDropdownList(control, {
    onPick: ({ value }) => {
      if (value === control.value) return;
      control.value = value;
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    },
  });
  // Programmatic selections update the label but don't emit user input/change events.
  Object.defineProperty(control, "value", {
    get: () => state.value,
    set: (next) => {
      const option = state.options.find(([v]) => v === String(next));
      state.value = option?.[0] ?? "";
      label.textContent = option?.[1] ?? "";
    },
  });
  control.value = value ?? options[0]?.[0] ?? "";

  function open(direction = 1) {
    typed = "";
    const selected = state.options.findIndex(([v, , disabled]) => v === control.value && !disabled);
    popup.show(state.options.map(([value, label, disabled]) => ({ value, label, disabled, selected: value === control.value })), selected);
    if (selected < 0) popup.move(direction, direction > 0 ? -1 : state.options.length);
  }

  let typed = "";
  let lastKeyAt = 0;
  control.addEventListener("click", () => { if (popup.isOpen()) popup.close(); else open(); });
  control.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    const { key } = event;
    const expanded = popup.isOpen();
    if (key === "Enter" || key === " ") {
      if (!expanded && key === "Enter" && !enterOpens) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (expanded) popup.pick(); else open();
    } else if (key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      popup.close();
    } else if (key === "ArrowDown" || key === "ArrowUp" || (expanded && (key === "Home" || key === "End"))) {
      event.preventDefault();
      const direction = key === "ArrowUp" || key === "End" ? -1 : 1;
      if (!expanded) open(direction);
      else if (key === "Home" || key === "End") popup.move(direction, direction > 0 ? -1 : state.options.length);
      else popup.move(direction);
    } else if (expanded && key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      typed = (now - lastKeyAt < 700 ? typed : "") + key.toLowerCase();
      lastKeyAt = now;
      const index = state.options.findIndex(([, text, disabled]) => !disabled && (window.t?.(text) ?? text).toLowerCase().startsWith(typed));
      if (index >= 0) popup.highlight(index);
    }
  });
  dropdownControls.set(control, { state, open, popup });
  return control;
}

function dropdownOf(options, value, props = {}, behavior) {
  return setupDropdown(el("button", { type: "button", ...props }), options, value, behavior);
}

function setDropdownOptions(control, options, value = options[0]?.[0] ?? "") {
  const { state, popup } = dropdownControls.get(control);
  popup.close();
  state.options = options;
  control.value = value;
}

function openDropdownControl(control) {
  dropdownControls.get(control).open();
}

function textSuggestions(names, text) {
  const query = text.trim().toLowerCase();
  return names.filter((name) => name.toLowerCase().includes(query)).map((name) => ({ value: name, label: name }));
}

function attachSuggestions(input, suggest, {
  onPick, acceptOnTab, handleEnter = true, cancelOnEscape = false, requireNavigation = false, hideWhenEmpty = false,
} = {}) {
  const popup = createDropdownList(input, {
    searchable: true,
    onPick: (item, source) => {
      input.value = item.value;
      onPick?.(item, source);
    },
  });
  // With hideWhenEmpty there is no "No match" row: the list only shows when it has something to offer.
  const show = (choices, index) => {
    if (hideWhenEmpty && !choices.length) popup.close();
    else popup.show(choices, index);
  };
  const open = () => show(suggest(input.value), requireNavigation ? -1 : 0);
  input.addEventListener("click", () => { if (!popup.isOpen()) open(); });
  input.addEventListener("input", open);
  input.addEventListener("keydown", (event) => {
    const expanded = popup.isOpen();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!expanded) {
        const choices = suggest(input.value);
        show(choices, event.key === "ArrowDown" ? 0 : choices.length - 1);
      } else popup.move(event.key === "ArrowDown" ? 1 : -1);
    } else if (expanded && event.key === "Escape") {
      popup.close();
      if (!cancelOnEscape) {
        event.preventDefault();
        event.stopPropagation();
      }
    } else if (expanded && input.value.trim()) {
      if (event.key === "Enter" && popup.pick(undefined, "Enter") && handleEnter) {
        event.preventDefault();
        event.stopPropagation();
      } else if (event.key === "Tab" && acceptOnTab?.()) {
        popup.pick(undefined, "Tab");
      }
    }
  });
  return popup;
}
