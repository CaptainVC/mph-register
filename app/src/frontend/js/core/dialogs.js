"use strict";

// Slide-in edit panels, modal dialogs, toasts and the party / finish combo boxes.

// Fills an edit window: fixed title bar, scrolling sections, fixed button bar. Inputs marked data-instant save on their own
// and do not count as unsaved changes.
function drawerForm(form, { title, subtitle, body, actions, key = "" }) {
  const dialog = form.closest("dialog");
  const keepScroll = dialog.open && form.dataset.key === key ? form.querySelector(".drawer-body")?.scrollTop || 0 : 0;
  const close = el("button", { type: "button", class: "icon-btn", title: "Close (Esc)", "aria-label": "Close", text: "×", onclick: () => closeDrawer(dialog) });
  form.replaceChildren(
    el("header", { class: "drawer-head" }, [el("h2", {}, [title, subtitle ? el("span", { class: "sub", text: subtitle }) : ""]), close]),
    el("div", { class: "drawer-body" }, body),
    el("footer", { class: "drawer-foot" }, [...actions, el("div", { class: "form-message message", role: "status" })]),
  );
  form.dataset.dirty = "";
  form.dataset.key = key;
  form.oninput = (event) => { if (!event.target.closest("[data-instant]")) form.dataset.dirty = "1"; };
  form.onchange = form.oninput;
  if (keepScroll) form.querySelector(".drawer-body").scrollTop = keepScroll;
}

// ---------- Modal confirmation and notice dialogs (never use browser alert/confirm) ----------
let modalQueue = Promise.resolve();

function openAppDialog({ title, message, detail = "", confirmText = "OK", cancelText = null, tone = "primary" }) {
  const run = () => new Promise((resolve) => {
    const dialog = $("appDialog");
    const previousFocus = document.activeElement;
    let settled = false;

    const closeIcon = el("button", { type: "button", class: "icon-btn", title: "Close (Esc)", "aria-label": "Close", text: "×" });
    const confirmBtn = el("button", {
      type: "button",
      id: "appDialogConfirm",
      class: tone === "danger" ? "danger-solid" : "",
      text: confirmText,
    });
    const cancelBtn = cancelText !== null
      ? el("button", { type: "button", id: "appDialogCancel", class: "secondary", text: cancelText })
      : null;

    const bodyNodes = [];
    if (message) bodyNodes.push(el("p", { class: "modal-message", text: message }));
    if (detail) bodyNodes.push(el("p", { class: "modal-detail", text: detail }));

    dialog.replaceChildren(
      el("div", { class: "modal-box" }, [
        el("header", { class: "modal-head" }, [el("h2", { id: "appDialogTitle", text: title }), closeIcon]),
        el("div", { class: "modal-body", id: "appDialogBody" }, bodyNodes),
        el("footer", { class: "modal-foot" }, cancelBtn ? [cancelBtn, confirmBtn] : [confirmBtn]),
      ]),
    );

    const finish = (result) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown, true);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("mousedown", onBackdrop);
      if (dialog.open) dialog.close();
      if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === "function") {
        previousFocus.focus({ preventScroll: true });
      }
      resolve(result);
    };

    const onKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    };
    const onCancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    const onBackdrop = (event) => {
      if (event.target === dialog) finish(false);
    };

    closeIcon.addEventListener("click", () => finish(false));
    cancelBtn?.addEventListener("click", () => finish(false));
    confirmBtn.addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onKeydown, true);
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("mousedown", onBackdrop);

    dialog.showModal();
    const initialFocus = cancelBtn && tone === "danger" ? cancelBtn : confirmBtn;
    initialFocus.focus({ preventScroll: true });
  });

  const next = modalQueue.then(run, run);
  modalQueue = next.then(() => {}, () => {});
  return next;
}

function showConfirm({ title, message, detail = "", confirmText = "Confirm", cancelText = "Cancel", tone = "primary" }) {
  return openAppDialog({ title, message, detail, confirmText, cancelText, tone });
}

function showAlert({ title = "Notice", message, detail = "", okText = "OK", tone = "primary" }) {
  return openAppDialog({ title, message, detail, confirmText: okText, cancelText: null, tone }).then(() => {});
}

// Opens the window; returns true when it was closed before (so the first field should get the focus).
function openDrawer(dialog, first) {
  if (dialog.open) return false;
  dialog.showModal();
  first?.focus({ preventScroll: true });
  return true;
}

async function closeDrawer(dialog, force = false) {
  if (!dialog.open) return true;
  const form = dialog.querySelector("form");
  if (!force && form?.dataset.dirty) {
    if ($("appDialog")?.open) return false;
    const discard = await showConfirm({
      title: "Unsaved changes",
      message: "Close without saving your changes?",
      confirmText: "Discard changes",
      cancelText: "Keep editing",
      tone: "danger",
    });
    if (!discard) return false;
  }
  if (form) form.dataset.dirty = "";
  if (dialog.open) dialog.close();
  return true;
}

document.querySelectorAll("dialog.drawer").forEach((dialog) => {
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDrawer(dialog);
  });
  dialog.addEventListener("mousedown", (event) => { if (event.target === dialog) closeDrawer(dialog); });
});

function markSaved(form) {
  form.dataset.dirty = "";
}

// Toasts are messages along the bottom edge of the window, over the status bar, so they never cover a button. They live
// in the browser's top layer (a popover), re-raised each time so they show above an open edit window, and go away after a
// few seconds. A plain toast lets clicks pass through. An action ({ id, label, run }) adds a button, such as Undo, and a
// close button, and keeps the toast up a little longer.
function toast(text, kind = "ok", action = null) {
  const box = $("toasts");
  const item = el("div", { class: `toast ${kind}${action ? " has-action" : ""}` }, [el("span", { text })]);
  if (action) {
    item.append(el("button", { type: "button", id: action.id, class: "secondary small toast-action", text: action.label, onclick: () => { item.remove(); action.run(); } }));
    item.append(el("button", { type: "button", class: "secondary small toast-close", title: "Dismiss", "aria-label": "Dismiss", text: "×", onclick: () => item.remove() }));
  }
  box.append(item);
  if (box.showPopover) {
    if (box.matches(":popover-open")) box.hidePopover();
    box.showPopover();
  }
  setTimeout(() => {
    item.classList.add("leaving");
    setTimeout(() => {
      item.remove();
      if (!box.children.length && box.matches?.(":popover-open")) box.hidePopover();
    }, 300);
  }, action ? 8000 : Math.max(kind === "err" ? 4500 : 3000, Math.min(1500 + text.length * 35, 6000)));
}

// ---------- Searchable combo box ----------
// Each master's name is normalised once (the lists are new objects after every masters load), not on every key.
const normalizedNames = new WeakMap();
function normalizedName(item) {
  let name = normalizedNames.get(item);
  if (name === undefined) {
    name = normalize(item.name);
    normalizedNames.set(item, name);
  }
  return name;
}

function masterSuggestions(getItems, text, current) {
  function rank(item, tokens, joined) {
    const name = normalizedName(item);
    if (!tokens.every((t) => name.includes(t))) return -1;
    if (name === joined) return 0;
    if (name.startsWith(joined)) return 1;
    if (name.split(" ").some((word) => word.startsWith(tokens[0]))) return 2;
    return 3;
  }

  const joined = normalize(text);
  const tokens = joined ? joined.split(" ") : [];
  const scored = [];
  for (const item of getItems()) {
    const score = tokens.length ? rank(item, tokens, joined) : 3;
    if (score < 0) continue;
    if (!item.active && item.name !== current && tokens.join("").length < 2) continue;
    scored.push({ item, score: score + (item.active ? 0 : 10) });
  }
  scored.sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name));
  return scored.map(({ item }) => ({ value: item.name, label: item.name, tag: item.active ? "" : "inactive", item }));
}

function createCombo(container, getItems, { onPick } = {}) {
  const input = container.querySelector("input");
  function canonical() {
    const exact = getItems().find((item) => item.name.toLowerCase() === input.value.trim().toLowerCase());
    if (exact) input.value = exact.name;
    return exact || null;
  }

  const { close } = attachSuggestions(input, (text) => masterSuggestions(getItems, text), {
    acceptOnTab: () => !canonical(),
    onPick: ({ item }, source) => {
      input.classList.remove("invalid");
      onPick?.(item, source !== "Tab");
    },
  });
  input.addEventListener("focus", () => input.select());
  input.addEventListener("blur", canonical);

  return { input, canonical, close };
}
