"use strict";

// Draft bills: the printed grid, moving lines between bills and saving them.

// ---------- Editable bill grid (drafts and saved bills) ----------
function billGrid(doc, onChange, { readOnly = false, moveControl } = {}) {
  const wrap = el("div", { class: "bill-card" });
  const table = el("table", { class: moveControl ? "bill-grid with-row-moves" : "bill-grid" });
  const totals = el("div", { class: "bill-totals" });
  const warnings = el("ul", { class: "warnings" });
  const calculatedCells = [];

  function cellInput(line, key, type = "text") {
    const input = el("input", { type, class: `g-${key}` });
    input.value = line[key] ?? "";
    input.disabled = readOnly;
    input.addEventListener("change", () => {
      line[key] = type === "number" ? (input.value === "" ? null : Number(input.value)) : input.value;
      onChange(false);
    });
    return input;
  }

  function renderRows() {
    calculatedCells.length = 0;
    const thead = el("thead", {}, [el("tr", {}, ["#", "G.P.N.", "D.N.", "LOT NO.", "FINISH", "THAN", "RATE", "Amount(Rs.)", ""].map((h) => el("th", { text: h })))]);
    const body = el("tbody");
    doc.lines.forEach((line, index) => {
      const tr = el("tr", { class: `k-${line.kind}` });
      const number = el("td", { class: "num", text: String(index + 1) });
      const tall = el("span", { class: "tall-tag" });
      number.append(tall);
      tr.append(number);
      let qty;
      let amount;
      if (line.kind === "blank") {
        tr.append(el("td", { colspan: "7", class: "blank-row", text: "" }));
      } else {
        tr.append(el("td", {}, [cellInput(line, "gpn")]), el("td", {}, [cellInput(line, "dn")]), el("td", {}, [cellInput(line, "lot")]));
        if (line.kind === "priced") {
          tr.append(el("td", {}, [cellInput(line, "finish")]));
          qty = cellInput(line, "qty", "number");
          amount = el("td", { class: "amount" });
          tr.append(el("td", {}, [qty]), el("td", {}, [cellInput(line, "rate", "number")]), amount);
        } else {
          tr.append(el("td", {}), el("td", {}, [cellInput(line, "qty", "number")]), el("td", {}), el("td", {}));
        }
      }
      const actions = el("td", { class: "row-actions" });
      if (!readOnly) {
        actions.append(
          el("button", { type: "button", class: "link", title: "Insert an empty row below", text: "+ row", onclick: () => { doc.lines.splice(index + 1, 0, { kind: "detail", gpn: "", dn: "", lot: "", finish: "", qty: null, rate: null, amount: null, autoSum: false, entryIds: [] }); onChange(); } }),
          el("button", { type: "button", class: "link remove", title: line.entryIds && line.entryIds.length ? "Remove this row — its entries become unbilled again" : "Remove this row", "aria-label": "Remove this row", text: "✕", onclick: () => { doc.lines.splice(index, 1); onChange(); } }),
        );
        const above = doc.lines[index - 1];
        if (line.kind === "detail" && above && above.kind === "detail") {
          actions.append(el("button", { type: "button", class: "link", title: "Combine with the row above (references and THAN are joined)", text: "merge ↑", onclick: () => { mergeUp(doc.lines, index); onChange(); } }));
        }
        if (line.kind !== "blank") {
          const kind = dropdownOf([["detail", "detail"], ["priced", "priced"], ["blank", "blank"]], line.kind, { "aria-label": "Row type" });
          kind.className = "kind-select";
          kind.addEventListener("change", () => { line.kind = kind.value; line.autoSum = false; onChange(); });
          actions.append(kind);
        }
        const move = moveControl?.(line, index);
        if (move) actions.append(move);
      }
      tr.append(actions);
      body.append(tr);
      calculatedCells.push({ tall, qty, amount });
    });
    const cols = el("colgroup", {}, ["num", "gpn", "dn", "lot", "finish", "qty", "rate", "amount", "actions"].map((c) => el("col", { class: `c-${c}` })));
    table.replaceChildren(cols, thead, body);
  }

  function renderCalculation() {
    doc.lines.forEach((line, index) => {
      const { tall, qty, amount } = calculatedCells[index];
      tall.textContent = line.rows > 1 ? `×${line.rows}` : "";
      tall.title = line.rows > 1 ? `The lot / D.N. text is long: this line prints on ${line.rows} rows in a smaller font.` : "";
      if (qty) {
        qty.disabled = readOnly || line.autoSum;
        qty.title = line.autoSum ? "Total of the lines above" : "";
        qty.parentElement.classList.toggle("sum", line.autoSum);
        if (line.autoSum) qty.value = line.qty ?? "";
        amount.classList.toggle("bad", line.amount == null);
        amount.textContent = line.amount == null ? "no rate" : rupees(line.amount);
      }
    });
    renderTotals();
  }

  function renderTotals() {
    const rows = [["Gross Total", rupees(doc.gross)], [`Less/Discount (${num(doc.discountPct)}%)`, rupees(doc.discount)], ["Net Taxable Amount", rupees(doc.taxable)]];
    if (doc.taxMode === "inter") rows.push([`IGST ${doc.igstRate}%`, rupees(doc.igst)]);
    else rows.push([`CGST ${doc.cgstRate}%`, rupees(doc.cgst)], [`SGST ${doc.sgstRate}%`, rupees(doc.sgst)]);
    rows.push(["Invoice Total", rupees(doc.total)]);
    const limit = doc.firm && doc.firm.invoiceLimit;
    totals.replaceChildren(
      el("table", {}, [el("tbody", {}, rows.map(([k, v], i) => el("tr", { class: i === rows.length - 1 ? "grand" : "" }, [el("th", { text: k }), el("td", { text: v })])))]),
      el("div", { class: "words", text: (doc.amountInWords || "").replace(/\s+/g, " ").trim() }),
      el("div", { class: "muted", text: `${num(doc.than)} THAN · ${num(doc.lines.filter((l) => l.kind !== "blank").length)} lines · ${num(doc.lines.reduce((s, l) => s + (l.rows || 1), 0))} of ${num(doc.firm ? doc.firm.rowsPerInvoice : 25)} printed rows${limit ? ` · limit ${rupees(limit)}` : ""}` }),
    );
    warnings.replaceChildren(...(doc.warnings || []).map((w) => el("li", { text: w })));
  }

  wrap.append(table, el("div", { class: "bill-foot" }, [totals, warnings]));
  renderRows();
  renderCalculation();
  return { node: wrap, renderCalculation, refresh: () => { renderRows(); renderCalculation(); } };
}

function mergeUp(lines, index) {
  const top = lines[index - 1];
  const row = lines[index];
  const join = (a, b) => [...new Set([a, b].flatMap((v) => String(v || "").split(",")).map((v) => v.trim()).filter(Boolean))].join(",");
  top.gpn = join(top.gpn, row.gpn);
  top.dn = join(top.dn, row.dn);
  top.lot = join(top.lot, row.lot);
  top.qty = (top.qty || 0) + (row.qty || 0);
  top.entryIds = [...(top.entryIds || []), ...(row.entryIds || [])];
  lines.splice(index, 1);
}

function detailSubtotal(lines, index) {
  const next = lines.findIndex((line, i) => i > index && line.kind !== "detail");
  return lines[next]?.kind === "priced" && lines[next].autoSum ? next : -1;
}

function hasRowContent(line) {
  return Boolean(line.gpn || line.dn || line.lot || line.entryIds?.length || (line.kind === "detail" && line.qty !== null));
}

function asBillDetail(line) {
  return { ...line, kind: "detail", finish: "", rate: null, amount: null, autoSum: false };
}

function appendMovedBillRow(target, row, pricing) {
  const lines = target.lines;
  const finishLabel = pricing?.finish || "";
  const finish = normalize(finishLabel);
  const rate = pricing?.rate ?? null;
  const sameFinish = (line) => line.kind === "priced" && normalize(line.finish) === finish;
  const match = finish ? lines.findLastIndex((line, i) => sameFinish(line) && line.rate === rate
    && line.autoSum === (lines[i - 1]?.kind === "detail")) : -1;
  if (match < 0 && finish && rowCapacity(target) - printedRows(target) === 1 && !lines.some(sameFinish)) {
    // Keep a standalone priced row separate from any unfinished detail rows at the end.
    const insertAt = lines.findLastIndex((line) => line.kind !== "detail") + 1;
    lines.splice(insertAt, 0, { ...row, kind: "priced", finish: finishLabel, rate, amount: null, autoSum: false });
    return;
  }

  const detail = asBillDetail(row);
  if (match >= 0 && lines[match].autoSum) {
    lines.splice(match, 0, detail);
    return;
  }

  const subtotal = { kind: "priced", gpn: "", dn: "", lot: "", finish: finishLabel, qty: null, rate, amount: null, autoSum: true, entryIds: [] };
  if (match >= 0) {
    const existing = lines[match];
    lines.splice(match, 1, asBillDetail(existing), detail, { ...subtotal, finish: existing.finish });
  } else {
    // Do not include unrelated trailing detail rows in the moved entry's subtotal.
    if (lines.at(-1)?.kind === "detail") lines.push({ ...subtotal, kind: "blank", finish: "", rate: null, autoSum: false });
    lines.push(detail, subtotal);
  }
}

function moveBillLine(source, target, index) {
  const row = source.lines[index];
  const from = [...source.lines];
  const to = { ...target, lines: [...target.lines] };
  let pricing = row;
  let removedBlock = row.kind === "priced";
  if (row.kind === "detail") {
    const end = detailSubtotal(from, index);
    pricing = from[end];
    const onlyDetail = end === index + 1 && from[index - 1]?.kind !== "detail";
    if (onlyDetail && hasRowContent(pricing)) {
      throw new Error("This subtotal has its own references. Clear them before moving its last detail row.");
    }
    if (onlyDetail) from.splice(end, 1);
    removedBlock = onlyDetail;
  }
  appendMovedBillRow(to, row, pricing);
  from.splice(index, 1);
  if (removedBlock) {
    // Drop only the separator left behind by a removed finish block, not rows with references.
    if (from[index]?.kind === "blank" && !hasRowContent(from[index]) && (!index || from[index - 1].kind === "blank")) from.splice(index, 1);
    else if (index === from.length && from.at(-1)?.kind === "blank" && !hasRowContent(from.at(-1))) from.pop();
  }
  if (!from.some((line) => line.kind === "priced")) {
    if (from.some(hasRowContent)) throw new Error("Give the remaining rows a rate or move them first before emptying this bill.");
    return [null, to];
  }
  return [{ ...source, lines: from }, to];
}

const printedRows = (doc) => doc.lines.reduce((sum, line) => sum + Math.max(1, line.rows || 1), 0);
const rowCapacity = (doc) => doc.firm?.rowsPerInvoice || 25;
const isFull = (doc) => printedRows(doc) >= rowCapacity(doc);

const computeBill = (doc, recipient) => api(`/api/billing/compute${recipient ? `?recipient=${encodeURIComponent(recipient)}` : ""}`, { method: "POST", json: doc });

function renderDrafts() {
  const area = $("draftArea");
  const drafts = billsState.drafts;
  const save = $("saveBills");
  const scrollTop = area.scrollTop;
  const recipients = billsState.candidates?.billRecipients || [];
  const calculations = new Map();
  const fullMarkers = new Set();

  async function moveRow(sourceIndex, targetIndex, rowIndex, control) {
    if (area.inert) return;
    area.inert = true;
    save.disabled = true;
    let focus = control;
    let keepScroll = true;
    let activeDrafts = drafts;
    try {
      await Promise.all(calculations.values());
      if (billsState.drafts !== drafts) return;
      const original = drafts[sourceIndex];
      const newBill = targetIndex === drafts.length;
      const destination = newBill ? { ...original, notes: "", lines: [], billSerial: null } : drafts[targetIndex];
      const [source, target] = moveBillLine(original, destination, rowIndex);
      const [freshSource, freshTarget] = await Promise.all([source ? computeBill(source) : null, computeBill(target)]);
      if (billsState.drafts !== drafts) return;
      // The server does not know the typed bill number, so carry it over to the recalculated bills.
      if (freshSource) freshSource.billSerial = original.billSerial ?? null;
      freshTarget.billSerial = destination.billSerial ?? null;
      if (printedRows(freshTarget) > rowCapacity(freshTarget)) {
        throw new Error(`Bill ${targetIndex + 1} is full (${rowCapacity(freshTarget)} printed rows). The row was not moved.`);
      }
      activeDrafts = drafts.map((doc, i) => i === sourceIndex ? freshSource : i === targetIndex ? freshTarget : doc).filter(Boolean);
      if (newBill) activeDrafts.push(freshTarget);
      billsState.drafts = activeDrafts;
      renderDrafts();
      const newTarget = !freshSource && sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      const card = area.querySelectorAll(".draft")[freshSource ? sourceIndex : newTarget];
      const moves = card.querySelectorAll(".move-bill-row");
      focus = (freshSource && moves[Math.min(rowIndex, moves.length - 1)]) || card.querySelector("h2");
      keepScroll = Boolean(freshSource);
      const moved = `Row moved to Bill ${newTarget + 1}.`;
      setBillMessage(freshSource ? moved : `${moved} The empty draft was removed.`, "ok");
    } catch (error) {
      if (billsState.drafts !== drafts) return;
      setBillMessage(error.message, "err");
    } finally {
      if (billsState.drafts === activeDrafts) {
        area.inert = false;
        save.disabled = false;
        focus.focus({ preventScroll: keepScroll });
      }
    }
  }

  async function changeRecipient(doc, select) {
    if (area.inert) return;
    const recipient = select.value;
    area.inert = true;
    save.disabled = true;
    try {
      await Promise.all(calculations.values());
      if (billsState.drafts !== drafts) return;
      const fresh = await computeBill(doc, recipient);
      if (billsState.drafts !== drafts) return;
      Object.assign(doc, fresh);
      renderDrafts();
      setBillMessage("Bill recipient updated.", "ok");
    } catch (error) {
      if (billsState.drafts !== drafts) return;
      select.value = doc.party;
      setBillMessage(error.message, "err");
    } finally {
      if (billsState.drafts === drafts) {
        area.inert = false;
        save.disabled = false;
        area.querySelectorAll(".draft-recipient")[drafts.indexOf(doc)]?.focus({ preventScroll: true });
      }
    }
  }

  const numberFields = [];
  let numberRevision = 0;
  let numberTimer = 0;

  // Shows the number each bill would get now: typed numbers as typed (flagged if they clash), the rest as the next free numbers.
  async function refreshNumbers() {
    clearTimeout(numberTimer);
    const ticket = ++numberRevision;
    try {
      const numbers = await api("/api/billing/numbers", { method: "POST", json: {
        bills: drafts.map((doc) => ({ billDate: doc.billDate, serial: doc.billSerial ?? null })),
      } });
      if (ticket !== numberRevision || billsState.drafts !== drafts) return;
      billsState.numbers = numbers;
      numbers.forEach((number, i) => numberFields[i]?.show(number));
    } catch (error) {
      if (ticket === numberRevision && billsState.drafts === drafts) setBillMessage(error.message, "err");
    }
  }

  function billNumberField(doc, i) {
    const input = el("input", { type: "number", min: "1", step: "1", inputmode: "numeric", id: `billNo${i}`, class: "bill-no-input" });
    input.setAttribute("aria-label", `Bill no. for Bill ${i + 1}`);
    const prefix = el("span", { class: "bill-no-prefix", "data-no-i18n": "all" });
    const problem = el("span", { class: "bill-no-problem", role: "alert" });
    if (doc.billSerial != null) input.value = doc.billSerial;
    input.addEventListener("input", () => {
      const text = input.value.trim();
      doc.billSerial = text === "" ? null : Number.isInteger(Number(text)) ? Number(text) : 0;
      clearTimeout(numberTimer);
      numberTimer = setTimeout(refreshNumbers, 250);
    });
    input.addEventListener("change", refreshNumbers);
    const node = el("div", { class: "bill-no-row" }, [
      el("label", { for: input.id, text: "Bill no." }), prefix, input,
      el("span", { class: "muted bill-no-hint", text: "You can change it. It cannot match a bill already saved." }), problem,
    ]);
    const show = ({ serial, invoiceNo, problem: why }) => {
      prefix.textContent = invoiceNo.slice(0, invoiceNo.length - String(serial).length);
      if (doc.billSerial == null && document.activeElement !== input) input.value = serial || "";
      input.classList.toggle("invalid", Boolean(why));
      input.setAttribute("aria-invalid", why ? "true" : "false");
      problem.textContent = why || "";
    };
    return { node, show };
  }

  area.replaceChildren();
  area.append(el("p", { class: "muted draft-move-hint", text: "Use Move… to send a row to another draft or start a new bill." }));
  drafts.forEach((doc, i) => {
    const title = el("h2", { tabindex: "-1" });
    const total = el("span");
    const recipient = recipients.length > 1 ? dropdownOf(recipients.map((name) => [name, name]), doc.party) : null;
    if (recipient) {
      recipient.className = "draft-recipient";
      recipient.setAttribute("aria-label", `Bill recipient for Bill ${i + 1}`);
      recipient.setAttribute("data-no-i18n", "all");
      recipient.addEventListener("change", () => changeRecipient(doc, recipient));
    }
    title.append(el("span", { text: `Bill ${i + 1} of ${drafts.length} — ` }), recipient || el("span", { text: doc.partyName }), total);
    const setTitle = () => { total.textContent = ` — ${rupees(doc.total)}`; };
    const targets = drafts.flatMap((_, j) => j === i ? [] : [j]);
    const moveControl = (row, index) => {
      const movable = row.kind === "detail" || (row.kind === "priced" && !row.autoSum && doc.lines[index - 1]?.kind !== "detail");
      if (!movable) return null;
      const select = dropdownOf([]);
      select.className = "move-bill-row";
      // A bill at its printed-row limit cannot take another row; refreshed after every recalculation and when the menu opens.
      const markFull = () => {
        setDropdownOptions(select, [["", "Move…"], ...targets.map((j) => {
          const full = isFull(drafts[j]);
          return [String(j), `Bill ${j + 1}${full ? " (full)" : ""}`, full];
        }), ["new", "New bill"]], select.value);
      };
      markFull();
      markFull.select = select;
      fullMarkers.add(markFull);
      select.setAttribute("aria-label", `Move row ${index + 1} from Bill ${i + 1}`);
      select.addEventListener("change", () => {
        const target = select.value;
        select.value = "";
        if (target !== "") moveRow(i, target === "new" ? drafts.length : Number(target), index, select);
      });
      return select;
    };
    let grid;
    let revision = 0;
    const recompute = async (redraw = true) => {
      const ticket = ++revision;
      const current = () => ticket === revision && billsState.drafts === drafts;
      if (redraw) grid.refresh();
      try {
        const { lines, ...fresh } = await computeBill(doc);
        if (!current()) return;
        Object.assign(doc, fresh);
        // Keep live inputs and move menus in place while a cell edit is being recalculated.
        const redrawMoves = lines.some((line, index) => line.autoSum !== doc.lines[index].autoSum);
        lines.forEach(({ qty, rows, amount, autoSum }, index) => Object.assign(doc.lines[index], { qty, rows, amount, autoSum }));
        setTitle();
        if (redrawMoves) grid.refresh();
        else grid.renderCalculation();
        // Menus of rows drawn again are gone from the page: they are dropped instead of piling up.
        for (const markFull of fullMarkers) {
          if (markFull.select.isConnected) markFull();
          else fullMarkers.delete(markFull);
        }
        if (!area.inert) setBillMessage("", "");
      } catch (error) {
        if (current() && !area.inert) setBillMessage(error.message, "err");
      }
    };
    grid = billGrid(doc, (redraw) => calculations.set(doc, recompute(redraw)), { moveControl });
    setTitle();
    const numberField = billNumberField(doc, i);
    numberFields.push(numberField);
    area.append(el("section", { class: "card draft" }, [title, numberField.node, grid.node]));
  });
  area.scrollTop = scrollTop;
  showBillStage(drafts.length ? "preview" : "entries");
  save.textContent = `Save and number ${drafts.length === 1 ? "this bill" : `these ${drafts.length} bills`}`;
  if (drafts.length) refreshNumbers();
}

$("saveBills").addEventListener("click", async () => {
  if ($("draftArea").inert) return;
  const party = billsState.candidates.billParty;
  const clash = billsState.numbers.find((number) => number.problem);
  if (clash) {
    setBillMessage(clash.problem, "err");
    return;
  }
  const navigation = [...document.querySelectorAll("#billMonth, #billDate, #periodFrom, #periodTo, #billParty, #toBillList button, #discardBills")].map((node) => [node, node.disabled]);
  navigation.forEach(([node]) => { node.disabled = true; });
  $("draftArea").inert = true;
  $("saveBills").disabled = true;
  try {
    const saved = await api("/api/billing/save", { method: "POST", json: {
      invoices: billsState.drafts, serials: billsState.drafts.map((doc) => doc.billSerial ?? null),
    } });
    const ids = saved.map((s) => s.id).join(",");
    state.entriesCache.clear();
    await loadCandidates(party, { force: true });
    setBillMessage(`Saved ✓ ${saved.map((s) => s.invoiceNo).join(", ")}`, "ok");
    $("draftArea").replaceChildren(el("div", { class: "report ok" }, [
      el("h2", { text: `Saved ${saved.length} bill(s)` }),
      el("ul", {}, saved.map((s) => el("li", { text: `${s.invoiceNo} — ${s.partyName} — ${num(s.than)} THAN — ${rupees(s.total)}` }))),
      el("button", { type: "button", id: "printSaved", text: "Print these bills", onclick: () => openPrint(ids) }),
      el("button", { type: "button", class: "secondary", id: "pdfSaved", text: "Save as PDF", onclick: (e) => downloadPdf(saved.map((s) => s.id), e.currentTarget) }),
      el("button", { type: "button", class: "secondary", id: "excelSaved", text: "Export to Excel…", onclick: () => openExcelExport(saved) }),
    ]));
    $("billSelectedCount").textContent = `Saved ${saved.length} bill(s)`;
    $("billSelectedThan").textContent = `${num(saved.reduce((sum, doc) => sum + doc.than, 0))} THAN`;
    showBillStage("saved");
  } catch (error) {
    setBillMessage(error.message, "err");
  } finally {
    navigation.forEach(([node, disabled]) => { node.disabled = disabled; });
    $("draftArea").inert = false;
    $("saveBills").disabled = false;
  }
});

function openPrint(ids) {
  window.open(`print.html?ids=${encodeURIComponent(ids)}`, "_blank", "noopener");
}
