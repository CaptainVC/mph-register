"use strict";

// Exporting bills into the Excel bill workbook.

// ---------- Write saved bills into a copy of the Excel bill workbook ----------
// The workbook is uploaded, checked (where each bill goes and what is typed over its formulas), and a filled copy comes
// back as a download; the user's own file is never changed.
const EXCEL_STATUS = {
  write: ["Will be written", "good"],
  replace: ["Will be written over", "good"],
  same: ["Already in the workbook", "muted"],
  different: ["In the workbook, but different", "bad"],
  blocked: ["Cannot be written", "bad"],
};
const excelState = { bills: [], preview: null, replace: new Set(), ticket: 0 };

function openExcelExport(bills) {
  // Bills made in the app first: those imported from Excel are already in a workbook.
  const live = bills.filter((b) => b.status !== "cancelled");
  excelState.bills = [...live.filter((b) => b.source !== "excel"), ...live.filter((b) => b.source === "excel")];
  excelState.preview = null;
  excelState.replace = new Set();
  const form = $("excelForm");
  const file = el("input", { type: "file", id: "excelFile", accept: ".xlsm,.xlsx", "data-instant": "" });
  file.addEventListener("change", () => checkExcelWorkbook());
  const rows = excelState.bills.map((b) => {
    const tick = el("input", { type: "checkbox", "data-id": String(b.id), "data-instant": "", "aria-label": `Write ${b.invoiceNo}` });
    tick.checked = b.source !== "excel";
    tick.addEventListener("change", () => checkExcelWorkbook());
    return el("tr", {}, [el("td", {}, [tick]), el("td", { class: "inward", text: b.invoiceNo }), el("td", { text: dotDate(b.billDate) }),
      el("td", { class: "left", text: b.partyName }), el("td", { class: "money", text: rupees(b.total) }),
      el("td", { text: b.source === "excel" ? "Excel" : "App" }), excelCell(b)]);
  });
  const all = el("input", { type: "checkbox", id: "excelAll", "data-instant": "", "aria-label": "Tick every bill" });
  all.checked = rows.length > 0 && excelState.bills.every((b) => b.source !== "excel");
  all.addEventListener("change", () => {
    form.querySelectorAll("#excelBills tbody input[type=checkbox]").forEach((tick) => { tick.checked = all.checked; });
    checkExcelWorkbook();
  });
  const table = el("table", { class: "register", id: "excelBills" }, [
    el("thead", {}, [el("tr", {}, [el("th", {}, [all]), ...["BILL NO.", "DATE", "PARTY", "TOTAL", "FROM", "EXCEL"].map((h) => el("th", { text: h }))])]),
    el("tbody", {}, rows),
  ]);
  const check = el("button", { type: "button", class: "secondary", id: "excelCheck", text: "Check again", onclick: () => checkExcelWorkbook() });
  const download = el("button", { type: "button", id: "excelDownload", text: "Download filled workbook", onclick: (e) => downloadExcelWorkbook(e.currentTarget) });
  download.disabled = true;
  const close = el("button", { type: "button", class: "ghost", text: "Close", onclick: () => closeDrawer($("excelDrawer")) });
  drawerForm(form, {
    key: "excel",
    title: "Export bills to Excel",
    subtitle: "Into a copy of the month's bill workbook — your file is not changed",
    body: [
      section("1. Bills", [
        el("p", { class: "muted", text: "Only saved bills can be written. Each goes into the place of the workbook that has its bill no." }),
        el("div", { class: "table-wrap excel-bills" }, [table]),
      ], `${num(excelState.bills.length)} bills`),
      section("2. Bill workbook", [
        field("Bill workbook (.xlsm / .xlsx)", file, "This month's MPH BILL workbook. It is read, never changed: you download a filled copy."),
      ]),
      section("3. Check", [el("div", { id: "excelPreview" }, [el("p", { class: "muted", text: "Choose the bill workbook to see where each bill goes." })])]),
    ],
    actions: [download, check, close],
  });
  openDrawer($("excelDrawer"), file);
}

function excelRequest() {
  const ids = [...$("excelForm").querySelectorAll("#excelBills tbody input[type=checkbox]:checked")].map((tick) => Number(tick.dataset.id));
  return { ids, replace: ids.filter((id) => excelState.replace.has(id)) };
}

function excelForm(request) {
  const form = new FormData();
  form.append("file", $("excelFile").files[0]);
  form.append("request", JSON.stringify(request));
  return form;
}

function sayExcel(text, kind) {
  const message = $("excelForm").querySelector(".form-message");
  if (!message) return;
  message.textContent = text;
  message.className = `form-message message ${kind || ""}`;
}

async function checkExcelWorkbook() {
  const ticket = ++excelState.ticket;
  $("excelDownload").disabled = true;
  if (!$("excelFile")?.files[0]) return;
  const request = excelRequest();
  if (!request.ids.length) {
    $("excelPreview").replaceChildren(el("p", { class: "muted", text: "Tick the bills to write." }));
    return;
  }
  sayExcel("Checking the workbook…", "");
  try {
    const preview = await api("/api/billing/excel/preview", { method: "POST", body: excelForm(request) });
    if (ticket !== excelState.ticket) return;
    excelState.preview = preview;
    renderExcelPreview(preview);
    sayExcel(preview.toWrite ? `${num(preview.toWrite)} bill(s) will be written. Nothing is saved until you download the filled workbook.` : "Nothing to write yet.", preview.toWrite ? "ok" : "warn");
    $("excelDownload").disabled = preview.toWrite === 0;
  } catch (error) {
    if (ticket !== excelState.ticket) return;
    excelState.preview = null;
    $("excelPreview").replaceChildren(el("div", { class: "report err" }, [el("ul", {}, (error.errors || [error.message]).map((e) => el("li", { text: e })))]));
    sayExcel(error.message, "err");
  }
}

function renderExcelPreview(preview) {
  const children = [el("div", { class: "chips" }, [
    el("span", {}, ["Workbook: ", el("b", { text: preview.fileName })]),
    el("span", {}, ["Bill nos.: ", el("b", { text: preview.firstNumber ? `${preview.firstNumber} – ${preview.lastNumber}` : "none" })]),
    el("span", {}, ["Places filled: ", el("b", { text: `${num(preview.filledPlaces)} of ${num(preview.places)}` })]),
    el("span", {}, ["To write: ", el("b", { text: num(preview.toWrite) })]),
  ])];
  if (preview.problems.length) children.push(el("ul", { class: "message err", id: "excelProblems" }, preview.problems.map((p) => el("li", { text: p }))));
  if (preview.notes.length) children.push(el("ul", { class: "warnings", id: "excelNotes" }, preview.notes.map((n) => el("li", { text: n }))));
  const body = preview.bills.map((b) => {
    const [label, tone] = EXCEL_STATUS[b.status] || [b.status, ""];
    const details = [...b.problems, ...b.differences, ...b.typed];
    const result = el("td", { class: `${tone} left`, text: label });
    if (b.status === "different" || b.status === "replace") {
      const replace = el("input", { type: "checkbox", "data-instant": "", "data-replace": String(b.invoiceId) });
      replace.checked = excelState.replace.has(b.invoiceId);
      replace.addEventListener("change", () => {
        if (replace.checked) excelState.replace.add(b.invoiceId);
        else excelState.replace.delete(b.invoiceId);
        checkExcelWorkbook();
      });
      result.append(el("label", { class: "check" }, [replace, "Replace"]));
    }
    return el("tr", { "data-id": String(b.invoiceId) }, [
      el("td", { class: "inward", text: b.invoiceNo }), el("td", { class: "left", text: b.partyName }), el("td", { class: "money", text: rupees(b.total) }),
      el("td", { class: "left", text: b.place || "—" }), result,
      el("td", { class: "left excel-details" }, details.length ? [el("ul", {}, details.map((d) => el("li", { text: d })))] : []),
    ]);
  });
  children.push(el("div", { class: "table-wrap" }, [el("table", { class: "register", id: "excelResult" }, [
    el("thead", {}, [el("tr", {}, ["BILL NO.", "PARTY", "TOTAL", "PLACE", "RESULT", "TYPED / DIFFERENCES"].map((h) => el("th", { text: h })))]),
    el("tbody", {}, body),
  ])]));
  $("excelPreview").replaceChildren(...children);
}

async function downloadExcelWorkbook(button) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Writing…";
  try {
    const response = await fetch("/api/billing/excel/export", { method: "POST", headers: { "X-MPH-Request": "1" }, body: excelForm(excelRequest()) });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.errors?.join(" ") || `Writing the workbook failed (${response.status}).`);
    }
    const name = /filename\*=UTF-8''([^;]+)/i.exec(response.headers.get("Content-Disposition") || "")?.[1];
    const fileName = name ? decodeURIComponent(name) : $("excelFile").files[0].name;
    const url = URL.createObjectURL(await response.blob());
    const link = el("a", { href: url, download: fileName });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    const count = excelState.preview?.toWrite ?? 0;
    sayExcel(`Downloaded ${fileName} with ${num(count)} bill(s) written. Open it in Excel and check it, then replace your workbook with it (keep the old one until you have checked).`, "ok");
    toast(`Downloaded ${fileName}: ${num(count)} bill(s) written`);
    await refreshInvoices();
  } catch (error) {
    sayExcel(error.message, "err");
    toast(`Could not write the workbook: ${error.message}`, "err");
  } finally {
    button.textContent = label;
    button.disabled = !excelState.preview?.toWrite;
  }
}
