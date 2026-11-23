"use strict";

// Client-side English <-> Hinglish UI translation: walks the page, translates texts and attributes, and keeps doing so
// as screens are drawn. The texts are in i18n/texts-*.js and i18n/patterns.js, loaded before this file.
(() => {
  const { exact: EXACT, patterns: PATTERNS, trStyleSummary, trProblemList } = window.mphI18n;


  // Table cell values allowed to be translated inside data tables (avoids ever translating party/finish/address data).
  const TD_EXACT = new Set([
    "Yes", "No", "Saved", "CANCELLED", "App", "Excel", "Not sent", "Part sent", "Sent",
    "no rate", "✓ matches", "Combined", "Apart",
    "Leave empty", "Gate pass numbers", "Design no. (D.N.)", "Lot no. (LOT N.)",
    "One line per inward entry", "Same lot on one line", "Same gate pass on one line",
    "Inward order (older first)", "By the number shown (lot / D.N.)", "By inward date",
  ]);

  const DATA_SELECT_IDS = new Set(["pf-style", "pf-color", "ff-color", "ff-group", "rate-finish"]);

  function translateCore(core) {
    if (!core) return core;
    if (EXACT[core]) return EXACT[core];
    for (const [regex, fn] of PATTERNS) {
      const m = regex.exec(core);
      if (m) return fn(...m);
    }
    // Style summary or party style text or comma-separated problems
    if (/^(No GSTIN|GSTIN is not valid|No discount set|No rates|No billing style|Billing style "|Bill-to party "|Colour ")/.test(core)) {
      return trProblemList(core);
    }
    if (core.includes(" · bill before dispatch") || core.includes(" · bill as ")) {
      return core
        .replace(/ · bill before dispatch/g, " · जावक से पहले बिल")
        .replace(/ · bill as /g, " · बिल फ़िनिश: ");
    }
    return core;
  }

  function translate(raw) {
    if (!raw || typeof raw !== "string") return raw;
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
    if (!match || !match[2]) return raw;
    const [, lead, core, trail] = match;
    const translated = translateCore(core);
    return translated === core ? raw : `${lead}${translated}${trail}`;
  }

  function translateTableCell(raw, td) {
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
    if (!match || !match[2]) return raw;
    const [, lead, core, trail] = match;
    const tr = td.parentElement;

    // Report values are data, including months and dates that stay in English.
    if (td.closest(".report") && !td.closest("table.register")) {
      return raw;
    }

    // Skip explicit user-data cells (party/finish/inward/number/money).
    if (td.classList.contains("party-name") || td.classList.contains("finish-name") || td.classList.contains("inward")) return raw;

    // Exact UI tokens: never translate Yes/No inside left-aligned text columns (could be party/address).
    if (TD_EXACT.has(core)) {
      if ((core === "Yes" || core === "No") && td.classList.contains("left")) return raw;
      return `${lead}${EXACT[core]}${trail}`;
    }

    // Billed outside app
    if (/^Billed outside app: /.test(core)) return `${lead}${translateCore(core)}${trail}`;

    // Party style column (bill before dispatch / bill as)
    if (td.classList.contains("wrap") && (core.includes(" · bill before dispatch") || core.includes(" · bill as "))) {
      return `${lead}${translateCore(core)}${trail}`;
    }

    // Party problems column or bill import check problems
    if (td.classList.contains("bad")) {
      const hi = trProblemList(core);
      if (hi !== core) return `${lead}${hi}${trail}`;
    }

    // Warnings column in register/party-wise/recent tables (may contain multiple space-joined warning sentences)
    if (td.closest("table.register") && td.cellIndex === tr.cells.length - 1 && td.classList.contains("left")) {
      const parts = core.split(/(?<=\.)\s+/).map((s) => translateCore(s));
      const joined = parts.join(" ");
      if (joined !== core) return `${lead}${joined}${trail}`;
    }

    return raw;
  }

  function isIgnoredElement(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return true;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "DATALIST") return true;
    if (el.closest(".sheet, .config-path, .words, .party-name, .finish-name, .inward, .pick-name, [data-no-i18n='all']")) return true;
    return false;
  }

  function isDataSelect(select) {
    return select && (DATA_SELECT_IDS.has(select.id) || Boolean(select.closest(".map-table")));
  }

  const origText = new WeakMap();
  const lastText = new WeakMap();
  const origAttrs = new WeakMap();
  const lastAttrs = new WeakMap();
  const ATTRS = ["placeholder", "title", "aria-label", "alt"];

  let currentLang = "en";
  try {
    if (localStorage.getItem("mph-lang") === "hi") currentLang = "hi";
  } catch { /* private mode */ }

  let origDocTitle = document.title;
  let lastDocTitle = null;
  let applying = false;

  function translateTextNode(node, lang) {
    const parent = node.parentElement;
    if (!parent || isIgnoredElement(parent)) return;
    if (parent.dataset.noI18n === "text") return;

    // Combo list items contain party/finish names: only translate empty placeholder and inactive tag.
    const comboLi = parent.closest(".combo-list:not([data-dropdown-options]) li");
    if (comboLi && !comboLi.classList.contains("empty") && !parent.classList.contains("tag")) return;

    const cur = node.nodeValue;
    if (lang === "en") {
      if (lastText.has(node)) {
        const en = origText.get(node);
        if (en !== undefined && cur !== en) node.nodeValue = en;
        lastText.delete(node);
      } else {
        origText.set(node, cur);
      }
      return;
    }

    if (!origText.has(node) || !lastText.has(node) || cur !== lastText.get(node)) {
      origText.set(node, cur);
    }
    const en = origText.get(node);

    let hi = en;
    const dataControl = parent.matches(".dropdown-value, option") ? parent.parentElement
      : parent.matches("[data-dropdown-options] li") ? parent.parentElement.previousElementSibling : null;
    if (dataControl && (isDataSelect(dataControl) || dataControl.matches("[data-no-i18n='all']"))) {
      const trimmed = en.trim();
      if (EXACT[trimmed] || /\((not found|not in the colour list)\)$/.test(trimmed)) hi = translate(en);
    } else if (parent.tagName === "TD") {
      hi = translateTableCell(en, parent);
    } else if (parent.classList.contains("style-box")) {
      hi = trStyleSummary(en);
    } else if (parent.tagName === "LI" && parent.parentElement?.classList.contains("warnings")) {
      hi = translate(en);
    } else {
      hi = translate(en);
    }

    if (cur !== hi) node.nodeValue = hi;
    lastText.set(node, hi);
  }

  function translateElementAttrs(el, lang) {
    if (isIgnoredElement(el)) return;
    let orig = origAttrs.get(el);
    let last = lastAttrs.get(el);
    if (!orig) { orig = {}; origAttrs.set(el, orig); }
    if (!last) { last = {}; lastAttrs.set(el, last); }

    for (const attr of ATTRS) {
      if (!el.hasAttribute(attr)) continue;
      const cur = el.getAttribute(attr);
      if (lang === "en") {
        if (attr in last) {
          if (attr in orig && cur !== orig[attr]) el.setAttribute(attr, orig[attr]);
          delete last[attr];
        } else {
          orig[attr] = cur;
        }
        continue;
      }
      if (!(attr in orig) || !(attr in last) || cur !== last[attr]) {
        orig[attr] = cur;
      }
      const en = orig[attr];
      // Row title can contain multi-line warnings
      const hi = attr === "title" && el.tagName === "TR" && en.includes("\n")
        ? en.split("\n").map((line) => translate(line)).join("\n")
        : translate(en);
      if (cur !== hi) el.setAttribute(attr, hi);
      last[attr] = hi;
    }
  }

  function walk(root, lang) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root, lang);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) {
      if (isIgnoredElement(root)) return;
      translateElementAttrs(root, lang);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node, lang);
      else translateElementAttrs(node, lang);
    }
  }

  function syncTitle(lang) {
    const cur = document.title;
    if (lang === "en") {
      if (lastDocTitle !== null) {
        if (cur !== origDocTitle) document.title = origDocTitle;
        lastDocTitle = null;
      } else {
        origDocTitle = cur;
      }
      return;
    }
    if (lastDocTitle === null || cur !== lastDocTitle) origDocTitle = cur;
    const hi = translate(origDocTitle);
    if (cur !== hi) document.title = hi;
    lastDocTitle = hi;
  }

  function syncToggleButton(lang) {
    const isHi = lang === "hi";
    document.querySelectorAll("#langSwitch [data-lang]").forEach((btn) => {
      const active = btn.dataset.lang === (isHi ? "hi" : "en");
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const select = document.getElementById("display-language");
    if (select && select.value !== (isHi ? "hi" : "en")) select.value = isHi ? "hi" : "en";
    const btn = document.getElementById("langToggle");
    if (!btn) return;
    btn.textContent = isHi ? "English" : "हिन्दी (Hinglish)";
    btn.setAttribute("aria-pressed", isHi ? "true" : "false");
    btn.title = isHi ? "UI की Language English करें" : "Switch UI language to Hindi (Hinglish)";
  }

  const observer = new MutationObserver((mutations) => {
    if (applying || currentLang !== "hi") return;
    applying = true;
    try {
      for (const m of mutations) {
        if (m.type === "childList") {
          for (const added of m.addedNodes) walk(added, currentLang);
        } else if (m.type === "characterData") {
          translateTextNode(m.target, currentLang);
        } else if (m.type === "attributes" && m.target.nodeType === Node.ELEMENT_NODE) {
          translateElementAttrs(m.target, currentLang);
        }
      }
      syncTitle(currentLang);
    } finally {
      observer.takeRecords();
      applying = false;
    }
  });

  function startObserver() {
    if (!document.body) return;
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
    const titleEl = document.querySelector("title");
    if (titleEl) observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  function applyLanguage(lang) {
    const next = lang === "hi" ? "hi" : "en";
    currentLang = next;
    document.documentElement.lang = next;
    document.documentElement.dataset.lang = next;
    try { localStorage.setItem("mph-lang", next); } catch { /* private mode */ }
    applying = true;
    try {
      syncToggleButton(next);
      syncTitle(next);
      if (document.body) walk(document.body, next);
    } finally {
      observer.takeRecords();
      applying = false;
    }
    document.dispatchEvent(new CustomEvent("mph-lang", { detail: { language: next } }));
  }

  function t(text) {
    return currentLang === "hi" ? translate(text) : text;
  }

  window.mphI18n.translateCore = translateCore;
  window.getLanguage = () => currentLang;
  window.applyLanguage = applyLanguage;
  window.t = t;
  window.translateUi = (root) => walk(root, currentLang);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      startObserver();
      applyLanguage(currentLang);
    });
  } else {
    startObserver();
    applyLanguage(currentLang);
  }
})();
