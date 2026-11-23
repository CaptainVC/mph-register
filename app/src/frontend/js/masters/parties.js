"use strict";

// Masters → Parties list and sister firms.

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
      toast(`Saved ${saved.name}`);
    } catch (error) {
      formMessage(form, errorsOf(error));
    } finally {
      save.disabled = false;
    }
  };
  openDrawer($("sisterDrawer"), group ? search : name);
}
