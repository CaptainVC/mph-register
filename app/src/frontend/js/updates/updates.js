"use strict";

// New versions: checking, installing, restarting and going back to the previous version.

// ---------- New versions: the Windows app asks GitHub once it opens and installs a new version when asked ----------
// Installing: the app downloads the new version, closes and starts it (Hosting/SelfUpdate.cs); this window waits until
// the app answers again and reloads.
const updates = { status: null, rollback: null, installing: false, checking: false };
const UPDATE_LATER_KEY = "mph-update-later";
const UPDATED_FROM_KEY = "mph-updated-from";
const ROLLED_BACK_FROM_KEY = "mph-rolled-back-from";

function sessionValue(key, value) {
  try {
    if (value === undefined) return sessionStorage.getItem(key) || "";
    if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value);
  } catch { /* private mode */ }
  return "";
}

function renderUpdateMenu() {
  const status = updates.status;
  const lines = [];
  if (updates.checking) lines.push("Checking…");
  else if (!status) lines.push(`Version ${state.info?.version || ""}`.trim());
  else if (status.problem) lines.push(`Version ${status.currentVersion}`, status.problem);
  else if (status.available && status.skipped) {
    lines.push(`Version ${status.latestVersion} is available. You went back from it.`);
  } else if (status.available) {
    lines.push(`Version ${status.latestVersion} is available. You have ${status.currentVersion}.`);
    if (!status.canInstall) lines.push("Updates install only in the Windows app (MPH Register.exe).");
  } else if (status.checked) lines.push(`Version ${status.currentVersion} is the newest.`);
  else lines.push(`Version ${status.currentVersion}`);
  $("updateInfo").replaceChildren(...lines.map((text, i) => el("span", { class: i ? "muted" : "", text })));
  $("installUpdate").classList.toggle("hidden", !(status?.available && status.canInstall) || updates.installing);
  $("checkUpdates").disabled = updates.checking || updates.installing;
  const back = updates.rollback;
  const rollbackButton = $("rollbackUpdate");
  rollbackButton.textContent = back?.version ? `Go back to version ${back.version}` : "Go back to the previous version";
  rollbackButton.classList.toggle("hidden", !back?.available || updates.installing);
}

function renderUpdateBar() {
  const bar = $("updateBar");
  const status = updates.status;
  if (!status?.available || !status.canInstall || status.skipped || updates.installing || sessionValue(UPDATE_LATER_KEY) === status.latestVersion) {
    bar.classList.add("hidden");
    return;
  }
  const buttons = [el("button", { type: "button", id: "updateNow", class: "small", text: "Update now", onclick: () => installUpdate() })];
  if (status.notes) {
    buttons.push(el("button", { type: "button", id: "updateNotes", class: "secondary small", text: "What's new", onclick: () =>
      showAlert({ title: `What's new in version ${status.latestVersion}`, message: status.notes }) }));
  }
  buttons.push(el("button", { type: "button", id: "updateLater", class: "secondary small", text: "Later", onclick: () => {
    sessionValue(UPDATE_LATER_KEY, status.latestVersion);
    bar.classList.add("hidden");
  } }));
  bar.replaceChildren(el("div", {}, [el("b", { text: `New version ${status.latestVersion} is ready` })]), el("div", { class: "update-actions" }, buttons));
  bar.classList.remove("hidden");
}

async function checkForUpdates(refresh) {
  if (updates.checking) return;
  updates.checking = refresh;
  renderUpdateMenu();
  try {
    updates.status = await api(`/api/updates${refresh ? "?refresh=true" : ""}`);
  } catch (error) {
    if (refresh) updates.status = { ...(updates.status || { currentVersion: state.info?.version || "" }), problem: error.message };
  } finally {
    updates.checking = false;
  }
  if (refresh) sessionValue(UPDATE_LATER_KEY, null);
  renderUpdateMenu();
  renderUpdateBar();
}

function showUpdateProgress(text) {
  const dialog = $("updateDialog");
  $("updateDialogText").textContent = text;
  if (!dialog.open) dialog.showModal();
}

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Reloads once the app has closed and answers again (normally the new version a few seconds later).
async function waitForRestart() {
  const deadline = Date.now() + 120000;
  let closed = false;
  while (Date.now() < deadline) {
    await pause(1000);
    try {
      const response = await fetch("/api/info", { cache: "no-store" });
      if (response.ok && closed) { location.reload(); return; }
    } catch {
      closed = true;
    }
  }
  showUpdateProgress("The app did not open again. Open MPH Register from the desktop.");
}

async function installUpdate() {
  const status = updates.status;
  if (updates.installing || !status?.available || !status.canInstall) return;
  closeSideMenu();
  const go = await showConfirm({
    title: `Update to version ${status.latestVersion}?`,
    message: "Save any entry you are typing first. The app then downloads the new version, closes and opens again by itself.",
    detail: "Your entries, bills and settings stay as they are.",
    confirmText: "Update now",
  });
  if (!go) return;
  updates.installing = true;
  renderUpdateMenu();
  renderUpdateBar();
  $("updateDialog").addEventListener("cancel", (event) => event.preventDefault());
  showUpdateProgress("Downloading the new version… Keep the app open.");
  try {
    await api("/api/updates/install", { method: "POST" });
  } catch (error) {
    updates.installing = false;
    $("updateDialog").close();
    renderUpdateMenu();
    renderUpdateBar();
    toast(`Could not update: ${error.message}`, "err");
    return;
  }
  sessionValue(UPDATED_FROM_KEY, status.currentVersion);
  showUpdateProgress("Opening the new version… This takes a few seconds.");
  await waitForRestart();
}

async function loadRollback() {
  try {
    updates.rollback = await api("/api/updates/rollback");
  } catch {
    updates.rollback = null;
  }
  renderUpdateMenu();
}

function formatUpdatedAt(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  return `${formatDate(day)} ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

// Going back: a copy of this app waits for it to close, puts the older version back (and, when the newer version stores
// the data in a way the older one cannot read, the data as it was at the update) and opens it.
async function rollBack() {
  const back = updates.rollback;
  if (updates.installing || !back?.available) return;
  closeSideMenu();
  const title = back.version ? `Go back to version ${back.version}?` : "Go back to the previous version?";
  const when = formatUpdatedAt(back.updatedAt);
  const go = await showConfirm(back.undoesChanges ? {
    title,
    message: `This version stores the data in a newer way that the older version cannot read. Going back puts your entries, bills and settings back to how they were at the update (${when}): everything changed since then is undone.`,
    detail: "Today's data is kept as a copy in the data folder (rollback), so it can still be recovered.",
    confirmText: "Go back and undo changes",
    tone: "danger",
  } : {
    title,
    message: "Save any entry you are typing first. The app then closes and opens again as the older version.",
    detail: "Your entries, bills and settings stay as they are.",
    confirmText: "Go back",
  });
  if (!go) return;
  updates.installing = true;
  renderUpdateMenu();
  renderUpdateBar();
  $("updateDialog").addEventListener("cancel", (event) => event.preventDefault());
  showUpdateProgress("Going back to the older version… Keep the app open.");
  try {
    await api("/api/updates/rollback", { method: "POST", json: { undoChanges: !!back.undoesChanges } });
  } catch (error) {
    updates.installing = false;
    $("updateDialog").close();
    renderUpdateMenu();
    renderUpdateBar();
    toast(`Could not go back: ${error.message}`, "err");
    return;
  }
  sessionValue(ROLLED_BACK_FROM_KEY, state.info.version);
  showUpdateProgress("Opening the older version… This takes a few seconds.");
  await waitForRestart();
}

function announceUpdate(info) {
  const back = sessionValue(ROLLED_BACK_FROM_KEY);
  if (back) {
    sessionValue(ROLLED_BACK_FROM_KEY, null);
    if (back !== info.version) toast(`Went back to version ${info.version} ✓`);
    else toast(`Could not go back, so this is still version ${info.version}.`, "warn");
  }
  const from = sessionValue(UPDATED_FROM_KEY);
  if (!from) return;
  sessionValue(UPDATED_FROM_KEY, null);
  if (from !== info.version) toast(`Updated to version ${info.version} ✓`);
  else toast("The update did not finish, so this is still the old version. Try again later.", "warn");
}

$("checkUpdates")?.addEventListener("click", () => checkForUpdates(true));
$("installUpdate")?.addEventListener("click", () => installUpdate());
$("rollbackUpdate")?.addEventListener("click", () => rollBack());
