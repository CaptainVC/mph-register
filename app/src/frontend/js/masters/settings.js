"use strict";

// Settings: firm details, bill rules, texts, the config file and the signature.

// ---------- Firm and bill settings ----------
const FIRM_FIELDS = [
  ["name", "Firm name"], ["gstin", "Firm GSTIN"], ["addressLine1", "Address line 1"], ["addressLine2", "Address line 2"],
  ["phoneLine", "Phone line"], ["msmeLine", "MSME / Udyam line"], ["homeStateCode", "Home state GST code (08 = Rajasthan)"], ["homeStateName", "Home state name"],
];
const RULE_FIELDS = [
  ["numberPrefix", "Bill number prefix ({FY} = 26-27)", "text"], ["totalMustStayBelow", "Bill total must stay below ₹ (0 = no limit)", "number", "1"],
  ["rowsPerBill", "Rows per bill", "number", "1"], ["combineSmallBelowThan", "Combine entries with THAN below (0 = never)", "number", "1"],
  ["combineUpTo", "Combine up to (entries per line)", "number", "1"], ["cgstPercent", "CGST %", "number", "0.01"],
  ["sgstPercent", "SGST %", "number", "0.01"], ["igstPercent", "IGST % (other states)", "number", "0.01"],
];
const TEXT_GROUPS = [
  ["Top of the bill", [["title", "Title"], ["copyLabel", "Copy label"], ["firmGstinPrefix", "Before the firm GSTIN"], ["partyDetailsLabel", "Party details label"],
    ["invoiceNoLabel", "Invoice no. label"], ["datedLabel", "Date label"], ["periodLabel", "Before the bill period"], ["periodJoiner", "Between period dates"],
    ["partyGstinPrefix", "Before the party GSTIN"], ["invoiceKind", "Kind of bill"], ["sacLine", "SAC line"]]],
  ["Column headings", [["gpnHeader", "G.P.N."], ["dnHeader", "D.N."], ["lotHeader", "LOT NO."], ["finishHeader", "FINISH"], ["thanHeader", "THAN"], ["rateHeader", "RATE"], ["amountHeader", "Amount"]]],
  ["Totals", [["grossLabel", "Gross"], ["totalRsLabel", "Total Rs."], ["discountLabel", "Discount"], ["taxableLabel", "Taxable"], ["cgstLabel", "CGST"], ["sgstLabel", "SGST"], ["igstLabel", "IGST"], ["totalLabel", "Invoice total"]]],
  ["Bottom of the bill", [["bankLine1", "Bank line 1"], ["bankLine2", "Bank line 2"], ["paymentLine", "Payment line"], ["signatory", "Signatory line"], ["signatureLabel", "Signature label"], ["checkedByLabel", "Checked-by label"]]],
];

function textInputs(values, fields, prefix) {
  const inputs = {};
  const nodes = fields.map(([key, label, type = "text", step]) => {
    const node = input(`${prefix}-${key}`, values[key] ?? "", { type, ...(step ? { step, min: "0" } : {}) });
    inputs[key] = node;
    return field(label, node);
  });
  return { inputs, nodes };
}

function settingsCard(id, title, children, note) {
  return el("section", { class: "card", id }, [el("div", { class: "card-head" }, [el("h2", { text: title }), note ? el("span", { class: "muted", text: note }) : ""]), ...children]);
}

async function renderFirmForm(fy) {
  const settings = await api(`/api/settings${fy ? `?fy=${encodeURIComponent(fy)}` : ""}`);
  mastersState.settings = settings;
  const form = $("firmForm");
  const firm = textInputs(settings.firm, FIRM_FIELDS, "firm");
  const rules = textInputs(settings.billRules, RULE_FIELDS, "rule");
  const limitHint = el("span", { class: "hint", id: "rule-limit-hint" });
  const showLimit = () => { const v = Number(rules.inputs.totalMustStayBelow.value); limitHint.textContent = v > 0 ? `= ${money(v)}` : "no limit"; };
  rules.inputs.totalMustStayBelow.addEventListener("input", showLimit);
  showLimit();
  rules.inputs.totalMustStayBelow.parentElement.append(limitHint);
  const limits = settings.limits;
  rules.inputs.rowsPerBill.parentElement.append(el("span", { class: "hint", id: "rule-rows-hint",
    text: `The printed bill has ${limits.templateRows}. Up to ${limits.maxRowsLetter} fit on Letter, ${limits.maxRowsA4} on A4 (smallest font ${settings.print.smallestFontPt} pt); more rows are drawn shorter.` }));

  const fyInput = input("firm-fy", settings.fy, { maxlength: "5" });
  const next = input("firm-next", settings.nextSerial, { type: "number", min: "1", step: "1" });
  fyInput.addEventListener("change", () => { if (/^\d{2}-\d{2}$/.test(fyInput.value)) renderFirmForm(fyInput.value); });

  const paper = dropdownOf([["letter", "Letter (same as the Excel bill)"], ["a4", "A4"]], settings.print.paperSize || "letter");
  paper.id = "print-paper";
  const indian = el("input", { type: "checkbox", id: "print-indian" });
  indian.checked = settings.print.indianDigitGrouping !== false;
  const smallest = input("print-smallest", settings.print.smallestFontPt, { type: "number", min: "5", max: "12", step: "0.25" });
  const fonts = Object.entries(settings.print.fontFallbacks || {}).map(([font, list]) => {
    const node = el("input", { type: "text", id: `print-font-${font.replace(/\s+/g, "-").toLowerCase()}`, "data-font": font, class: "font-list" });
    node.value = list;
    return field(`If ${font} is missing, use`, node, "", "span-2");
  });

  const texts = TEXT_GROUPS.map(([title, fields]) => ({ title, ...textInputs(settings.printedTexts, fields, "text") }));
  const terms = el("textarea", { id: "text-terms", rows: "4" });
  terms.value = (settings.printedTexts.terms || []).join("\n");

  const theme = dropdownOf([["light", "Light"], ["dark", "Dark"]], settings.display.theme || "light");
  theme.id = "display-theme";
  const language = dropdownOf([["en", "English"], ["hi", "हिन्दी (Hinglish)"]], settings.display.language || "en");
  language.id = "display-language";

  const featureToggle = (id, label, hint, checked) => {
    const box = el("input", { type: "checkbox", id });
    box.checked = checked;
    return {
      input: box,
      node: el("div", { class: "feature-item" }, [checkbox(box, label), el("span", { class: "hint", text: hint })]),
    };
  };
  const showBillingStyles = featureToggle("feature-billing-styles", "Billing styles", "Masters → Billing styles subsection (hidden by default)", settings.display.showBillingStyles === true);
  const showImport = featureToggle("display-import", "Excel import", "Import Excel tab (inward register and bills)", settings.display.showExcelImport !== false);
  const showPartywise = featureToggle("feature-partywise", "Party-wise", "Party-wise tab", settings.display.showPartywise !== false);
  const showBills = featureToggle("feature-bills", "Bills", "Bills tab (make and saved bills)", settings.display.showBills !== false);
  const showColors = featureToggle("feature-colors", "Colours", "Masters → Colours subsection", settings.display.showColors !== false);
  const dashboardToggle = featureToggle("feature-dashboard", "Dashboard", "Dashboard tab (income, unbilled work, GST and parties)", settings.display.showDashboard !== false);
  const aawakToggle = featureToggle("feature-aawak", "Aawak", "Aawak tab (goods arriving at the gate)", settings.display.showAawak !== false);

  const save = el("button", { type: "submit", id: "firm-save", text: "Save settings" });
  const cards = [
    settingsCard("set-firm", "Firm details", [fieldsGrid(firm.nodes)], "Printed on every bill"),
    settingsCard("set-rules", "Bill rules", [fieldsGrid(rules.nodes)]),
    settingsCard("set-numbers", "Bill numbers", [fieldsGrid([field("Financial year", fyInput), field("Next bill number in this year", next)])], "Kept in the data file"),
    settingsCard("set-print", "Printing", [
      fieldsGrid([field("Paper", paper), field("Smallest font on bill lines (pt)", smallest, "Long lot / D.N. lists shrink to this, then wrap onto a second row."), ...fonts]),
      el("div", { class: "checks" }, [checkbox(indian, "Amounts in lakhs style (₹1,37,757.00)")]),
    ]),
    settingsCard("set-texts", "Texts printed on the bill", [
      ...texts.flatMap((g) => [el("h3", { text: g.title }), fieldsGrid(g.nodes, 3)]),
      el("h3", { text: "Terms (one per line, up to 4)" }), terms,
    ]),
    settingsCard("set-signature", "Signature", [signatureBlock(settings)], "Kept in the config file"),
    settingsCard("set-screens", "Appearance", [fieldsGrid([field("Theme (also in the right-side menu)", theme), field("Language (also in the right-side menu)", language)])]),
    settingsCard("set-features", "Features", [
      el("div", { class: "feature-list" }, [showBillingStyles.node, showImport.node, showPartywise.node, showBills.node, showColors.node, dashboardToggle.node, aawakToggle.node]),
    ], "Show or hide screens and sections in the UI"),
    configFileBlock(settings),
  ];
  form.replaceChildren(...cards, el("div", { class: "save-bar" }, [save, el("div", { class: "form-message message", role: "status" })]));
  renderSettingsNav(cards);

  form.onsubmit = async (event) => {
    event.preventDefault();
    const read = (inputs, fields) => Object.fromEntries(fields.map(([key, , type]) => [key, type === "number" ? Number(inputs[key].value) : inputs[key].value]));
    const printedTexts = { ...settings.printedTexts, terms: terms.value.split("\n").map((t) => t.trimEnd()).filter((t) => t.length) };
    for (const g of texts) Object.assign(printedTexts, read(g.inputs, TEXT_GROUPS.find(([t]) => t === g.title)[1]));
    const fontFallbacks = Object.fromEntries([...form.querySelectorAll(".font-list")].map((i) => [i.dataset.font, i.value]));
    const payload = {
      firm: { ...settings.firm, ...read(firm.inputs, FIRM_FIELDS) },
      billRules: { ...settings.billRules, ...read(rules.inputs, RULE_FIELDS) },
      printedTexts,
      print: { ...settings.print, paperSize: paper.value, indianDigitGrouping: indian.checked, smallestFontPt: Number(smallest.value), fontFallbacks },
      display: {
        ...settings.display,
        theme: theme.value,
        language: language.value,
        showExcelImport: showImport.input.checked,
        showBillingStyles: showBillingStyles.input.checked,
        showPartywise: showPartywise.input.checked,
        showBills: showBills.input.checked,
        showColors: showColors.input.checked,
        showDashboard: dashboardToggle.input.checked,
        showAawak: aawakToggle.input.checked,
      },
      fy: fyInput.value, nextSerial: Number(next.value),
    };
    save.disabled = true;
    try {
      const saved = await api("/api/settings", { method: "PUT", json: payload });
      mastersState.settings = saved;
      const scroll = $("settingsScroll").scrollTop;
      await refreshInfo();
      await renderFirmForm(saved.fy);
      $("settingsScroll").scrollTop = scroll;
      toast("Settings saved");
    } catch (error) {
      formMessage(form, errorsOf(error));
    } finally {
      save.disabled = false;
    }
  };
}

function renderSettingsNav(cards) {
  const nav = $("settingsNav");
  const scroller = $("settingsScroll");
  let pinned = null;
  let pinTimer = 0;
  const activate = (id) => links.forEach((l) => l.classList.toggle("active", l.getAttribute("href") === `#${id}`));
  const links = cards.map((card) => {
    const link = el("a", { href: `#${card.id}`, text: card.querySelector("h2").textContent });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      pinned = card.id;
      clearTimeout(pinTimer);
      pinTimer = setTimeout(() => { pinned = null; }, 900);
      activate(card.id);
      card.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return link;
  });
  nav.replaceChildren(...links);
  // The highlighted link follows the card at the top; at the very bottom the last card wins.
  let frame = 0;
  scroller.onscroll = () => {
    if (pinned) {
      clearTimeout(pinTimer);
      pinTimer = setTimeout(() => { pinned = null; }, 160);
      return;
    }
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const top = scroller.getBoundingClientRect().top + 90;
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      const current = atBottom ? cards[cards.length - 1] : [...cards].reverse().find((c) => c.getBoundingClientRect().top <= top) || cards[0];
      if (current) activate(current.id);
    });
  };
  activate(cards[0]?.id);
}

function configFileBlock(settings) {
  const file = settings.configFile;
  const items = [...(file.problem ? [file.problem] : []), ...(file.notices || [])];
  const reload = el("button", { type: "button", class: "secondary", id: "config-reload", text: "Read the config file again", onclick: async () => {
    try {
      await api("/api/settings/reload", { method: "POST" });
      await Promise.all([loadFullMasters(), loadMasters(), refreshInfo()]);
      await renderFirmForm();
      toast("Config file read again");
    } catch (error) {
      formMessage($("firmForm"), errorsOf(error));
    }
  } });
  return settingsCard("config-file", "Config file", [
    el("p", { class: "muted", text: "Parties, finishes, styles, colours and every setting on this page are kept in this file, next to the data file. Changes made here are written to it at once; if it is edited outside the app, the app reads it again by itself." }),
    el("div", { class: "config-path", text: file.path }),
    el("p", { class: "muted", text: `Read: ${file.loadedAt || "—"} · Last saved by the app: ${file.savedAt || "—"}` }),
    items.length ? el("ul", { class: file.problem ? "warnings" : "" }, items.map((t) => el("li", { text: t }))) : "",
    el("div", {}, [reload]),
  ]);
}

// The signature printed above "Authorized Signatory" (kept in the config file).
function signatureBlock(settings) {
  const preview = el("img", { id: "sig-preview", alt: "No signature", class: "signature-preview" });
  const status = el("span", { class: "muted", id: "sig-status" });
  const show = (has) => {
    preview.style.display = has ? "" : "none";
    if (has) preview.src = `/api/settings/signature?t=${Date.now()}`;
    status.textContent = has ? "" : "No signature — bills print without one.";
  };
  const file = el("input", { type: "file", id: "sig-file", accept: "image/png,image/jpeg" });
  const upload = el("button", { type: "button", class: "secondary", id: "sig-upload", text: "Use this picture", onclick: async () => {
    if (!file.files[0]) { toast("Choose a PNG or JPG picture first.", "warn"); return; }
    const form = new FormData();
    form.append("file", file.files[0]);
    try {
      const saved = await api("/api/settings/signature", { method: "PUT", body: form });
      show(saved.hasSignature);
      toast("Signature saved");
    } catch (error) {
      toast(error.message, "err");
    }
  } });
  const remove = el("button", { type: "button", class: "secondary", id: "sig-remove", text: "Remove signature", onclick: async () => {
    if (!(await showConfirm({
      title: "Remove signature",
      message: "Print bills without a signature?",
      confirmText: "Remove signature",
      cancelText: "Cancel",
      tone: "danger",
    }))) return;
    const saved = await api("/api/settings/signature", { method: "DELETE" });
    show(saved.hasSignature);
  } });
  show(settings.hasSignature);
  return el("div", { class: "signature-block" }, [preview, el("div", { class: "actions" }, [file, upload, remove, status])]);
}

document.addEventListener("mph-theme", () => {
  if (!mastersState.data) return;
  renderPartyMasters();
  renderFinishMasters();
});

subviewHandlers["masters-parties"] = async () => { await loadFullMasters(); renderPartyMasters(); };
subviewHandlers["masters-styles"] = async () => { await loadFullMasters(); renderStyles(); };
subviewHandlers["masters-sisters"] = async () => { await loadFullMasters(); renderSisterGroups(); };
subviewHandlers["masters-finishes"] = async () => { await loadFullMasters(); renderFinishMasters(); renderGroupMasters(); };
subviewHandlers["masters-colors"] = async () => { await loadFullMasters(); renderColors(); };
