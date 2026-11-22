"use strict";

// Everything on these screens is kept in the config file (mph-config.json) next to the data file.
// Tables fill the screen; every edit opens in a slide-in panel (see drawerForm in app.js).
const mastersState = { data: null, settings: null, editingParty: null, editingSister: null };

// ---------- Colours (from the config file) ----------
function colorHex(name) {
  const value = String(name || "black").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  const found = (mastersState.data?.colors || []).find((c) => c.name === value);
  return found ? found.hex : null;
}

// Dark screens lighten very dark name colours so they stay readable; bills always print the real colour.
function readableOnDark(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (light >= 0.45) return hex;
  const share = 0.8 - light;
  return `#${[r, g, b].map((c) => Math.round(c + (255 - c) * share).toString(16).padStart(2, "0")).join("")}`;
}

function cssColor(name) {
  const hex = colorHex(name) || "#000000";
  return document.documentElement.dataset.theme === "dark" ? readableOnDark(hex) : hex;
}

// ---------- Billing style options ----------
const COLUMN_OPTIONS = [["blank", "Leave empty"], ["gatePass", "Gate pass numbers"], ["designNo", "Design no. (D.N.)"], ["lotNo", "Lot no. (LOT N.)"]];
const LINES_OPTIONS = [["onePerEntry", "One line per inward entry"], ["sameLot", "Same lot on one line"], ["sameGatePass", "Same gate pass on one line"]];
const ORDER_OPTIONS = [["inward", "Inward order (older first)"], ["reference", "By the number shown (lot / D.N.)"], ["inwardDate", "By inward date"]];
const optionText = (options, value) => (options.find(([v]) => v === value) || [value, value])[1];
const COLUMN_SHORT = { blank: "—", gatePass: "gate pass", designNo: "D.N.", lotNo: "lot" };

function styleSummary(s) {
  if (!s) return "";
  const cols = [["G.P.N.", s.gpnColumn], ["D.N.", s.dnColumn], ["LOT", s.lotColumn]].filter(([, v]) => v !== "blank")
    .map(([h, v]) => (COLUMN_SHORT[v] === h || (h === "LOT" && v === "lotNo") ? h : `${h}=${COLUMN_SHORT[v]}`)).join(" + ");
  const parts = [cols];
  if (s.lines === "sameLot") parts.push("same lot on one line");
  if (s.lines === "sameGatePass") parts.push("same gate pass on one line");
  if (s.showQuantityBreakdown) parts.push("(15+28)");
  if (s.order === "reference") parts.push("sorted by number");
  if (s.order === "inwardDate") parts.push("by inward date");
  if (!s.combineSmallEntries) parts.push("small entries apart");
  return parts.join(" · ");
}

async function loadFullMasters() {
  mastersState.data = await api("/api/masters/full");
  return mastersState.data;
}

async function showMasters() {
  await loadFullMasters();
  renderPartyMasters();
  renderSisterGroups();
  renderStyles();
  renderFinishMasters();
  renderGroupMasters();
  renderColors();
}

function input(id, value, props = {}) {
  const node = el("input", { type: "text", id, ...props });
  node.value = value ?? "";
  return node;
}

function colorSelect(value, id) {
  const names = (mastersState.data.colors || []).map((c) => [c.name, c.name]);
  const current = String(value || "black").toLowerCase();
  if (!names.some(([n]) => n === current)) names.unshift([current, `${current} (not in the colour list)`]);
  const select = dropdownOf(names, current);
  if (id) select.id = id;
  const swatch = el("span", { class: "color-swatch" });
  const paint = () => { swatch.style.background = colorHex(select.value) || "#000000"; };
  select.addEventListener("input", paint);
  paint();
  return { select, node: el("span", { class: "color-pick" }, [select, swatch]) };
}

function formMessage(form, errors, ok) {
  const box = form.querySelector(".form-message");
  if (!box) return;
  box.replaceChildren();
  box.className = `form-message message ${errors && errors.length ? "err" : ok ? "ok" : ""}`;
  if (errors && errors.length) box.append(el("ul", {}, errors.map((e) => el("li", { text: e }))));
  else if (ok) box.textContent = ok;
}

function errorsOf(error) {
  return error.errors || [error.message];
}

function markRow(tableId, attribute, value) {
  document.querySelectorAll(`#${tableId} tbody tr`).forEach((tr) => tr.classList.toggle("selected", value !== null && tr.getAttribute(attribute) === value));
}

// ---------- Parties ----------
function partyStyleText(p) {
  if (p.noBillNeeded) return "no bill needed";
  const parts = [p.billingStyle];
  if (p.sisterGroup) parts.push(`sister firms: ${p.sisterGroup}`);
  if (p.billBeforeDispatch) parts.push("bill before dispatch");
  const billAs = Object.entries(p.billAs || {});
  if (billAs.length) parts.push(`bill as ${billAs.map(([a, b]) => `${a}→${b}`).join(", ")}`);
  return parts.join(" · ");
}

function renderPartyMasters() {
  const data = mastersState.data;
  const tokens = normalize($("partySearch").value).split(" ").filter(Boolean);
  const showInactive = $("showInactiveParties").checked;
  const onlyProblems = $("onlyPartyProblems").checked;
  const list = data.parties.filter((p) => {
    if (!showInactive && !p.active) return false;
    if (onlyProblems && !p.problems.length) return false;
    const hay = normalize([p.name, p.gstin, p.address, p.state, p.billingStyle, p.sisterGroup].join(" "));
    return tokens.every((t) => hay.includes(t));
  });
  const head = el("thead", {}, [el("tr", {}, ["PARTY", "ACTIVE", "ADDRESS", "STATE", "GSTIN", "DISC %", "BILLING STYLE", "RATES", "ENTRIES", "CHECK"].map((h) => el("th", { text: h })))]);
  const body = el("tbody", {}, list.map((p) => {
    const tr = el("tr", { class: `${p.active ? "" : "inactive"} ${p.name === mastersState.editingParty ? "selected" : ""}`, "data-party": p.name }, [
      el("td", { class: "left party-name", text: p.name }),
      el("td", { text: p.active ? "Yes" : "No" }),
      el("td", { class: "left", text: p.address }),
      el("td", { class: "left", text: p.state }),
      el("td", { class: p.gstin && p.problems.includes("GSTIN is not valid") ? "bad" : "", text: p.gstin }),
      el("td", { class: "num", text: p.discount ?? "" }),
      el("td", { class: "left wrap", text: partyStyleText(p) }),
      el("td", { class: "num", text: num(Object.keys(p.rates).length) }),
      el("td", { class: "num", text: num(p.entries) }),
      el("td", { class: "left bad wrap", text: p.problems.join(", ") }),
    ]);
    tr.querySelector(".party-name").style.color = cssColor(p.color);
    tr.addEventListener("click", () => openPartyForm(p));
    return tr;
  }));
  $("partyMasterTable").replaceChildren(head, body);
  setTableEmpty($("partyMasterTable"), list.length ? "" : "No party matches.");
  $("partyMasterCount").textContent = `${num(list.length)} of ${num(data.parties.length)} parties`;
}

["partySearch", "showInactiveParties", "onlyPartyProblems"].forEach((id) => $(id).addEventListener("input", renderPartyMasters));
$("addParty").addEventListener("click", () => openPartyForm(null));
$("partyDrawer").addEventListener("close", () => { mastersState.editingParty = null; markRow("partyMasterTable", "data-party", null); });

function replaceParty(saved) {
  const list = mastersState.data.parties;
  const index = list.findIndex((x) => x.name === saved.name);
  if (index >= 0) list[index] = saved; else list.push(saved);
  renderPartyMasters();
  renderSisterGroups();
}

// ---------- Sister firms (parties that share a sister-firm group name) ----------
function sisterGroups() {
  const groups = new Map();
  for (const p of mastersState.data.parties) {
    if (!p.sisterGroup) continue;
    const key = p.sisterGroup.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: p.sisterGroup, parties: [] });
    groups.get(key).parties.push(p);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function renderSisterGroups() {
  const groups = sisterGroups();
  const head = el("thead", {}, [el("tr", {}, ["SISTER-FIRM GROUP", "PARTIES", "FIRMS"].map((h) => el("th", { text: h })))]);
  const body = el("tbody", {}, groups.map((g) => {
    const tr = el("tr", { "data-sister": g.name }, [
      el("td", { class: "left party-name", text: g.name }),
      el("td", { class: "num", text: num(g.parties.length) }),
      el("td", { class: "left wrap", text: g.parties.map((p) => p.name).join(", ") }),
    ]);
    tr.addEventListener("click", () => openSisterForm(g));
    return tr;
  }));
  $("sisterTable").replaceChildren(head, body);
  setTableEmpty($("sisterTable"), groups.length ? "" : "No sister-firm groups yet. Add one to link parties that bill each other's entries.");
  $("sisterCount").textContent = `${num(groups.length)} groups`;
  markRow("sisterTable", "data-sister", mastersState.editingSister);
}

$("addSister").addEventListener("click", () => openSisterForm(null));
$("sisterDrawer").addEventListener("close", () => { mastersState.editingSister = null; markRow("sisterTable", "data-sister", null); });

function openSisterForm(group) {
  const data = mastersState.data;
  const g = group || { name: "", parties: [] };
  mastersState.editingSister = group ? group.name : null;
  markRow("sisterTable", "data-sister", mastersState.editingSister);
  const form = $("sisterForm");
  const name = input("sf-name", g.name, { maxlength: "100", placeholder: "e.g. HARRISON" });
  const members = new Set(g.parties.map((p) => p.name));
  const search = el("input", { type: "search", id: "sf-search", placeholder: "Find a party…" });
  const count = el("span", { class: "muted", id: "sf-count" });
  const sameGroup = (p) => g.name && p.sisterGroup.toLowerCase() === g.name.toLowerCase();
  const rows = [...data.parties].sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
    const box = el("input", { type: "checkbox", value: p.name });
    box.checked = members.has(p.name);
    const elsewhere = p.sisterGroup && !sameGroup(p) ? el("span", { class: "muted", text: `now in ${p.sisterGroup}` }) : "";
    const row = el("label", { class: "check sister-row", "data-name": normalize(p.name) }, [box, p.name, p.active ? "" : el("span", { class: "muted", text: "inactive" }), elsewhere]);
    box.addEventListener("change", () => { if (box.checked) members.add(p.name); else members.delete(p.name); showCount(); });
    return row;
  });
  const showCount = () => { count.textContent = `${num(members.size)} selected`; };
  showCount();
  search.addEventListener("input", () => {
    const tokens = normalize(search.value).split(" ").filter(Boolean);
    rows.forEach((row) => row.classList.toggle("hidden", !tokens.every((t) => row.dataset.name.includes(t))));
  });
  const save = el("button", { type: "submit", id: "sf-save", text: group ? "Save changes" : "Add sister group" });
  const remove = group ? el("button", { type: "button", class: "secondary", id: "sf-delete", text: "Delete group", onclick: async () => {
    if (!(await showConfirm({
      title: "Delete sister-firm group",
      message: `Delete the sister-firm group "${g.name}"?`,
      detail: `${num(g.parties.length)} parties stay as they are, but are no longer linked as sister firms. Re-check the links of imported bills afterwards.`,
      confirmText: "Delete group",
      cancelText: "Cancel",
      tone: "danger",
    }))) return;
    try {
      await api(`/api/masters/sister-group?name=${encodeURIComponent(g.name)}`, { method: "DELETE" });
      await Promise.all([loadFullMasters(), loadMasters()]);
      renderPartyMasters();
      renderSisterGroups();
      await closeDrawer($("sisterDrawer"), true);
      toast(`Deleted ${g.name}`);
    } catch (error) {
      formMessage(form, errorsOf(error));
    }
  } }) : "";
  drawerForm(form, {
    key: `sister:${g.name}`,
    title: group ? g.name : "Add a sister-firm group",
    subtitle: group ? `${num(g.parties.length)} parties` : "",
    body: [
      section("Group", [fieldsGrid([field("Sister-firm group", name)], 1)]),
      section("Parties in this group", [
        el("div", { "data-instant": "" }, [search]),
        el("div", { class: "sister-list" }, rows),
        count,
      ], "A party can be in one group only; ticking one that is in another group moves it here."),
    ],
    actions: [save, remove, el("button", { type: "button", class: "ghost", text: "Close", onclick: () => closeDrawer($("sisterDrawer")) })],
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const saved = await api("/api/masters/sister-group", { method: "POST", json: { originalName: group ? group.name : null, name: name.value, parties: [...members] } });
      await Promise.all([loadFullMasters(), loadMasters()]);
      renderPartyMasters();
      renderSisterGroups();
      openSisterForm(sisterGroups().find((x) => x.name.toLowerCase() === saved.name.toLowerCase()));
      formMessage($("sisterForm"), null, `Saved ✓ ${saved.name}`);
      toast(`Saved ${saved.name}`);
    } catch (error) {
      formMessage(form, errorsOf(error));
    } finally {
      save.disabled = false;
    }
  };
  openDrawer($("sisterDrawer"), group ? search : name);
}

function openPartyForm(party) {
  const data = mastersState.data;
  const firstStyle = data.styles[0]?.name || "";
  const p = party || { name: "", active: true, address: "", state: "", gstin: "", discount: null, color: "black", sisterGroup: "", billingStyle: firstStyle, billBeforeDispatch: false, noBillNeeded: false, billAs: {}, rates: {}, entries: 0 };
  mastersState.editingParty = party ? party.name : null;
  markRow("partyMasterTable", "data-party", mastersState.editingParty);
  const form = $("partyForm");
  const name = input("pf-name", p.name, { maxlength: "100" });
  const active = el("input", { type: "checkbox", id: "pf-active" });
  active.checked = p.active;
  const color = colorSelect(p.color, "pf-color");
  const address = input("pf-address", p.address);
  const stateInput = input("pf-state", p.state);
  const gstin = input("pf-gstin", p.gstin, { maxlength: "20" });
  const gstinHint = el("span", { class: "hint", id: "pf-gstin-hint" });
  const checkGstin = () => {
    gstin.value = gstin.value.toUpperCase().replace(/\s+/g, "");
    const valid = gstinValid(gstin.value);
    gstinHint.textContent = gstin.value === "" ? "15 characters, e.g. 08ABCDE1234F1Z5" : valid ? "✓ looks valid" : "✗ not a valid GSTIN";
    gstinHint.className = `hint ${gstin.value === "" ? "" : valid ? "good" : "bad"}`;
  };
  gstin.addEventListener("input", checkGstin);
  checkGstin();
  const discount = input("pf-discount", p.discount ?? "", { type: "number", min: "0", max: "100", step: "0.01" });
  const sisterGroup = input("pf-sister-group", p.sisterGroup || "", { maxlength: "100", placeholder: "e.g. HARRISON — leave empty if none" });
  const sisterNames = [...new Set(data.parties.map((x) => x.sisterGroup).filter(Boolean))].sort();
  attachSuggestions(sisterGroup, (text) => textSuggestions(sisterNames, text), { requireNavigation: true });
  const sisters = data.parties.filter((x) => x.name !== p.name && x.sisterGroup && x.sisterGroup === p.sisterGroup).map((x) => x.name);

  const styleNames = data.styles.map((s) => [s.name, s.name]);
  if (p.billingStyle && !styleNames.some(([n]) => n === p.billingStyle)) styleNames.unshift([p.billingStyle, `${p.billingStyle} (not found)`]);
  const style = dropdownOf(styleNames, p.billingStyle || firstStyle);
  style.id = "pf-style";
  const styleText = el("div", { class: "style-box", id: "pf-style-text" });
  const showStyle = () => {
    const chosen = data.styles.find((s) => s.name === style.value);
    styleText.textContent = chosen ? (chosen.description || styleSummary(chosen)) : "";
  };
  style.addEventListener("input", showStyle);
  showStyle();
  const beforeDispatch = el("input", { type: "checkbox", id: "pf-before-dispatch" });
  beforeDispatch.checked = !!p.billBeforeDispatch;
  const noBill = el("input", { type: "checkbox", id: "pf-no-bill" });
  noBill.checked = !!p.noBillNeeded;
  const showNoBill = () => { beforeDispatch.disabled = noBill.checked; };
  noBill.addEventListener("input", showNoBill);
  showNoBill();

  const finishNames = data.finishes.map((f) => [f.name, f.name]);
  const mapRows = el("tbody");
  const addMapRow = (from = "", to = "") => {
    const a = dropdownOf([["", "— inward finish —"], ...finishNames], from, { "aria-label": "Inward finish" });
    const b = dropdownOf([["", "— bill as —"], ...finishNames], to, { "aria-label": "Bill as" });
    const tr = el("tr", {}, [el("td", {}, [a]), el("td", { class: "muted", text: "→" }), el("td", {}, [b]),
      el("td", {}, [el("button", { type: "button", class: "link", text: "Remove", onclick: () => { tr.remove(); form.dataset.dirty = "1"; } })])]);
    mapRows.append(tr);
  };
  Object.entries(p.billAs || {}).forEach(([a, b]) => addMapRow(a, b));

  const save = el("button", { type: "submit", id: "pf-save", text: party ? "Save changes" : "Add party" });
  const toggle = party ? el("button", { type: "button", class: "secondary", id: "pf-toggle", text: p.active ? "Mark inactive" : "Mark active" }) : "";
  const close = el("button", { type: "button", class: "ghost", text: "Close", onclick: () => closeDrawer($("partyDrawer")) });

  drawerForm(form, {
    key: `party:${p.name}`,
    title: party ? p.name : "Add a party",
    subtitle: party ? `${num(p.entries)} inward entries` : "Details, billing style and rates",
    body: [
      section("Party", [
        fieldsGrid([
          field("Party name", name, "", "span-2"),
          field("Address", address), field("State", stateInput),
          field("GSTIN", el("div", { class: "field" }, [gstin, gstinHint])), field("Discount %", discount, "Taken off the gross of every bill"),
          field("Name colour", color.node),
          field("Sister-firm group", sisterGroup, sisters.length ? `Same group: ${sisters.join(", ")}` : "Choose any member of this group as the bill recipient. Excel bill imports also use this group to link entries.", "span-2"),
        ]),
        el("div", { class: "checks" }, [checkbox(active, "Active (shows in lists)")]),
      ]),
      section("Bills", [
        fieldsGrid([field("Billing style", style, "", "span-2")]),
        styleText,
        el("div", { class: "checks" }, [
          checkbox(noBill, "No bill needed (this party is never billed)"),
          checkbox(beforeDispatch, "Bill before dispatch (tick entries not sent yet)"),
        ]),
      ]),
      section("Bill a finish under another finish name", [
        el("p", { class: "muted", text: "Example: SGZ billed as SGJ. Leave empty when the bill uses the inward finish." }),
        el("table", { class: "map-table" }, [mapRows]),
        el("div", {}, [el("button", { type: "button", class: "secondary small", text: "+ Add bill-as finish", onclick: () => { addMapRow(); form.dataset.dirty = "1"; } })]),
      ]),
      ratesSection(party),
    ],
    actions: [save, toggle, close],
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    const billAs = {};
    for (const tr of mapRows.children) {
      const [a, b] = tr.querySelectorAll("[data-dropdown]");
      if (a.value && b.value) billAs[a.value] = b.value;
    }
    const payload = {
      originalName: mastersState.editingParty, name: name.value, active: active.checked, address: address.value, state: stateInput.value,
      gstin: gstin.value, discount: discount.value === "" ? null : Number(discount.value), color: color.select.value,
      sisterGroup: sisterGroup.value, billingStyle: style.value, billBeforeDispatch: beforeDispatch.checked, noBillNeeded: noBill.checked, billAs,
    };
    if (party && party.name !== payload.name.trim().replace(/\s+/g, " ") && party.entries > 0
        && !(await showConfirm({
          title: "Rename party",
          message: `Rename "${party.name}" to "${payload.name.trim()}"?`,
          detail: `Its ${num(party.entries)} inward entries move to the new name. Saved bills keep the name they were printed with.`,
          confirmText: "Rename",
          cancelText: "Cancel",
        }))) return;
    save.disabled = true;
    try {
      const saved = await api("/api/masters/party", { method: "POST", json: payload });
      await Promise.all([loadFullMasters(), loadMasters()]);
      renderPartyMasters();
      openPartyForm(mastersState.data.parties.find((x) => x.name === saved.name));
      formMessage($("partyForm"), null, `Saved ✓ ${saved.name}`);
      toast(`Saved ${saved.name}`);
    } catch (error) {
      formMessage(form, errorsOf(error));
    } finally {
      save.disabled = false;
    }
  };
  if (toggle) toggle.addEventListener("click", () => { active.checked = !active.checked; form.requestSubmit(); });
  openDrawer($("partyDrawer"), name);
}

// Rates: only the finishes this party has a rate for; each add, edit or delete is saved at once.
function ratesSection(party) {
  const wrap = el("section", { class: "section", id: "pf-rates", "data-instant": "" });
  if (!party) {
    wrap.append(el("div", { class: "section-head" }, [el("h3", { text: "Rates (₹ per THAN)" })]),
      el("p", { class: "muted", text: "Add the party first, then add its rates here." }));
    return wrap;
  }
  let editing = null;
  const message = el("span", { class: "message", id: "rate-message" });
  const say = (text, kind) => { message.textContent = text; message.className = `message ${kind || ""}`; };
  const current = () => mastersState.data.parties.find((x) => x.name === party.name) || party;
  const groupOf = (finish) => mastersState.data.finishes.find((f) => f.name.toLowerCase() === finish.toLowerCase())?.group || "";

  const afterChange = (saved, text) => {
    replaceParty(saved);
    markRow("partyMasterTable", "data-party", party.name);
    editing = null;
    render();
    say(text, "ok");
    toast(text);
  };

  const viewRow = (finish, rate) => el("tr", { "data-finish": finish }, [
    el("td", { class: "left", text: finish }),
    el("td", { class: "left muted", text: groupOf(finish) }),
    el("td", { class: "num", text: money(rate) }),
    el("td", { class: "cell-actions" }, [
      el("button", { type: "button", class: "link edit rate-edit", text: "Edit", onclick: () => { editing = finish; render(); } }),
      el("button", { type: "button", class: "link rate-delete", text: "Delete", onclick: async () => {
        if (!(await showConfirm({
          title: "Delete rate",
          message: `Delete the ${finish} rate (${money(rate)}) of ${party.name}?`,
          confirmText: "Delete",
          cancelText: "Cancel",
          tone: "danger",
        }))) return;
        try {
          afterChange(await api(`/api/masters/party/rate?party=${encodeURIComponent(party.name)}&finish=${encodeURIComponent(finish)}`, { method: "DELETE" }), `Deleted the ${finish} rate ✓`);
        } catch (error) {
          say(errorsOf(error).join(" "), "err");
        }
      } }),
    ]),
  ]);

  const editRow = (finish, rate) => {
    const rated = new Set(Object.keys(current().rates).map((f) => f.toLowerCase()));
    const choices = mastersState.data.finishes
      .filter((f) => f.name === finish || !rated.has(f.name.toLowerCase()))
      .filter((f) => f.active || f.name === finish)
      .map((f) => [f.name, f.name]);
    const finishSelect = dropdownOf([["", "— choose finish —"], ...choices], finish);
    finishSelect.id = "rate-finish";
    const rateInput = el("input", { type: "number", min: "0.01", step: "0.01", id: "rate-value", placeholder: "₹ per THAN" });
    rateInput.value = rate ?? "";
    const saveRate = async () => {
      try {
        const saved = await api("/api/masters/party/rate", { method: "PUT", json: {
          party: party.name, finish: finishSelect.value, originalFinish: finish || null, rate: rateInput.value === "" ? null : Number(rateInput.value),
        } });
        afterChange(saved, `Saved the ${finishSelect.value} rate ✓`);
      } catch (error) {
        say(errorsOf(error).join(" "), "err");
      }
    };
    const cancelEdit = () => { editing = null; render(); say("", ""); };
    for (const control of [finishSelect, rateInput]) {
      control.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); saveRate(); }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelEdit(); }
      });
    }
    return el("tr", { class: "editing" }, [
      el("td", {}, [finishSelect]),
      el("td", { class: "muted", text: finish ? groupOf(finish) : "" }),
      el("td", { class: "num" }, [rateInput]),
      el("td", { class: "cell-actions" }, [
        el("button", { type: "button", class: "small", id: "rate-save", text: "Save", onclick: saveRate }),
        el("button", { type: "button", class: "link edit", text: "Cancel", onclick: cancelEdit }),
      ]),
    ]);
  };

  function render() {
    const rows = Object.entries(current().rates).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    const body = el("tbody");
    for (const [finish, rate] of rows) body.append(editing === finish ? editRow(finish, rate) : viewRow(finish, rate));
    if (editing === "") body.append(editRow("", null));
    const table = el("table", { class: "mini", id: "rateTable" }, [
      el("colgroup", {}, [el("col", { style: "width: 34%" }), el("col", { style: "width: 22%" }), el("col", { style: "width: 22%" }), el("col")]),
      el("thead", {}, [el("tr", {}, [el("th", { text: "FINISH" }), el("th", { text: "GROUP" }), el("th", { class: "num", text: "RATE (₹ PER THAN)" }), el("th", { text: "" })])]), body]);
    if (!rows.length && editing !== "") table.append(el("caption", { text: "No rates yet — bills for this party need at least one." }));
    const add = el("button", { type: "button", class: "secondary small", id: "addRate", text: "+ Add rate", onclick: () => { editing = ""; render(); } });
    add.disabled = editing !== null;
    wrap.replaceChildren(
      el("div", { class: "section-head" }, [el("h3", { text: `Rates (₹ per THAN) — ${num(rows.length)} finish${rows.length === 1 ? "" : "es"}` }), el("span", { class: "muted", text: "Each change is saved at once" })]),
      table,
      el("div", { class: "actions" }, [add, message]));
    if (editing !== null) (wrap.querySelector("#rate-finish")?.value ? wrap.querySelector("#rate-value") : wrap.querySelector("#rate-finish"))?.focus();
  }

  render();
  return wrap;
}

function gstinValid(g) {
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = chars.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return chars[(36 - (sum % 36)) % 36] === g[14];
}

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
      formMessage($("styleForm"), null, `Saved ✓ ${saved.name}${saved.parties ? ` — the bills of ${num(saved.parties)} part${saved.parties === 1 ? "y" : "ies"} follow it` : ""}`);
      toast(`Saved ${saved.name}`);
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
      formMessage($("finishForm"), null, `Saved ✓ ${saved.name}`);
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
      formMessage($("groupForm"), null, `Saved ✓ ${saved.name}`);
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
      formMessage($("colorForm"), null, `Saved ✓ ${saved.name}`);
      toast(`Saved ${saved.name}`);
    } catch (error) {
      formMessage(form, errorsOf(error));
    }
  };
  openDrawer($("colorDrawer"), name);
}

// ---------- Firm and bill settings ----------
const FIRM_FIELDS = [
  ["name", "Firm name"], ["gstin", "Firm GSTIN"], ["addressLine1", "Address line 1"], ["addressLine2", "Address line 2"],
  ["phoneLine", "Phone line"], ["msmeLine", "MSME / Udyam line"], ["homeStateCode", "Home state GST code (08 = Rajasthan)"], ["homeStateName", "Home state name"],
];
const RULE_FIELDS = [
  ["numberPrefix", "Bill number prefix ({FY} = 26-27)", "text"], ["totalMustStayBelow", "Bill total must stay below ₹ (0 = no limit)", "number", "1"],
  ["rowsPerBill", "Rows per bill", "number", "1"], ["combineSmallBelowThan", "Combine entries with THAN below (0 = never)", "number", "1"],
  ["combineUpTo", "Combine up to (entries per line)", "number", "1"], ["cgstPercent", "CGST %", "number", "0.01"],
  ["sgstPercent", "SGST %", "number", "0.01"], ["igstPercent", "IGST % (other states)", "number", "0.01"],
];
const TEXT_GROUPS = [
  ["Top of the bill", [["title", "Title"], ["copyLabel", "Copy label"], ["firmGstinPrefix", "Before the firm GSTIN"], ["partyDetailsLabel", "Party details label"],
    ["invoiceNoLabel", "Invoice no. label"], ["datedLabel", "Date label"], ["periodLabel", "Before the bill period"], ["periodJoiner", "Between period dates"],
    ["partyGstinPrefix", "Before the party GSTIN"], ["invoiceKind", "Kind of bill"], ["sacLine", "SAC line"]]],
  ["Column headings", [["gpnHeader", "G.P.N."], ["dnHeader", "D.N."], ["lotHeader", "LOT NO."], ["finishHeader", "FINISH"], ["thanHeader", "THAN"], ["rateHeader", "RATE"], ["amountHeader", "Amount"]]],
  ["Totals", [["grossLabel", "Gross"], ["totalRsLabel", "Total Rs."], ["discountLabel", "Discount"], ["taxableLabel", "Taxable"], ["cgstLabel", "CGST"], ["sgstLabel", "SGST"], ["igstLabel", "IGST"], ["totalLabel", "Invoice total"]]],
  ["Bottom of the bill", [["bankLine1", "Bank line 1"], ["bankLine2", "Bank line 2"], ["paymentLine", "Payment line"], ["signatory", "Signatory line"], ["signatureLabel", "Signature label"], ["checkedByLabel", "Checked-by label"]]],
];

function textInputs(values, fields, prefix) {
  const inputs = {};
  const nodes = fields.map(([key, label, type = "text", step]) => {
    const node = input(`${prefix}-${key}`, values[key] ?? "", { type, ...(step ? { step, min: "0" } : {}) });
    inputs[key] = node;
    return field(label, node);
  });
  return { inputs, nodes };
}

function settingsCard(id, title, children, note) {
  return el("section", { class: "card", id }, [el("div", { class: "card-head" }, [el("h2", { text: title }), note ? el("span", { class: "muted", text: note }) : ""]), ...children]);
}

async function renderFirmForm(fy) {
  const settings = await api(`/api/settings${fy ? `?fy=${encodeURIComponent(fy)}` : ""}`);
  mastersState.settings = settings;
  const form = $("firmForm");
  const firm = textInputs(settings.firm, FIRM_FIELDS, "firm");
  const rules = textInputs(settings.billRules, RULE_FIELDS, "rule");
  const limitHint = el("span", { class: "hint", id: "rule-limit-hint" });
  const showLimit = () => { const v = Number(rules.inputs.totalMustStayBelow.value); limitHint.textContent = v > 0 ? `= ${money(v)}` : "no limit"; };
  rules.inputs.totalMustStayBelow.addEventListener("input", showLimit);
  showLimit();
  rules.inputs.totalMustStayBelow.parentElement.append(limitHint);
  const limits = settings.limits;
  rules.inputs.rowsPerBill.parentElement.append(el("span", { class: "hint", id: "rule-rows-hint",
    text: `The printed bill has ${limits.templateRows}. Up to ${limits.maxRowsLetter} fit on Letter, ${limits.maxRowsA4} on A4 (smallest font ${settings.print.smallestFontPt} pt); more rows are drawn shorter.` }));

  const fyInput = input("firm-fy", settings.fy, { maxlength: "5" });
  const next = input("firm-next", settings.nextSerial, { type: "number", min: "1", step: "1" });
  fyInput.addEventListener("change", () => { if (/^\d{2}-\d{2}$/.test(fyInput.value)) renderFirmForm(fyInput.value); });

  const paper = dropdownOf([["letter", "Letter (same as the Excel bill)"], ["a4", "A4"]], settings.print.paperSize || "letter");
  paper.id = "print-paper";
  const indian = el("input", { type: "checkbox", id: "print-indian" });
  indian.checked = settings.print.indianDigitGrouping !== false;
  const smallest = input("print-smallest", settings.print.smallestFontPt, { type: "number", min: "5", max: "12", step: "0.25" });
  const fonts = Object.entries(settings.print.fontFallbacks || {}).map(([font, list]) => {
    const node = el("input", { type: "text", id: `print-font-${font.replace(/\s+/g, "-").toLowerCase()}`, "data-font": font, class: "font-list" });
    node.value = list;
    return field(`If ${font} is missing, use`, node, "", "span-2");
  });

  const texts = TEXT_GROUPS.map(([title, fields]) => ({ title, ...textInputs(settings.printedTexts, fields, "text") }));
  const terms = el("textarea", { id: "text-terms", rows: "4" });
  terms.value = (settings.printedTexts.terms || []).join("\n");

  const theme = dropdownOf([["light", "Light"], ["dark", "Dark"]], settings.display.theme || "light");
  theme.id = "display-theme";
  const language = dropdownOf([["en", "English"], ["hi", "हिन्दी (Hinglish)"]], settings.display.language || "en");
  language.id = "display-language";

  const featureToggle = (id, label, hint, checked) => {
    const box = el("input", { type: "checkbox", id });
    box.checked = checked;
    return {
      input: box,
      node: el("div", { class: "feature-item" }, [checkbox(box, label), el("span", { class: "hint", text: hint })]),
    };
  };
  const showBillingStyles = featureToggle("feature-billing-styles", "Billing styles", "Masters → Billing styles subsection (hidden by default)", settings.display.showBillingStyles === true);
  const showImport = featureToggle("display-import", "Excel import", "Import Excel tab (inward register and bills)", settings.display.showExcelImport !== false);
  const showPartywise = featureToggle("feature-partywise", "Party-wise", "Party-wise tab", settings.display.showPartywise !== false);
  const showBills = featureToggle("feature-bills", "Bills", "Bills tab (make and saved bills)", settings.display.showBills !== false);
  const showColors = featureToggle("feature-colors", "Colours", "Masters → Colours subsection", settings.display.showColors !== false);
  const dashboardToggle = featureToggle("feature-dashboard", "Dashboard", "Dashboard tab (income, unbilled work, GST and parties)", settings.display.showDashboard !== false);

  const save = el("button", { type: "submit", id: "firm-save", text: "Save settings" });
  const cards = [
    settingsCard("set-firm", "Firm details", [fieldsGrid(firm.nodes)], "Printed on every bill"),
    settingsCard("set-rules", "Bill rules", [fieldsGrid(rules.nodes)]),
    settingsCard("set-numbers", "Bill numbers", [fieldsGrid([field("Financial year", fyInput), field("Next bill number in this year", next)])], "Kept in the data file"),
    settingsCard("set-print", "Printing", [
      fieldsGrid([field("Paper", paper), field("Smallest font on bill lines (pt)", smallest, "Long lot / D.N. lists shrink to this, then wrap onto a second row."), ...fonts]),
      el("div", { class: "checks" }, [checkbox(indian, "Amounts in lakhs style (₹1,37,757.00)")]),
    ]),
    settingsCard("set-texts", "Texts printed on the bill", [
      ...texts.flatMap((g) => [el("h3", { text: g.title }), fieldsGrid(g.nodes, 3)]),
      el("h3", { text: "Terms (one per line, up to 4)" }), terms,
    ]),
    settingsCard("set-signature", "Signature", [signatureBlock(settings)], "Kept in the config file"),
    settingsCard("set-screens", "Appearance", [fieldsGrid([field("Theme (also in the right-side menu)", theme), field("Language (also in the right-side menu)", language)])]),
    settingsCard("set-features", "Features", [
      el("div", { class: "feature-list" }, [showBillingStyles.node, showImport.node, showPartywise.node, showBills.node, showColors.node, dashboardToggle.node]),
    ], "Show or hide screens and sections in the UI"),
    configFileBlock(settings),
  ];
  form.replaceChildren(...cards, el("div", { class: "save-bar" }, [save, el("div", { class: "form-message message", role: "status" })]));
  renderSettingsNav(cards);

  form.onsubmit = async (event) => {
    event.preventDefault();
    const read = (inputs, fields) => Object.fromEntries(fields.map(([key, , type]) => [key, type === "number" ? Number(inputs[key].value) : inputs[key].value]));
    const printedTexts = { ...settings.printedTexts, terms: terms.value.split("\n").map((t) => t.trimEnd()).filter((t) => t.length) };
    for (const g of texts) Object.assign(printedTexts, read(g.inputs, TEXT_GROUPS.find(([t]) => t === g.title)[1]));
    const fontFallbacks = Object.fromEntries([...form.querySelectorAll(".font-list")].map((i) => [i.dataset.font, i.value]));
    const payload = {
      firm: { ...settings.firm, ...read(firm.inputs, FIRM_FIELDS) },
      billRules: { ...settings.billRules, ...read(rules.inputs, RULE_FIELDS) },
      printedTexts,
      print: { ...settings.print, paperSize: paper.value, indianDigitGrouping: indian.checked, smallestFontPt: Number(smallest.value), fontFallbacks },
      display: {
        ...settings.display,
        theme: theme.value,
        language: language.value,
        showExcelImport: showImport.input.checked,
        showBillingStyles: showBillingStyles.input.checked,
        showPartywise: showPartywise.input.checked,
        showBills: showBills.input.checked,
        showColors: showColors.input.checked,
        showDashboard: dashboardToggle.input.checked,
      },
      fy: fyInput.value, nextSerial: Number(next.value),
    };
    save.disabled = true;
    try {
      const saved = await api("/api/settings", { method: "PUT", json: payload });
      mastersState.settings = saved;
      const scroll = $("settingsScroll").scrollTop;
      await refreshInfo();
      await renderFirmForm(saved.fy);
      $("settingsScroll").scrollTop = scroll;
      formMessage($("firmForm"), null, "Saved ✓ to the config file");
      toast("Settings saved");
    } catch (error) {
      formMessage(form, errorsOf(error));
    } finally {
      save.disabled = false;
    }
  };
}

function renderSettingsNav(cards) {
  const nav = $("settingsNav");
  const scroller = $("settingsScroll");
  let pinned = null;
  let pinTimer = 0;
  const activate = (id) => links.forEach((l) => l.classList.toggle("active", l.getAttribute("href") === `#${id}`));
  const links = cards.map((card) => {
    const link = el("a", { href: `#${card.id}`, text: card.querySelector("h2").textContent });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      pinned = card.id;
      clearTimeout(pinTimer);
      pinTimer = setTimeout(() => { pinned = null; }, 900);
      activate(card.id);
      card.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return link;
  });
  nav.replaceChildren(...links);
  // The highlighted link follows the card at the top; at the very bottom the last card wins.
  let frame = 0;
  scroller.onscroll = () => {
    if (pinned) {
      clearTimeout(pinTimer);
      pinTimer = setTimeout(() => { pinned = null; }, 160);
      return;
    }
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const top = scroller.getBoundingClientRect().top + 90;
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      const current = atBottom ? cards[cards.length - 1] : [...cards].reverse().find((c) => c.getBoundingClientRect().top <= top) || cards[0];
      if (current) activate(current.id);
    });
  };
  activate(cards[0]?.id);
}

function configFileBlock(settings) {
  const file = settings.configFile;
  const items = [...(file.problem ? [file.problem] : []), ...(file.notices || [])];
  const reload = el("button", { type: "button", class: "secondary", id: "config-reload", text: "Read the config file again", onclick: async () => {
    try {
      await api("/api/settings/reload", { method: "POST" });
      await Promise.all([loadFullMasters(), loadMasters(), refreshInfo()]);
      await renderFirmForm();
      toast("Config file read again");
    } catch (error) {
      formMessage($("firmForm"), errorsOf(error));
    }
  } });
  return settingsCard("config-file", "Config file", [
    el("p", { class: "muted", text: "Parties, finishes, styles, colours and every setting on this page are kept in this file, next to the data file. Changes made here are written to it at once; if it is edited outside the app, the app reads it again by itself." }),
    el("div", { class: "config-path", text: file.path }),
    el("p", { class: "muted", text: `Read: ${file.loadedAt || "—"} · Last saved by the app: ${file.savedAt || "—"}` }),
    items.length ? el("ul", { class: file.problem ? "warnings" : "" }, items.map((t) => el("li", { text: t }))) : "",
    el("div", {}, [reload]),
  ]);
}

// The signature printed above "Authorized Signatory" (kept in the config file).
function signatureBlock(settings) {
  const preview = el("img", { id: "sig-preview", alt: "No signature", class: "signature-preview" });
  const status = el("span", { class: "muted", id: "sig-status" });
  const show = (has) => {
    preview.style.display = has ? "" : "none";
    if (has) preview.src = `/api/settings/signature?t=${Date.now()}`;
    status.textContent = has ? "" : "No signature — bills print without one.";
  };
  const file = el("input", { type: "file", id: "sig-file", accept: "image/png,image/jpeg" });
  const upload = el("button", { type: "button", class: "secondary", id: "sig-upload", text: "Use this picture", onclick: async () => {
    if (!file.files[0]) { status.textContent = "Choose a PNG or JPG picture first."; return; }
    const form = new FormData();
    form.append("file", file.files[0]);
    try {
      const saved = await api("/api/settings/signature", { method: "PUT", body: form });
      show(saved.hasSignature);
      status.textContent = "Saved ✓";
      toast("Signature saved");
    } catch (error) {
      status.textContent = error.message;
    }
  } });
  const remove = el("button", { type: "button", class: "secondary", id: "sig-remove", text: "Remove signature", onclick: async () => {
    if (!(await showConfirm({
      title: "Remove signature",
      message: "Print bills without a signature?",
      confirmText: "Remove signature",
      cancelText: "Cancel",
      tone: "danger",
    }))) return;
    const saved = await api("/api/settings/signature", { method: "DELETE" });
    show(saved.hasSignature);
  } });
  show(settings.hasSignature);
  return el("div", { class: "signature-block" }, [preview, el("div", { class: "actions" }, [file, upload, remove, status])]);
}

document.addEventListener("mph-theme", () => {
  if (!mastersState.data) return;
  renderPartyMasters();
  renderFinishMasters();
});

subviewHandlers["masters-parties"] = async () => { await loadFullMasters(); renderPartyMasters(); };
subviewHandlers["masters-styles"] = async () => { await loadFullMasters(); renderStyles(); };
subviewHandlers["masters-sisters"] = async () => { await loadFullMasters(); renderSisterGroups(); };
subviewHandlers["masters-finishes"] = async () => { await loadFullMasters(); renderFinishMasters(); renderGroupMasters(); };
subviewHandlers["masters-colors"] = async () => { await loadFullMasters(); renderColors(); };
