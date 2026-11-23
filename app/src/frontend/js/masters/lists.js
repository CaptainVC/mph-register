"use strict";

// Masters → Billing styles, finishes, groups and colours.

// ---------- Billing styles ----------
const STYLE_PARTY_NAMES_SHOWN = 2;

// "Style (Party A, Party B +3 more)" - the parties using the style are named so styles are easy to tell apart.
function styleLabel(styleName, parties) {
  const names = parties.filter((p) => p.billingStyle === styleName).map((p) => p.name).sort((a, b) => a.localeCompare(b));
  if (!names.length) return styleName;
  const shown = names.slice(0, STYLE_PARTY_NAMES_SHOWN).join(", ");
  const more = names.length - STYLE_PARTY_NAMES_SHOWN;
  return `${styleName} (${shown}${more > 0 ? ` +${num(more)} more` : ""})`;
}

function renderStyles() {
  const styles = mastersState.data.styles;
  const head = el("thead", {}, [el("tr", {}, ["BILLING STYLE", "G.P.N.", "D.N.", "LOT NO.", "LINES", "ORDER", "(15+28)", "SMALL ENTRIES", "PARTIES"].map((h) => el("th", { text: h })))]);
  const body = el("tbody", {}, styles.map((s) => {
    const tr = el("tr", { "data-style": s.name, title: s.description }, [
      el("td", { class: "left", text: styleLabel(s.name, mastersState.data.parties) }),
      el("td", { text: optionText(COLUMN_OPTIONS, s.gpnColumn) }), el("td", { text: optionText(COLUMN_OPTIONS, s.dnColumn) }),
      el("td", { text: optionText(COLUMN_OPTIONS, s.lotColumn) }), el("td", { text: optionText(LINES_OPTIONS, s.lines) }),
      el("td", { text: optionText(ORDER_OPTIONS, s.order) }), el("td", { text: s.showQuantityBreakdown ? "Yes" : "No" }),
      el("td", { text: s.combineSmallEntries ? "Combined" : "Apart" }), el("td", { class: "num", text: num(s.parties) }),
    ]);
    tr.addEventListener("click", () => openStyleForm(s));
    return tr;
  }));
  $("styleTable").replaceChildren(head, body);
  $("styleCount").textContent = `${num(styles.length)} styles`;
}
$("addStyle").addEventListener("click", () => openStyleForm(null));
$("styleDrawer").addEventListener("close", () => markRow("styleTable", "data-style", null));

function openStyleForm(style) {
  const s = style || { name: "", description: "", gpnColumn: "blank", dnColumn: "designNo", lotColumn: "lotNo", lines: "onePerEntry", order: "inward", showQuantityBreakdown: false, combineSmallEntries: true, parties: 0 };
  markRow("styleTable", "data-style", style ? style.name : null);
  const form = $("styleForm");
  const name = input("sf-name", s.name, { maxlength: "60" });
  const description = el("textarea", { id: "sf-description", rows: "2", placeholder: "When to use this style" });
  description.value = s.description;
  const gpn = dropdownOf(COLUMN_OPTIONS, s.gpnColumn);
  const dn = dropdownOf(COLUMN_OPTIONS, s.dnColumn);
  const lot = dropdownOf(COLUMN_OPTIONS, s.lotColumn);
  const lines = dropdownOf(LINES_OPTIONS, s.lines);
  const order = dropdownOf(ORDER_OPTIONS, s.order);
  Object.assign(gpn, { id: "sf-gpn" }); Object.assign(dn, { id: "sf-dn" }); Object.assign(lot, { id: "sf-lot" });
  Object.assign(lines, { id: "sf-lines" }); Object.assign(order, { id: "sf-order" });
  const breakdown = el("input", { type: "checkbox", id: "sf-breakdown" });
  breakdown.checked = !!s.showQuantityBreakdown;
  const combine = el("input", { type: "checkbox", id: "sf-combine" });
  combine.checked = s.combineSmallEntries !== false;
  const users = mastersState.data.parties.filter((p) => p.billingStyle === s.name).map((p) => p.name);
  const preview = el("div", { id: "sf-preview" });
  const read = () => ({
    originalName: style ? style.name : null, name: name.value, description: description.value, gpnColumn: gpn.value, dnColumn: dn.value, lotColumn: lot.value,
    lines: lines.value, order: order.value, showQuantityBreakdown: breakdown.checked, combineSmallEntries: combine.checked,
  });
  let timer = null;
  const refreshPreview = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const rows = await api("/api/masters/style/preview", { method: "POST", json: { ...read(), name: read().name || "preview" } });
        preview.replaceChildren(el("table", { class: "mini preview-table" }, [
          el("thead", {}, [el("tr", {}, ["G.P.N.", "D.N.", "LOT NO.", "FINISH", "THAN", "RATE", "AMOUNT"].map((h) => el("th", { text: h })))]),
          el("tbody", {}, rows.map((l) => el("tr", { class: `k-${l.kind}` }, l.kind === "blank" ? [el("td", { colspan: "7" })] : [
            el("td", { text: l.gpn }), el("td", { text: l.dn }), el("td", { text: l.lot }), el("td", { text: l.finish }),
            el("td", { class: "num", text: num(l.qty) }), el("td", { class: "num", text: l.rate === null ? "" : num(l.rate) }), el("td", { class: "num", text: l.amount === null ? "" : money(l.amount) }),
          ]))),
        ]));
      } catch (error) {
        preview.replaceChildren(el("p", { class: "message err", text: errorsOf(error).join(" ") }));
      }
    }, 150);
  };
  [gpn, dn, lot, lines, order, breakdown, combine].forEach((control) => control.addEventListener("input", refreshPreview));
  const remove = style ? el("button", { type: "button", class: "danger", id: "sf-delete", text: "Delete style", onclick: async () => {
    if (!(await showConfirm({
      title: "Delete billing style",
      message: `Delete billing style "${style.name}"?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      tone: "danger",
    }))) return;
    try {
      await api(`/api/masters/style?name=${encodeURIComponent(style.name)}`, { method: "DELETE" });
      await loadFullMasters();
      renderStyles();
      closeDrawer($("styleDrawer"), true);
      toast(`Deleted ${style.name}`);
    } catch (error) {
      formMessage(form, errorsOf(error));
    }
  } }) : "";
  if (remove && users.length) { remove.disabled = true; remove.title = "Parties use this style; give them another style first."; }
  const save = el("button", { type: "submit", id: "sf-save", text: style ? "Save style" : "Add style" });
  drawerForm(form, {
    key: `style:${s.name}`,
    title: style ? s.name : "Add a billing style",
    subtitle: users.length ? `Used by ${num(users.length)} part${users.length === 1 ? "y" : "ies"}` : "Not used by any party yet",
    body: [
      section("Style", [fieldsGrid([field("Style name", name, "", "span-2"), field("What it is for (optional)", description, "", "span-2")])]),
      section("What each bill line shows", [fieldsGrid([field("G.P.N. column", gpn), field("D.N. column", dn), field("LOT NO. column", lot)], 3)]),
      section("How entries become lines", [
        fieldsGrid([field("Lines", lines), field("Order of lines", order)]),
        el("div", { class: "checks" }, [checkbox(breakdown, "Show THAN like (15+28) on shared lines"), checkbox(combine, "Combine small entries (see Settings)")]),
      ]),
      section("Preview with sample entries", [preview], "Made by the real bill maker"),
      users.length ? section("Parties using it", [el("p", { class: "muted", text: `${users.slice(0, 30).join(", ")}${users.length > 30 ? ` and ${num(users.length - 30)} more` : ""}` })]) : "",
    ],
    actions: [save, remove, el("button", { type: "button", class: "ghost", text: "Close", onclick: () => closeDrawer($("styleDrawer")) })],
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const saved = await api("/api/masters/style", { method: "POST", json: read() });
      await loadFullMasters();
      renderStyles();
      renderPartyMasters();
      openStyleForm(mastersState.data.styles.find((x) => x.name === saved.name));
      toast(`Saved ✓ ${saved.name}${saved.parties ? ` — the bills of ${num(saved.parties)} part${saved.parties === 1 ? "y" : "ies"} follow it` : ""}`);
    } catch (error) {
      formMessage(form, errorsOf(error));
    }
  };
  refreshPreview();
  openDrawer($("styleDrawer"), name);
}

// ---------- Finishes and groups ----------
function renderFinishMasters() {
  const data = mastersState.data;
  const showInactive = $("showInactiveFinishes").checked;
  const list = data.finishes.filter((f) => showInactive || f.active);
  const head = el("thead", {}, [el("tr", {}, ["FINISH", "ACTIVE", "GROUP", "COLOUR", "IF PARTY HAS NO RATE, BILL AS", "PARTIES WITH A RATE", "ENTRIES"].map((h) => el("th", { text: h })))]);
  const body = el("tbody", {}, list.map((f) => {
    const tr = el("tr", { class: f.active ? "" : "inactive", "data-finish": f.name }, [
      el("td", { class: "left finish-name", text: f.name }), el("td", { text: f.active ? "Yes" : "No" }),
      el("td", { text: f.group }), el("td", { text: f.color }), el("td", { text: (f.fallback || []).join(", ") }),
      el("td", { class: "num", text: num(f.ratedBy) }), el("td", { class: "num", text: num(f.entries) }),
    ]);
    tr.querySelector(".finish-name").style.color = cssColor(f.color);
    tr.addEventListener("click", () => openFinishForm(f));
    return tr;
  }));
  $("finishMasterTable").replaceChildren(head, body);
  $("finishCount").textContent = `${num(list.length)} of ${num(data.finishes.length)} finishes`;
}
$("showInactiveFinishes").addEventListener("input", renderFinishMasters);
$("addFinish").addEventListener("click", () => openFinishForm(null));
$("finishDrawer").addEventListener("close", () => markRow("finishMasterTable", "data-finish", null));

function openFinishForm(finish) {
  const data = mastersState.data;
  const f = finish || { name: "", active: true, group: "", color: "black", fallback: [], entries: 0 };
  markRow("finishMasterTable", "data-finish", finish ? finish.name : null);
  const form = $("finishForm");
  const name = input("ff-name", f.name, { maxlength: "40" });
  const active = el("input", { type: "checkbox", id: "ff-active" });
  active.checked = f.active;
  const group = dropdownOf([["", "— no group —"], ...data.groups.map((g) => [g.name, g.name])], f.group);
  group.id = "ff-group";
  const color = colorSelect(f.color, "ff-color");
  const fallback = input("ff-fallback", (f.fallback || []).join(", "), { placeholder: "e.g. SGJ, SGB" });
  const prefix = (text) => text.slice(0, text.lastIndexOf(",") + 1);
  attachSuggestions(fallback, (text) => {
    const previous = prefix(text);
    return textSuggestions(data.finishes.map((x) => x.name), text.slice(previous.length))
      .map(({ value, label }) => ({ value: previous ? `${previous} ${value}` : value, label }));
  }, { requireNavigation: true });
  const save = el("button", { type: "submit", id: "ff-save", text: finish ? "Save" : "Add finish" });
  const toggle = finish ? el("button", { type: "button", class: "secondary", text: f.active ? "Mark inactive" : "Mark active", onclick: () => { active.checked = !active.checked; form.requestSubmit(); } }) : "";
  drawerForm(form, {
    key: `finish:${f.name}`,
    title: finish ? f.name : "Add a finish",
    subtitle: finish ? `${num(f.entries)} inward entries · ${num(f.ratedBy || 0)} parties with a rate` : "",
    body: [
      section("Finish", [
        fieldsGrid([field("Finish", name), field("Finish group", group), field("Colour on bills", color.node),
          field("If the party has no rate for it, bill as", fallback, "The first of these the party has a rate for", "span-2")]),
        el("div", { class: "checks" }, [checkbox(active, "Active")]),
      ]),
    ],
    actions: [save, toggle, el("button", { type: "button", class: "ghost", text: "Close", onclick: () => closeDrawer($("finishDrawer")) })],
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (finish && finish.name !== name.value.trim() && finish.entries > 0
        && !(await showConfirm({
          title: "Rename finish",
          message: `Rename finish "${finish.name}" to "${name.value.trim()}"?`,
          detail: `Its ${num(finish.entries)} inward entries and all rates move to the new name.`,
          confirmText: "Rename",
          cancelText: "Cancel",
        }))) return;
    try {
      const saved = await api("/api/masters/finish", { method: "POST", json: { originalName: finish ? finish.name : null, name: name.value, active: active.checked, group: group.value, color: color.select.value,
        fallback: fallback.value.split(",").map((x) => x.trim()).filter(Boolean) } });
      await Promise.all([loadFullMasters(), loadMasters()]);
      renderFinishMasters();
      renderGroupMasters();
      openFinishForm(mastersState.data.finishes.find((x) => x.name === saved.name));
      toast(`Saved ${saved.name}`);
    } catch (error) {
      formMessage(form, errorsOf(error));
    }
  };
  openDrawer($("finishDrawer"), name);
}

function renderGroupMasters() {
  const head = el("thead", {}, [el("tr", {}, ["GROUP", "ACTIVE", "FINISHES"].map((h) => el("th", { text: h })))]);
  const body = el("tbody", {}, mastersState.data.groups.map((g) => {
    const tr = el("tr", { class: g.active ? "" : "inactive", "data-group": g.name }, [el("td", { class: "left", text: g.name }), el("td", { text: g.active ? "Yes" : "No" }), el("td", { class: "num", text: num(g.finishes) })]);
    tr.addEventListener("click", () => openGroupForm(g));
    return tr;
  }));
  $("groupMasterTable").replaceChildren(head, body);
}
$("addGroup").addEventListener("click", () => openGroupForm(null));
$("groupDrawer").addEventListener("close", () => markRow("groupMasterTable", "data-group", null));

function openGroupForm(group) {
  const g = group || { name: "", active: true, finishes: 0 };
  markRow("groupMasterTable", "data-group", group ? group.name : null);
  const form = $("groupForm");
  const name = input("gf-name", g.name, { maxlength: "40" });
  const active = el("input", { type: "checkbox", id: "gf-active" });
  active.checked = g.active;
  const toggle = group ? el("button", { type: "button", class: "secondary", text: g.active ? "Mark inactive" : "Mark active", onclick: () => { active.checked = !active.checked; form.requestSubmit(); } }) : "";
  drawerForm(form, {
    key: `group:${g.name}`,
    title: group ? g.name : "Add a finish group",
    subtitle: group ? `${num(g.finishes)} finishes` : "",
    body: [section("Group", [fieldsGrid([field("Group name", name)], 1), el("div", { class: "checks" }, [checkbox(active, "Active")])])],
    actions: [el("button", { type: "submit", text: group ? "Save" : "Add group" }), toggle, el("button", { type: "button", class: "ghost", text: "Close", onclick: () => closeDrawer($("groupDrawer")) })],
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const saved = await api("/api/masters/group", { method: "POST", json: { originalName: group ? group.name : null, name: name.value, active: active.checked } });
      await loadFullMasters();
      renderGroupMasters();
      renderFinishMasters();
      openGroupForm(mastersState.data.groups.find((x) => x.name === saved.name));
      toast(`Saved ${saved.name}`);
    } catch (error) {
      formMessage(form, errorsOf(error));
    }
  };
  openDrawer($("groupDrawer"), name);
}

// ---------- Colours ----------
function renderColors() {
  const colors = mastersState.data.colors;
  const head = el("thead", {}, [el("tr", {}, ["", "COLOUR NAME", "VALUE", "PARTIES", "FINISHES"].map((h) => el("th", { text: h })))]);
  const body = el("tbody", {}, colors.map((c) => {
    const swatch = el("span", { class: "color-swatch" });
    swatch.style.background = c.hex;
    const tr = el("tr", { "data-color": c.name }, [el("td", {}, [swatch]), el("td", { class: "left", text: c.name }), el("td", { text: c.hex }),
      el("td", { class: "num", text: num(c.parties) }), el("td", { class: "num", text: num(c.finishes) })]);
    tr.addEventListener("click", () => openColorForm(c));
    return tr;
  }));
  $("colorTable").replaceChildren(head, body);
  $("colorCount").textContent = `${num(colors.length)} colours`;
}
$("addColor").addEventListener("click", () => openColorForm(null));
$("colorDrawer").addEventListener("close", () => markRow("colorTable", "data-color", null));

function openColorForm(color) {
  const c = color || { name: "", hex: "#1f4e79", parties: 0, finishes: 0 };
  markRow("colorTable", "data-color", color ? color.name : null);
  const form = $("colorForm");
  const name = input("cf-name", c.name, { maxlength: "30" });
  const picker = el("input", { type: "color", id: "cf-picker" });
  picker.value = c.hex;
  const hex = input("cf-hex", c.hex, { maxlength: "7" });
  picker.addEventListener("input", () => { hex.value = picker.value; });
  hex.addEventListener("input", () => { if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) picker.value = hex.value.toLowerCase(); });
  const used = c.parties + c.finishes;
  const remove = color ? el("button", { type: "button", class: "danger", id: "cf-delete", text: "Delete colour", onclick: async () => {
    if (!(await showConfirm({
      title: "Delete colour",
      message: `Delete colour "${color.name}"?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      tone: "danger",
    }))) return;
    try {
      await api(`/api/masters/color?name=${encodeURIComponent(color.name)}`, { method: "DELETE" });
      await loadFullMasters();
      renderColors();
      closeDrawer($("colorDrawer"), true);
      toast(`Deleted ${color.name}`);
    } catch (error) {
      formMessage(form, errorsOf(error));
    }
  } }) : "";
  if (remove && used) { remove.disabled = true; remove.title = "Parties or finishes use this colour."; }
  drawerForm(form, {
    key: `color:${c.name}`,
    title: color ? c.name : "Add a colour",
    subtitle: used ? `Used by ${num(c.parties)} parties and ${num(c.finishes)} finishes; renaming moves them` : "Not used yet",
    body: [section("Colour", [fieldsGrid([field("Name (as typed for parties and finishes)", name), field("Colour", el("span", { class: "color-pick" }, [picker, hex]))], 1)])],
    actions: [el("button", { type: "submit", id: "cf-save", text: color ? "Save colour" : "Add colour" }), remove, el("button", { type: "button", class: "ghost", text: "Close", onclick: () => closeDrawer($("colorDrawer")) })],
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const saved = await api("/api/masters/color", { method: "POST", json: { originalName: color ? color.name : null, name: name.value, hex: hex.value } });
      await loadFullMasters();
      renderColors();
      renderPartyMasters();
      openColorForm(mastersState.data.colors.find((x) => x.name === saved.name));
      toast(`Saved ${saved.name}`);
    } catch (error) {
      formMessage(form, errorsOf(error));
    }
  };
  openDrawer($("colorDrawer"), name);
}
