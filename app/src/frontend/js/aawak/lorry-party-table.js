const HEAT_NOTE = {
  nag: "Each cell is NAG for one lorry wala and party. A dot means no arrivals. Row and column totals reconcile to the period total.",
  share: "Each cell is the share of that lorry wala's NAG that went to the party. A dot means no arrivals. Every row adds up to 100%.",
};

// Always-open lorry wala x party table: shaded by NAG so the big flows stand out, with the party names slanted so every column fits.
function crossCheckCard(totals) {
  const { parties, transporters } = totals;
  if (!parties.length || !transporters.length) return "";
  const nagOf = new Map(totals.matrix.map((c) => [JSON.stringify([c.transporter, c.party]), c.nag]));
  const peak = Math.max(1, ...totals.matrix.map((c) => c.nag));
  const longest = Math.max(...parties.map((p) => p.name.length));
  const share = (v, whole) => `${(whole ? v / whole * 100 : 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
  const partyCells = [];
  const col = (i) => ({ "data-col": String(i) });

  const body = transporters.map((t) => {
    const cells = parties.map((p, i) => {
      const v = nagOf.get(JSON.stringify([t.name, p.name])) ?? 0;
      if (!v) {
        return el("td", { class: "report-zero", ...col(i) }, [el("span", { "aria-hidden": "true", text: "\u00b7" }), el("span", { class: "sr-only", text: "No arrivals" })]);
      }
      const td = el("td", {
        class: `report-cell${v / t.nag > 0.5 ? " report-cell-main" : ""}`, ...col(i), style: `--heat:${Math.sqrt(v / peak).toFixed(3)}`,
        title: `${t.name} \u2192 ${p.name}: ${num(v)} NAG \u00b7 ${share(v, t.nag)} of this lorry wala \u00b7 ${share(v, p.nag)} of this party`,
      });
      partyCells.push({ td, v, whole: t.nag });
      return td;
    });
    return el("tr", { "data-name": t.name.toLocaleLowerCase() }, [
      el("th", { scope: "row", class: "report-matrix-name", text: t.name, "data-no-i18n": "all" }), ...cells,
      el("td", { class: "report-matrix-total" }, [
        el("span", { text: num(t.nag) }),
        el("span", { class: "report-meter", "aria-hidden": "true" }, [el("span", { style: `width:${t.nag / transporters[0].nag * 100}%` })]),
      ]),
    ]);
  });
  const footCells = parties.map((_p, i) => el("td", { ...col(i) }));
  const showValues = (mode) => {
    partyCells.forEach(({ td, v, whole }) => { td.textContent = mode === "share" ? share(v, whole) : num(v); });
    footCells.forEach((td, i) => { td.textContent = mode === "share" ? share(parties[i].nag, totals.nag) : num(parties[i].nag); });
  };
  showValues("nag");

  const fullWidth = 150 + parties.length * 64 + 130;
  const table = el("table", { class: "report-matrix", style: `min-width:${fullWidth}px` }, [
    el("caption", { class: "sr-only", text: "NAG by lorry wala and party" }),
    el("thead", {}, [el("tr", {}, [
      el("th", { scope: "col", class: "report-matrix-corner", style: `width:150px;z-index:${parties.length + 5}`, text: "Lorry wala" }),
      ...parties.map((p, i) => el("th", { scope: "col", class: "report-matrix-party", title: p.name, "data-no-i18n": "all", style: `z-index:${parties.length + 3 - i}`, ...col(i) }, [el("span", { text: p.name })])),
      el("th", { scope: "col", class: "report-matrix-sum", style: "width:130px", text: "Total NAG" }),
    ])]),
    el("tbody", {}, body),
    el("tfoot", {}, [el("tr", {}, [el("th", { scope: "row", text: "Total NAG" }), ...footCells, el("td", { class: "report-matrix-total", text: num(totals.nag) })])]),
  ]);

  const markColumn = (index) => table.querySelectorAll("[data-col]").forEach((c) => c.classList.toggle("hl-col", c.dataset.col === index));
  table.addEventListener("mouseover", (event) => markColumn(event.target.closest("[data-col]")?.dataset.col));
  table.addEventListener("mouseleave", () => markColumn(undefined));

  const note = el("p", { class: "muted report-card-note", text: HEAT_NOTE.nag });
  const modes = [["nag", "NAG"], ["share", "% of lorry wala"]];
  const buttons = modes.map(([mode, label]) => el("button", {
    type: "button", "aria-pressed": String(mode === "nag"),
    onclick: () => {
      buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(modes[i][0] === mode)));
      note.textContent = HEAT_NOTE[mode];
      showValues(mode);
    },
  }, [label]));

  const empty = el("p", { class: "report-no-match muted", role: "status", hidden: "", text: "No matching names. Try a different search." });
  const search = el("input", { type: "search", placeholder: "Find a lorry wala or party...", "aria-label": "Search lorry wala and party" });
  search.addEventListener("input", () => {
    const term = search.value.trim().toLocaleLowerCase();
    const rows = [...table.tBodies[0].rows];
    const rowMatch = rows.map((r) => r.dataset.name.includes(term));
    const colMatch = parties.map((p) => p.name.toLocaleLowerCase().includes(term));
    // A term that names a lorry wala narrows the rows, one that names a party narrows the columns; totals stay for the whole period.
    const narrowRows = term && rowMatch.some(Boolean), narrowCols = term && colMatch.some(Boolean);
    rows.forEach((r, i) => { r.hidden = narrowRows && !rowMatch[i]; });
    table.querySelectorAll("[data-col]").forEach((c) => { c.hidden = narrowCols && !colMatch[Number(c.dataset.col)]; });
    empty.hidden = !term || narrowRows || narrowCols;
    table.hidden = !empty.hidden;
    table.style.minWidth = narrowCols ? "0" : `${fullWidth}px`;
    table.style.width = narrowCols ? "auto" : "";
  });

  return el("section", { class: "report-card report-cross", "aria-label": "Lorry wala × party" }, [
    el("div", { class: "report-cross-head" }, [
      el("h2", { text: "Lorry wala \u00d7 party" }),
      el("span", { class: "report-heat-legend", "aria-hidden": "true" }, [el("span", { text: "less" }), el("i"), el("span", { text: "more" })]),
      search,
      el("div", { class: "report-mode", role: "group", "aria-label": "Show NAG or share of lorry wala" }, buttons),
    ]),
    note,
    el("div", { class: "report-matrix-wrap", style: `--angle-h:${Math.round(Math.min(200, Math.max(64, longest * 5.4 + 28)))}px`, tabindex: "0", role: "region", "aria-label": "NAG by lorry wala and party; scroll for more columns" }, [table]),
    empty,
  ]);
}
