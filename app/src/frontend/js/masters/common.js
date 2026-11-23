"use strict";

// Everything on these screens is kept in the config file (mph-config.json) next to the data file.
// Tables fill the screen; every edit opens in a slide-in panel (see drawerForm in js/core/dialogs.js).
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
  if (typeof renderLorryMasters === "function") await renderLorryMasters();
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
