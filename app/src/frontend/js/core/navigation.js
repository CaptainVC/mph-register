"use strict";

// Tabs, sub-tabs, the side menu and going back to where an edit started.

// ---------- App shell ----------
// Resolves once the tab has drawn its lists.
function switchView(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  // Page-wide layout rules key on these (body[data-screen]) rather than on body:has(…), which re-checks on every change.
  document.body.dataset.screen = name;
  $("menuSettings")?.classList.toggle("active", name === "settings");
  let loading = null;
  if (name === "register") {
    registerJumpToNewest = true;
    loading = fillMonthSelect($("registerViewMonth"), true).then(renderRegister);
  }
  if (name === "partywise") loading = fillMonthSelect($("partyViewMonth"), true).then(renderPartywise);
  if (name === "bills" && typeof showBills === "function") loading = showBills();
  if (name === "masters" && typeof showMasters === "function") loading = showMasters();
  if (name === "settings" && typeof renderFirmForm === "function") loading = renderFirmForm();
  if (name === "dashboard" && typeof showDashboard === "function") loading = showDashboard();
  if (name === "import") loading = refreshImportYears();
  if (name === "aawak" && typeof showAawak === "function") loading = showAawak();
  // Saves and imports refresh the footer themselves; a tab switch only picks up outside changes (notices), now and then.
  if (Date.now() - infoCheckedAt > INFO_RECHECK_MS) {
    infoCheckedAt = Date.now();
    refreshInfo().catch(() => {});
  }
  return Promise.resolve(loading).catch(showFatal);
}
const INFO_RECHECK_MS = 30000;
let infoCheckedAt = Date.now();
document.body.dataset.screen = document.querySelector(".view.active")?.id.replace(/^view-/, "") || "";
document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  returnTrips.length = 0;
  switchView(tab.dataset.view);
}));

// ---------- Going back after opening something from another tab ----------
// A bill opened from a BILL NO. link, or an entry opened from its INW. NO. on another tab, remembers the tab it came from
// (with its search, filters and scroll positions untouched); closing the bill or finishing the entry goes back there.
// Picking a tab by hand forgets the way back.
const returnTrips = [];

function viewScrollers(view) {
  return [$("main"), ...view.querySelectorAll(".table-wrap")];
}

// kind: what is being opened ("bill" or "entry"); target: the tab it opens on. Nothing is remembered within the same tab.
function rememberReturn(kind, target) {
  const view = document.querySelector(".view.active");
  const name = view?.id.replace(/^view-/, "");
  if (!name || name === target) return;
  returnTrips.push({ kind, view: name, scroll: viewScrollers(view).map((n) => [n.scrollTop, n.scrollLeft]) });
}

// Goes back to where the latest trip of this kind started; returns false when there is no trip to go back from.
async function returnFrom(kind) {
  if (returnTrips.at(-1)?.kind !== kind) return false;
  const trip = returnTrips.pop();
  const drawn = await switchView(trip.view);
  // Put back at once: main scrolls smoothly for the user, which would otherwise animate the jump.
  const restore = () => viewScrollers($(`view-${trip.view}`)).forEach((n, i) => {
    const [top, left] = trip.scroll[i] || [0, 0];
    n.scrollTo({ top, left, behavior: "instant" });
  });
  restore();
  // Once more after the tab's rows have been laid out, unless the tab kept the rows it had (nothing moves then, and a late
  // second restore could undo a scroll made in the meantime).
  if (drawn !== false) requestAnimationFrame(restore);
  return true;
}

// ---------- Right-side menu (language, theme, settings) ----------
function openSideMenu() {
  const menu = $("sideMenu");
  if (!menu) return;
  if (openDrawer(menu, $("sideMenuClose"))) $("menuToggle")?.setAttribute("aria-expanded", "true");
}

function closeSideMenu() {
  const menu = $("sideMenu");
  if (menu?.open) closeDrawer(menu, true);
}

$("menuToggle")?.addEventListener("click", () => {
  if ($("sideMenu")?.open) closeSideMenu(); else openSideMenu();
});
$("sideMenuClose")?.addEventListener("click", closeSideMenu);
$("sideMenu")?.addEventListener("close", () => $("menuToggle")?.setAttribute("aria-expanded", "false"));
$("menuSettings")?.addEventListener("click", () => {
  closeSideMenu();
  switchView("settings");
});

const subviewHandlers = {};
function switchSubview(group, sub) {
  document.querySelectorAll(`.subtabs[data-group=${group}] .subtab`).forEach((b) => b.classList.toggle("active", b.dataset.sub === sub));
  document.querySelectorAll(`[id^="${group}-"].subview`).forEach((v) => v.classList.toggle("active", v.id === `${group}-${sub}`));
  document.body.dataset[`${group}Sub`] = sub;
  const handler = subviewHandlers[`${group}-${sub}`];
  if (handler) Promise.resolve(handler()).catch(showFatal);
}
document.querySelectorAll(".subtabs").forEach((nav) => nav.querySelectorAll(".subtab").forEach((b) =>
  b.addEventListener("click", () => switchSubview(nav.dataset.group, b.dataset.sub))));

$("entryDate").addEventListener("change", () => {
  if (state.editing) return;
  const month = monthOf($("entryDate").value);
  if (month !== state.entryMonth) syncEntryMonth(month);
});

async function loadMasters() {
  state.masters = await api("/api/masters");
}
