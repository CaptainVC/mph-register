"use strict";

// Starts the app once every shared script above has loaded.

async function start() {
  try {
    await Promise.all([refreshInfo(), loadMasters()]);
    $("importMonth").value = "";
    await resetForm({ keepDate: false });
    $("party").focus();
    await refreshRecent();
    requestAnimationFrame(() => document.documentElement.classList.add("ready"));
    renderUpdateMenu();
    announceUpdate(state.info);
    checkForUpdates(false);
    loadRollback();
  } catch (error) {
    showFatal(error);
  }
}

start();
