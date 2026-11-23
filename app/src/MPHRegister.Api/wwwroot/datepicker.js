"use strict";

// The app's own calendar for every date and month box, instead of the browser's small one. A box can be typed in
// (26/10/2026, 26102026, 26 Oct 2026 or November 2026) or picked from a large calendar. Each box keeps the same
// `.value` as a native one ("2026-10-26" for a date, "2026-10" for a month), so the screens read and set it as before.
// Boxes made with el("input", { type: "date" | "month" }) and the ones in index.html are upgraded by enhanceDateInput.

const PICKER_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PICKER_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pickerNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

const pickerPad = (n, width = 2) => String(n).padStart(width, "0");
const pickerDaysIn = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

function pickerMonthFromWord(word) {
  const w = word.toLowerCase();
  return w.length < 3 ? 0 : PICKER_MONTHS.findIndex((name) => name.toLowerCase().startsWith(w)) + 1;
}

function pickerDate(year, month, day) {
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > pickerDaysIn(year, month)) return "";
  return `${pickerPad(year, 4)}-${pickerPad(month)}-${pickerPad(day)}`;
}

// Typed text to "yyyy-mm-dd", or "" when it is not a real date. A year needs all four digits, so a half-typed
// 26/10/20 is not taken for the year 2020.
function parsePickerDate(text) {
  const s = text.trim();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return pickerDate(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[\/\-.\s]+(\d{1,2})[\/\-.\s]+(\d{4})$/.exec(s))) return pickerDate(+m[3], +m[2], +m[1]);
  if ((m = /^(\d{2})(\d{2})(\d{4})$/.exec(s))) return pickerDate(+m[3], +m[2], +m[1]);
  if ((m = /^(\d{1,2})[\s\/\-.,]*([A-Za-z]{3,9})[\s\/\-.,]*(\d{4})$/.exec(s))) return pickerDate(+m[3], pickerMonthFromWord(m[2]), +m[1]);
  return "";
}

// Typed text to "yyyy-mm", or "" when it is not a real month.
function parsePickerMonth(text) {
  const s = text.trim();
  let year;
  let month;
  let m;
  if ((m = /^(\d{4})-(\d{1,2})$/.exec(s))) [year, month] = [+m[1], +m[2]];
  else if ((m = /^(\d{1,2})[\/\-.\s]+(\d{4})$/.exec(s)) || (m = /^(\d{2})(\d{4})$/.exec(s))) [year, month] = [+m[2], +m[1]];
  else if ((m = /^([A-Za-z]{3,9})[\s\/\-.,]*(\d{4})$/.exec(s))) [year, month] = [+m[2], pickerMonthFromWord(m[1])];
  else return "";
  return month >= 1 && month <= 12 && year >= 1000 ? `${pickerPad(year, 4)}-${pickerPad(month)}` : "";
}

const showPickerDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const showPickerMonth = (iso) => (iso ? `${PICKER_MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : "");

function pickerToday() {
  const now = new Date();
  return `${pickerPad(now.getFullYear(), 4)}-${pickerPad(now.getMonth() + 1)}-${pickerPad(now.getDate())}`;
}

function enhanceDateInput(input) {
  const kind = input.type;
  if (input.dataset.picker || (kind !== "date" && kind !== "month")) return;
  const isDate = kind === "date";
  const parse = isDate ? parsePickerDate : parsePickerMonth;
  const show = isDate ? showPickerDate : showPickerMonth;
  const nativeText = () => pickerNativeValue.get.call(input);
  const initial = input.value;

  input.type = "text";
  input.dataset.picker = kind;
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");
  input.setAttribute("aria-haspopup", "dialog");
  input.setAttribute("aria-expanded", "false");
  if (!input.placeholder) input.placeholder = isDate ? "DD/MM/YYYY" : "Month YYYY";

  let lastGood = parse(initial);
  let popup = null;
  let view = isDate ? "days" : "months";
  let shownYear = 0;
  let shownMonth = 0;
  let cursor = null;
  let navigated = false;

  const message = () => (isDate
    ? "Type the date like 26/10/2026, or pick it from the calendar."
    : "Type the month like November 2026, or pick it from the calendar.");

  function validate() {
    const text = nativeText().trim();
    const iso = parse(text);
    let problem = "";
    if (text && !iso) problem = message();
    else if (iso && input.min && iso < input.min) problem = `Pick a date on or after ${show(input.min)}.`;
    else if (iso && input.max && iso > input.max) problem = `Pick a date on or before ${show(input.max)}.`;
    input.setCustomValidity(problem);
    if (iso) lastGood = iso;
  }

  // Programmatic assignments show the date the way people read it and send no events, like a native box.
  Object.defineProperty(input, "value", {
    configurable: true,
    get: () => parse(nativeText()),
    set(next) {
      lastGood = parse(String(next ?? ""));
      pickerNativeValue.set.call(input, show(lastGood));
      validate();
    },
  });
  input.value = initial;

  // Leaving the box tidies what was typed; text that is not a date goes back to the last good date.
  function settle() {
    const text = nativeText().trim();
    const iso = parse(text);
    if (iso) {
      pickerNativeValue.set.call(input, show(iso));
    } else if (text) {
      pickerNativeValue.set.call(input, show(lastGood));
      if (typeof toast === "function") toast(message(), "err");
    }
    validate();
  }

  const isOpen = () => Boolean(popup?.matches(":popover-open"));
  const outside = (iso) => Boolean((input.min && iso < input.min.slice(0, iso.length)) || (input.max && iso > input.max.slice(0, iso.length)));

  function close() {
    if (isOpen()) popup.hidePopover();
    input.setAttribute("aria-expanded", "false");
    if (openDropdown?.list === popup) openDropdown = null;
  }

  function position() {
    const rect = input.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    if (!input.isConnected || input.disabled || !rect.width || rect.bottom <= 0 || rect.top >= height || rect.right <= 0 || rect.left >= width) {
      close();
      return;
    }
    popup.style.maxHeight = "";
    const below = height - rect.bottom - 12;
    const above = rect.top - 12;
    const flip = below < popup.offsetHeight && above > below;
    popup.style.maxHeight = `${Math.max(220, flip ? above : below)}px`;
    popup.style.top = `${flip ? rect.top - popup.offsetHeight - 4 : rect.bottom + 4}px`;
    popup.style.left = `${Math.max(8, Math.min(rect.left, width - popup.offsetWidth - 8))}px`;
  }

  function commit(iso) {
    const before = input.value;
    input.value = iso;
    close();
    if (iso !== before) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  const cell = (label, act, value, extra = {}) => el("button", {
    type: "button", tabindex: "-1", "data-act": act, "data-value": value, ...extra, text: label,
  });

  function render() {
    const selected = input.value;
    const today = pickerToday();
    const stepName = view === "days" ? "month" : "year";
    const head = el("div", { class: "picker-head" }, [
      cell("‹", "prev", "", { class: "picker-nav", "aria-label": `Previous ${stepName}` }),
      el("div", { class: "picker-title" }, view === "years"
        ? [el("span", { text: `${shownYear - 4} – ${shownYear + 7}` })]
        : [
          ...(isDate ? [cell(PICKER_MONTHS[shownMonth - 1], "show-months", "", { class: "picker-jump" })] : []),
          cell(String(shownYear), "show-years", "", { class: "picker-jump" }),
        ]),
      cell("›", "next", "", { class: "picker-nav", "aria-label": `Next ${stepName}` }),
    ]);

    let body;
    if (view === "days") {
      const first = new Date(Date.UTC(shownYear, shownMonth - 1, 1));
      const start = new Date(first.getTime() - first.getUTCDay() * 86400000);
      const days = [];
      for (let i = 0; i < 42; i++) {
        const day = new Date(start.getTime() + i * 86400000);
        const iso = pickerDate(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
        const classes = ["picker-day"];
        if (day.getUTCMonth() + 1 !== shownMonth) classes.push("out");
        if (iso === today) classes.push("today");
        if (iso === selected) classes.push("selected");
        if (navigated && iso === cursor) classes.push("cursor");
        days.push(cell(String(day.getUTCDate()), "day", iso, { class: classes.join(" "), ...(outside(iso) ? { disabled: "" } : {}), ...(iso === selected ? { "aria-current": "date" } : {}) }));
      }
      body = el("div", { class: "picker-grid days" }, [
        ...PICKER_DAYS.map((name) => el("span", { class: "picker-weekday", text: name })),
        ...days,
      ]);
    } else if (view === "months") {
      body = el("div", { class: "picker-grid choices" }, PICKER_MONTHS.map((name, i) => {
        const iso = `${pickerPad(shownYear, 4)}-${pickerPad(i + 1)}`;
        const classes = ["picker-choice"];
        if (isDate ? iso === selected.slice(0, 7) : iso === selected) classes.push("selected");
        if (iso === today.slice(0, 7)) classes.push("today");
        if (navigated && !isDate && iso === cursor) classes.push("cursor");
        return cell(name.slice(0, 3), "month", iso, { class: classes.join(" "), "aria-label": `${name} ${shownYear}`, ...(outside(iso) ? { disabled: "" } : {}) });
      }));
    } else {
      body = el("div", { class: "picker-grid choices" }, Array.from({ length: 12 }, (_, i) => {
        const year = shownYear - 4 + i;
        const classes = ["picker-choice"];
        if (String(year) === selected.slice(0, 4)) classes.push("selected");
        if (String(year) === today.slice(0, 4)) classes.push("today");
        return cell(String(year), "year", String(year), { class: classes.join(" "), ...(outside(pickerPad(year, 4)) ? { disabled: "" } : {}) });
      }));
    }

    const todayKey = isDate ? today : today.slice(0, 7);
    const foot = el("div", { class: "picker-foot" }, [
      ...(input.required ? [] : [cell("Clear", "clear", "", { class: "picker-link" })]),
      cell(isDate ? "Today" : "This month", "today", todayKey, { class: "picker-link", ...(outside(todayKey) ? { disabled: "" } : {}) }),
    ]);
    popup.replaceChildren(head, body, foot);
    window.translateUi?.(popup);
  }

  function showFrom(iso) {
    const [y, m] = iso.split("-");
    shownYear = +y;
    shownMonth = +m;
  }

  function open() {
    if (!input.isConnected || input.disabled || input.readOnly) return;
    if (!popup) {
      popup = el("div", { class: "picker", popover: "manual", role: "dialog", "aria-label": isDate ? "Choose a date" : "Choose a month" });
      popup.addEventListener("mousedown", (event) => event.preventDefault());
      popup.addEventListener("click", onClick);
    }
    if (!isOpen()) {
      openDropdown?.close();
      if (input.nextElementSibling !== popup) input.after(popup);
      const selected = input.value;
      cursor = selected || (isDate ? pickerToday() : pickerToday().slice(0, 7));
      showFrom(cursor);
      view = isDate ? "days" : "months";
      navigated = false;
      popup.showPopover();
      input.setAttribute("aria-expanded", "true");
      openDropdown = { control: input, list: popup, close, position };
    }
    render();
    position();
  }

  function onClick(event) {
    const button = event.target.closest("button[data-act]");
    if (!button || button.disabled) return;
    const { act, value } = button.dataset;
    navigated = false;
    if (act === "day" || act === "today") commit(value);
    else if (act === "clear") commit("");
    else if (act === "month") {
      if (isDate) { showFrom(`${value}-01`); view = "days"; render(); } else commit(value);
    } else if (act === "year") {
      shownYear = +value;
      view = isDate ? "days" : "months";
      render();
    } else if (act === "show-months") { view = "months"; render(); }
    else if (act === "show-years") { view = "years"; render(); }
    else {
      const sign = act === "next" ? 1 : -1;
      if (view === "days") {
        shownMonth += sign;
        if (shownMonth < 1) { shownMonth = 12; shownYear--; } else if (shownMonth > 12) { shownMonth = 1; shownYear++; }
      } else shownYear += sign * (view === "years" ? 12 : 1);
      render();
    }
    position();
  }

  // Moves the keyboard highlight by days and/or months, keeping the picture on it.
  function moveCursor(days, months) {
    const [y, m, d] = (isDate ? cursor : `${cursor}-01`).split("-").map(Number);
    let next;
    if (days) {
      const moved = new Date(Date.UTC(y, m - 1, d + days));
      next = pickerDate(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
    } else {
      const total = y * 12 + (m - 1) + months;
      const year = Math.floor(total / 12);
      const month = (total % 12) + 1;
      next = pickerDate(year, month, Math.min(d, pickerDaysIn(year, month)));
    }
    if (!next || outside(next)) return;
    cursor = isDate ? next : next.slice(0, 7);
    navigated = true;
    showFrom(cursor);
    view = isDate ? "days" : "months";
    render();
    position();
  }

  input.addEventListener("input", () => {
    validate();
    const iso = input.value;
    if (iso && isOpen()) { cursor = iso; showFrom(iso); navigated = false; render(); position(); }
  });
  input.addEventListener("change", settle);
  input.addEventListener("blur", () => { settle(); close(); });
  input.addEventListener("click", (event) => {
    const rect = input.getBoundingClientRect();
    const onIcon = event.clientX > rect.right - 44;
    if (isOpen() && onIcon) close();
    else if (!isOpen()) open();
  });
  input.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
    const { key } = event;
    if (!isOpen()) {
      if (key === "ArrowDown" || key === "F4") { event.preventDefault(); open(); }
      return;
    }
    const steps = isDate ? { up: [-7, 0], down: [7, 0], left: [-1, 0], right: [1, 0], pageUp: [0, -1], pageDown: [0, 1] }
      : { up: [0, -3], down: [0, 3], left: [0, -1], right: [0, 1], pageUp: [0, -12], pageDown: [0, 12] };
    const arrow = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", PageUp: "pageUp", PageDown: "pageDown" }[key];
    if (key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    } else if (key === "Enter" && navigated) {
      event.preventDefault();
      event.stopImmediatePropagation();
      commit(cursor);
    } else if (key === "Enter") {
      settle();
      close();
    } else if (arrow && (navigated || arrow === "up" || arrow === "down" || arrow.startsWith("page"))) {
      event.preventDefault();
      moveCursor(...steps[arrow]);
    }
  });
}

document.querySelectorAll("input[type=date], input[type=month]").forEach(enhanceDateInput);
