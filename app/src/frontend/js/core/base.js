"use strict";

// Shared state, number and date formatting, the API helper and small DOM helpers used by every screen.

const state = {
  masters: { parties: [], finishes: [] },
  entryMonth: "",
  editing: null,
  entriesCache: new Map(),
};

const $ = (id) => document.getElementById(id);

// Indian digit grouping everywhere on screen: 1,23,45,678 and ₹1,23,456.00.
const INDIAN = new Intl.NumberFormat("en-IN");
const INDIAN_MONEY = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function num(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? INDIAN.format(n) : String(value);
}
function money(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? `₹${INDIAN_MONEY.format(n)}` : String(value);
}
const ENTRY_FIELDS = ["inwardNo", "entryDate", "party", "designNo", "lotNo", "repair", "than", "tp", "finish", "twoPart"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function api(path, options = {}) {
  const init = { ...options, headers: { ...(options.headers || {}) } };
  if (init.method && init.method !== "GET") init.headers["X-MPH-Request"] = "1";
  if (init.json !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(init.json);
    delete init.json;
  }
  const response = await fetch(path, init);
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const errors = body && body.errors ? body.errors : [`Request failed (${response.status}).`];
    const error = new Error(errors.join(" "));
    error.errors = errors;
    throw error;
  }
  return body;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthOf(iso) {
  return iso && /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : todayIso().slice(0, 7);
}

function financialYearOf(month) {
  const [year, number] = month.split("-").map(Number);
  return String(year - (number < 4 ? 1 : 0));
}

function formatFinancialYear(year) {
  return `${year}-${Number(year) + 1}`;
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${MONTHS[Number(m) - 1]}/${y.slice(2)}`;
}

function formatMonth(month) {
  if (!month) return "";
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

// What the closed multi-select Month shows for two or more months: the months while few, a count after that.
function monthsSummary(months) {
  return months.length <= 2 ? [...months].reverse().map(formatMonth).join(", ") : `${months.length} months selected`;
}

function normalize(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function intOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  if (tag === "input" && (props.type === "date" || props.type === "month")) enhanceDateInput(node);
  return node;
}

// Says why a table is empty, centred under its header in the visible part of the table box (even when the table is
// wider than the box). Pass "" once the table has rows again.
function setTableEmpty(table, text) {
  const wrap = table.parentElement;
  let note = [...wrap.children].find((node) => node.classList.contains("table-empty"));
  if (!text) { note?.remove(); return; }
  if (!note) { note = el("div", { class: "table-empty", role: "status" }); wrap.append(note); }
  if (note.dataset.text !== text) { note.textContent = text; note.dataset.text = text; }
}

// ---------- Layout helpers: fields, sections, slide-in edit windows, toasts ----------
function field(label, input, hint, className = "") {
  const target = input.id ? input : input.querySelector?.("[id]");
  const children = [el("label", target?.id ? { for: target.id, text: label } : { text: label }), input];
  if (hint) children.push(el("span", { class: "hint", text: hint }));
  return el("div", { class: `field ${className}`.trim() }, children);
}

function fieldsGrid(nodes, cols = 2) {
  return el("div", { class: `fields${cols > 2 ? ` cols-${cols}` : ""}`, style: cols === 1 ? "--cols: 1" : "" }, nodes);
}

function checkbox(input, text) {
  return el("label", { class: "check" }, [input, text]);
}

function section(title, children, note) {
  return el("section", { class: "section" }, [el("div", { class: "section-head" }, [el("h3", { text: title }), note ? el("span", { class: "muted", text: note }) : ""]), ...children]);
}
