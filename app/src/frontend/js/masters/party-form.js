"use strict";

// Masters → Parties: the party edit panel and its rates.

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
