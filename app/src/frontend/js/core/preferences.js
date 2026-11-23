"use strict";

// App info, language, theme, which screens are shown, notices and fatal errors.

const FOLDER_SOURCE = { nextToApp: "next to the app", documents: "in Documents", environment: "set by MPH_DATA_DIR" };

// Answers can land out of order on a slow computer: only the newest is shown, and an answer to a request sent before the
// user picked a language or theme does not put the old choice back.
let infoRequests = 0;
let displayChoices = 0;

async function refreshInfo() {
  const request = ++infoRequests;
  const choices = displayChoices;
  const info = await api("/api/info");
  if (request !== infoRequests) return info;
  state.info = info;
  $("appInfo").textContent = `Version ${info.version} · ${num(info.entries)} entries · Data folder (${FOLDER_SOURCE[info.dataFolderSource] || info.dataFolderSource}): ${info.dataFolder} · data file mph-data.db + config file mph-config.json`;
  if (choices === displayChoices) {
    applyTheme(info.theme);
    if (typeof applyLanguage === "function") applyLanguage(info.language);
  }
  applyFeatures(info);
  showNotices(info);
  return info;
}

// ---------- Language (kept in the config file; cached so the page opens in the right language) ----------
async function setLanguageChoice(next) {
  const normalized = next === "hi" ? "hi" : "en";
  displayChoices++;
  if (typeof applyLanguage === "function") applyLanguage(normalized);
  try {
    const settings = await api("/api/settings");
    const saved = await api("/api/settings", { method: "PUT", json: { display: { ...settings.display, language: normalized } } });
    if (typeof mastersState !== "undefined" && mastersState.settings) mastersState.settings.display = saved.display;
    if (typeof applyLanguage === "function") applyLanguage(saved.display.language);
  } catch (error) {
    setMessage(`Could not save the language choice: ${error.message}`, "err");
  }
}
document.querySelectorAll("#langSwitch [data-lang]").forEach((btn) =>
  btn.addEventListener("click", () => setLanguageChoice(btn.dataset.lang)));

// ---------- Theme (kept in the config file; cached so the page opens in the right colours) ----------
let appliedTheme = document.documentElement.dataset.theme || null;
function applyTheme(theme) {
  const dark = theme === "dark";
  const value = dark ? "dark" : "light";
  // The page opens with the cached theme already set (index.html); screens redraw only when it really changes.
  const changed = appliedTheme !== null && appliedTheme !== value;
  appliedTheme = value;
  document.documentElement.dataset.theme = value;
  try { localStorage.setItem("mph-theme", value); } catch { /* private mode */ }
  document.querySelectorAll("#themeSwitch [data-theme]").forEach((btn) => {
    const active = btn.dataset.theme === value;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const select = $("display-theme");
  if (select && select.value !== value) select.value = value;
  if (changed) document.dispatchEvent(new CustomEvent("mph-theme"));
}

async function setThemeChoice(next) {
  const value = next === "dark" ? "dark" : "light";
  displayChoices++;
  applyTheme(value);
  try {
    const settings = await api("/api/settings");
    const saved = await api("/api/settings", { method: "PUT", json: { display: { ...settings.display, theme: value } } });
    if (typeof mastersState !== "undefined" && mastersState.settings) mastersState.settings.display = saved.display;
    applyTheme(saved.display.theme);
  } catch (error) {
    setMessage(`Could not save the dark mode choice: ${error.message}`, "err");
  }
}
document.querySelectorAll("#themeSwitch [data-theme]").forEach((btn) =>
  btn.addEventListener("click", () => setThemeChoice(btn.dataset.theme)));

// UI features can be hidden or unhidden in Settings.
function toggleViewFeature(view, show) {
  document.querySelector(`.tab[data-view="${view}"]`)?.classList.toggle("hidden", !show);
  if (!show && $(`view-${view}`)?.classList.contains("active")) switchView("entry");
}

function toggleMasterSubfeature(sub, show) {
  document.querySelector(`.subtabs[data-group="masters"] .subtab[data-sub="${sub}"]`)?.classList.toggle("hidden", !show);
  if (!show && $(`masters-${sub}`)?.classList.contains("active")) switchSubview("masters", "parties");
}

function applyFeatures(info) {
  toggleViewFeature("import", info.showExcelImport !== false);
  toggleViewFeature("partywise", info.showPartywise !== false);
  toggleViewFeature("bills", info.showBills !== false);
  toggleViewFeature("dashboard", info.showDashboard !== false);
  toggleViewFeature("aawak", info.showAawak !== false);
  toggleMasterSubfeature("styles", info.showBillingStyles === true);
  toggleMasterSubfeature("colors", info.showColors !== false);
}

function showNotices(info) {
  const bar = $("noticeBar");
  const items = [...(info.configProblem ? [info.configProblem] : []), ...(info.notices || [])];
  const key = items.join("\n");
  let hidden = "";
  try { hidden = localStorage.getItem("mph-hidden-notices") || ""; } catch { /* private mode */ }
  if (!items.length || hidden === key) { bar.classList.add("hidden"); return; }
  const close = el("button", { type: "button", class: "secondary small", text: "Hide", onclick: () => {
    try { localStorage.setItem("mph-hidden-notices", key); } catch { /* private mode */ }
    bar.classList.add("hidden");
  } });
  bar.replaceChildren(el("div", {}, [el("b", { text: info.configProblem ? "The config file needs attention" : "Notes about the data folder" }),
    el("ul", {}, items.map((t) => el("li", { text: t })))]), close);
  bar.classList.toggle("err", !!info.configProblem);
  bar.classList.remove("hidden");
}

function showFatal(error) {
  setMessage(`Could not reach the app: ${error.message}. Close and reopen MPH Register.`, "err");
  console.warn(error);
}
