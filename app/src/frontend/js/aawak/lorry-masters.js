"use strict";

// Masters → Lorry walas.

// ---------- Masters → Lorry walas ----------
async function renderLorryMasters() {
  aawakState.lorry = await api("/api/masters/transporters");
  const showInactive = $("showInactiveLorry").checked;
  const rows = aawakState.lorry.filter((t) => showInactive || t.active);
  const table = $("lorryTable");
  table.replaceChildren(
    el("thead", {}, [el("tr", {}, ["LORRY WALA", "Active", "Other spellings", "Own vehicle", "Aawak rows", "Last arrival"].map((t) => el("th", { text: t })))]),
    el("tbody", {}, rows.map((t) => {
      const tr = el("tr", { "data-lorry": t.name, class: t.active ? "" : "inactive" }, [
        el("td", { class: "left", text: t.name }), el("td", { text: t.active ? "Yes" : "No" }), el("td", { class: "left", text: t.otherSpellings.join(", ") }),
        el("td", { text: t.ownVehicle ? "Yes" : "" }), el("td", { text: num(t.arrivals) }), el("td", { text: t.lastArrival ? formatDate(t.lastArrival) : "" }),
      ]);
      tr.addEventListener("click", () => openLorryForm(t));
      return tr;
    })),
  );
  setTableEmpty(table, rows.length ? "" : "No lorry walas yet. Add them here, or import an Aawak workbook.");
  $("lorryCount").textContent = `${num(rows.length)} lorry walas`;
}

$("showInactiveLorry").addEventListener("change", () => renderLorryMasters().catch(showFatal));
$("addLorry").addEventListener("click", () => openLorryForm(null));
subviewHandlers["masters-lorry"] = renderLorryMasters;

function openLorryForm(lorry) {
  const t = lorry || { name: "", active: true, otherSpellings: [], ownVehicle: false, arrivals: 0 };
  markRow("lorryTable", "data-lorry", lorry ? lorry.name : null);
  const form = $("lorryForm");
  const name = el("input", { type: "text", id: "lf-name", maxlength: "100" });
  name.value = t.name;
  const active = el("input", { type: "checkbox", id: "lf-active" });
  active.checked = t.active;
  const own = el("input", { type: "checkbox", id: "lf-own" });
  own.checked = t.ownVehicle;
  const spellings = el("textarea", { id: "lf-spellings", rows: "3", placeholder: "One per line" });
  spellings.value = t.otherSpellings.join("\n");
  const merge = el("input", { type: "checkbox", id: "lf-merge" });
  const save = el("button", { type: "submit", id: "lf-save", text: lorry ? "Save changes" : "Add lorry wala" });
  const remove = lorry && !t.arrivals ? el("button", { type: "button", class: "secondary", id: "lf-delete", text: "Delete", onclick: async () => {
    try {
      await api(`/api/masters/transporter?name=${encodeURIComponent(t.name)}`, { method: "DELETE" });
      await Promise.all([loadMasters(), renderLorryMasters()]);
      await closeDrawer($("lorryDrawer"), true);
      toast(`Deleted ${t.name}`);
    } catch (error) {
      formMessage(form, errorsOf(error));
    }
  } }) : "";
  drawerForm(form, {
    key: `lorry:${t.name}`,
    title: lorry ? t.name : "Add a lorry wala",
    subtitle: lorry ? `${num(t.arrivals)} Aawak rows` : "",
    body: [
      section("Lorry wala", [fieldsGrid([field("LORRY WALA", name)], 1), el("div", { class: "checks" }, [checkbox(active, "Active (offered when typing Aawak rows)"),
        checkbox(own, "The party's own vehicle (not a hired lorry)")])]),
      section("Other spellings", [spellings], "Names the gate's workbook writes for this lorry wala; the Aawak import reads them as this one."),
      lorry ? section("Merge", [checkbox(merge, "If another lorry wala has the new name, move this one's Aawak rows to it")]) : "",
    ],
    actions: [save, remove, el("button", { type: "button", class: "ghost", text: "Close", onclick: () => closeDrawer($("lorryDrawer")) })],
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const saved = await api("/api/masters/transporter", { method: "POST", json: {
        originalName: lorry ? lorry.name : null, name: name.value, active: active.checked, ownVehicle: own.checked, merge: merge.checked,
        otherSpellings: spellings.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
      } });
      markSaved(form);
      await Promise.all([loadMasters(), renderLorryMasters()]);
      fillNameLists();
      openLorryForm(aawakState.lorry.find((x) => x.name === saved.name) || saved);
      toast(`Saved ${saved.name}`);
    } catch (error) {
      formMessage(form, errorsOf(error));
    } finally {
      save.disabled = false;
    }
  };
  openDrawer($("lorryDrawer"), name);
}
