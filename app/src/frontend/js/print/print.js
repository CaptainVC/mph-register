"use strict";

// Draws each bill on the grid of the Excel bill (assets/templates/bill-template.json, made by tools/make_bill_template.py from the bill
// workbook): same column widths, row heights, merges, fonts, borders, fills, alignment and number formats, on the
// workbook's paper and margins. Every text, colour and font comes from the config file (via /api/settings/print-context)
// or from the saved bill itself. The colours the workbook's macros paint (party, finish, THAN boxes, limit fill) follow the
// macros' own rules.
//
// Line rows: a bill has at least the template's 25 rows. With more rows per bill they share the same height (so the bill
// still fits on one sheet) and the font gets smaller only if they become too short. A long lot / D.N. list first shrinks
// to fit its cell, down to the smallest font in the settings; if it still does not fit, the line was given 2–3 rows by the
// bill maker and the text wraps over them.

const PT = 96 / 72;
const PAPER = { letter: { w: 8.5, h: 11 }, a4: { w: 210 / 25.4, h: 297 / 25.4 } };
// Same numbers as BillGeometry on the server.
const LINE_HEIGHT = 1.2;
const ROW_PADDING_PT = 1.5;
const SAFETY_PT = 1;
const CELL_PADDING_PX = 4;
const MIN_FONT_PT = 4;
const BORDER_WIDTH = { hair: 1, thin: 1, dotted: 1, dashed: 1, dashDot: 1, dashDotDot: 1, slantDashDot: 2, medium: 2, mediumDashed: 2, mediumDashDot: 2, mediumDashDotDot: 2, thick: 3, double: 3 };
const BORDER_CSS = { dotted: "dotted", dashed: "dashed", mediumDashed: "dashed", dashDot: "dashed", mediumDashDot: "dashed", dashDotDot: "dotted", mediumDashDotDot: "dotted", double: "double", hair: "dotted" };

const measureContext = document.createElement("canvas").getContext("2d");

// Arial Narrow is Arial drawn 82% wide; computers without it (Windows without MS Office) get Arial squeezed to the same width.
const NARROW_FONT = "Arial Narrow";
const NARROW_RATIO = 0.82;
const NARROW_STAND_IN = "Arial, Arimo, Helvetica, sans-serif";

function installed(family) {
  const probe = "mmmmmmmmmmlli1WWxyz";
  measureContext.font = "72px monospace";
  const plain = measureContext.measureText(probe).width;
  measureContext.font = `72px "${family}", monospace`;
  return measureContext.measureText(probe).width !== plain;
}

function familyFor(style, options) {
  if (style.font.name === NARROW_FONT && options.squeezeNarrow) return NARROW_STAND_IN;
  return options.fonts[style.font.name] || `"${style.font.name}", Calibri, Carlito, sans-serif`;
}

function squeezeFor(style, options) {
  return style.font.name === NARROW_FONT && options.squeezeNarrow ? NARROW_RATIO : 1;
}

// The macros' colour rules: a blank colour paints red, an unknown name black (ColorNameToRGB "Case Else").
function vbaColor(value, palette) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return "#ff0000";
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  return palette[text] || "#000000";
}

function grouped(integerText, indian) {
  if (!indian || integerText.length <= 3) return integerText.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const last3 = integerText.slice(-3);
  return `${integerText.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
}

// Excel number formats used on the bill: "₹"#,##0.00_), 0_ , 0.00_ , 0.0%.
function formatNumber(value, format, indian) {
  if (value === null || value === undefined || value === "") return { text: "" };
  const n = Number(value);
  if (!Number.isFinite(n)) return { text: String(value) };
  const negative = n < 0;
  const abs = Math.abs(n);
  if (format.includes("%")) {
    const decimals = (format.split("%")[0].split(".")[1] || "").length;
    return { text: `${(abs * 100).toFixed(decimals)}%`, negative };
  }
  const decimals = /0\.(0+)/.exec(format)?.[1].length ?? 0;
  const [whole, fraction] = abs.toFixed(decimals).split(".");
  const body = (format.includes("#,##") ? grouped(whole, indian) : whole) + (fraction ? `.${fraction}` : "");
  const currency = format.includes("₹") ? "₹" : "";
  if (negative && format.includes("\\(")) return { text: `(${currency}${body})`, negative };
  return { text: `${negative ? "-" : ""}${currency}${body}`, pad: format.includes("_)") ? ")" : format.includes("_ ") ? " " : "", negative };
}

const dotDate = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}` : "");

function lineBlock(template) {
  return { first: template.lineRows?.first ?? 12, count: template.lineRows?.count ?? 25 };
}

function printableHeightPt(template, paperName) {
  const paper = PAPER[paperName] || PAPER.letter;
  const m = template.page.marginsIn;
  return (paper.h - m.top - m.bottom) * 72;
}

// Heights of the line rows for a bill with `slots` rows, and the font those rows allow.
function lineRowsFor(template, slots, paperName) {
  const { first, count } = lineBlock(template);
  const own = template.rowsPt.slice(first, first + count);
  const baseFont = template.cells.find((c) => c.r === first && c.c === 2)?.font.size ?? 10;
  if (slots <= count) return { heights: own, font: baseFont };
  const fixed = template.rowsPt.reduce((s, h) => s + h, 0) - own.reduce((s, h) => s + h, 0);
  const height = (printableHeightPt(template, paperName) - fixed - SAFETY_PT) / slots;
  const font = Math.min(baseFont, Math.floor(((height - ROW_PADDING_PT) / LINE_HEIGHT) * 4) / 4);
  return { heights: Array(slots).fill(height), font };
}

// The template's grid with its line rows replaced by this bill's rows; lines that need 2–3 rows are merged cells.
class BillLayout {
  constructor(template, lineHeights, tallLines) {
    const { first, count } = lineBlock(template);
    const slots = lineHeights.length;
    const shift = slots - count;
    const mapRow = (r) => (r < first ? r : r + shift);
    const inBlock = (r) => r >= first && r < first + count;
    this.t = template;
    this.first = first;
    this.slots = slots;
    this.mapRow = mapRow;
    this.rowsPt = [...template.rowsPt.slice(0, first), ...lineHeights, ...template.rowsPt.slice(first + count)];
    this.colX = [0];
    template.columnsPx.forEach((w) => this.colX.push(this.colX.at(-1) + w));
    this.rowY = [0];
    this.rowsPt.forEach((h) => this.rowY.push(this.rowY.at(-1) + h * PT));
    this.cells = new Map();
    for (const c of template.cells) if (!inBlock(c.r)) this.cells.set(`${mapRow(c.r)},${c.c}`, { ...c, r: mapRow(c.r) });
    const byRow = new Map();
    for (const c of template.cells) if (inBlock(c.r)) (byRow.get(c.r) || byRow.set(c.r, []).get(c.r)).push(c);
    for (let s = 0; s < slots; s++) {
      const source = s === slots - 1 ? first + count - 1 : first + Math.min(s, count - 2);
      for (const c of byRow.get(source) || []) this.cells.set(`${first + s},${c.c}`, { ...c, r: first + s });
    }
    this.merges = template.merges.filter((m) => !inBlock(m.r)).map((m) => ({ ...m, r: mapRow(m.r) }));
    for (const { slot, rows } of tallLines) {
      for (let c = 0; c < template.columnsPx.length; c++) this.merges.push({ r: first + slot, c, rows, cols: 1 });
    }
    this.covered = new Map();
    for (const m of this.merges) {
      for (let r = m.r; r < m.r + m.rows; r++) for (let c = m.c; c < m.c + m.cols; c++) this.covered.set(`${r},${c}`, m);
    }
    this.image = template.image ? { ...template.image, r: mapRow(template.image.r) } : null;
  }

  cell(r, c) { return this.cells.get(`${r},${c}`); }

  area(r, c) {
    const m = this.covered.get(`${r},${c}`);
    return m ? { r: m.r, c: m.c, rows: m.rows, cols: m.cols } : { r, c, rows: 1, cols: 1 };
  }

  isLine(r) { return r >= this.first && r < this.first + this.slots; }

  get width() { return this.colX.at(-1); }

  get height() { return this.rowY.at(-1); }
}

// Texts a bill prints. New bills carry their own; older ones only carried some, the rest come from the config file.
function textsFor(firm, current) {
  if (firm.texts) return firm.texts;
  return {
    ...current,
    copyLabel: firm.copyLabel ?? current.copyLabel, invoiceKind: firm.invoiceTitle ?? current.invoiceKind, sacLine: firm.sacLine ?? current.sacLine,
    bankLine1: firm.bankLine1 ?? current.bankLine1, bankLine2: firm.bankLine2 ?? current.bankLine2, paymentLine: firm.paymentLine ?? current.paymentLine,
    terms: firm.terms !== undefined && firm.terms !== null ? String(firm.terms).split("\n") : current.terms,
    signatory: firm.signatory ?? current.signatory, signatureLabel: firm.signatureLabel ?? current.signatureLabel, checkedByLabel: firm.checkedByLabel ?? current.checkedByLabel,
  };
}

// Every value the bill shows, keyed by "row,col" of the layout (0-based), like the Excel cells they replace.
function billValues(layout, doc, firm, texts, colors, palette, positions) {
  const v = new Map();
  const at = (templateRow) => layout.mapRow(templateRow);
  const set = (r, c, value, extra = {}) => v.set(`${r},${c}`, { value, ...extra });
  set(0, 0, `${texts.firmGstinPrefix || ""}${firm.gstin || ""}`);
  set(0, 2, texts.title);
  set(0, 5, texts.copyLabel);
  set(1, 0, firm.firmName);
  set(2, 0, firm.addressLine1);
  set(3, 0, firm.addressLine2);
  set(4, 0, firm.phoneLine);
  set(5, 0, firm.msmeLine);
  set(6, 0, texts.partyDetailsLabel);
  set(6, 3, texts.invoiceNoLabel);
  set(6, 5, doc.invoiceNo || "DRAFT");
  const partyColor = vbaColor(colors.party, palette);
  set(7, 0, doc.partyName, { color: partyColor });
  set(8, 0, doc.address, { color: partyColor });
  set(9, 0, doc.state, { color: partyColor });
  set(10, 0, `${texts.partyGstinPrefix || ""}${doc.gstin || ""}`, { color: partyColor });
  set(7, 3, texts.datedLabel);
  set(7, 5, dotDate(doc.billDate));
  set(9, 3, texts.periodLabel || "");
  set(9, 5, `${dotDate(doc.periodFrom)}${texts.periodJoiner ?? " TO "}${dotDate(doc.periodTo)}`);
  set(10, 3, texts.invoiceKind);
  set(10, 6, texts.sacLine);
  [texts.gpnHeader, texts.dnHeader, texts.lotHeader, texts.finishHeader, texts.thanHeader, texts.rateHeader, texts.amountHeader]
    .forEach((h, c) => set(layout.first - 1, c, h));

  const limit = Number(firm.invoiceLimit || 0);
  const big = limit > 0 && doc.total >= limit;
  for (let s = 0; s < layout.slots; s++) set(layout.first + s, 6, "", { fill: big ? "#FF0000" : null });
  doc.lines.forEach((line, i) => {
    const r = layout.first + positions[i];
    if (line.kind === "blank") return;
    const priced = line.kind === "priced";
    set(r, 0, line.gpn);
    set(r, 1, line.dn);
    set(r, 2, line.lot);
    set(r, 3, priced ? line.finish : "", priced ? { color: vbaColor(colors.finishes[String(line.finish || "").toLowerCase()], palette) } : {});
    set(r, 4, line.qty, priced && line.finish ? { thickBox: true } : {});
    set(r, 5, priced ? line.rate : "");
    set(r, 6, priced ? line.amount : "", { fill: big ? "#FF0000" : null });
  });

  const inter = doc.taxMode === "inter";
  set(at(37), 4, texts.grossLabel);
  set(at(37), 5, texts.totalRsLabel);
  set(at(37), 6, doc.gross);
  set(at(38), 0, texts.bankLine1);
  set(at(38), 3, texts.discountLabel);
  set(at(38), 6, doc.discount);
  set(at(39), 3, texts.taxableLabel);
  set(at(39), 6, doc.taxable);
  set(at(40), 0, texts.bankLine2);
  set(at(40), 3, inter ? texts.igstLabel : texts.cgstLabel);
  set(at(40), 5, (inter ? doc.igstRate : doc.cgstRate) / 100);
  set(at(40), 6, inter ? doc.igst : doc.cgst);
  set(at(41), 3, inter ? "" : texts.sgstLabel);
  set(at(41), 5, inter ? "" : doc.sgstRate / 100);
  set(at(41), 6, inter ? "" : doc.sgst);
  set(at(42), 0, doc.amountInWords);
  set(at(42), 4, texts.totalLabel);
  set(at(42), 6, doc.total);
  set(at(43), 0, texts.paymentLine);
  set(at(43), 4, texts.signatory);
  const terms = texts.terms || [];
  [44, 45, 46, 47].forEach((r, i) => set(at(r), 0, terms[i] || ""));
  set(at(46), 4, texts.signatureLabel);
  set(at(48), 2, texts.checkedByLabel);
  return v;
}

function justify(h, isNumber) {
  if (h === "general") return isNumber ? "flex-end" : "flex-start";
  return { left: "flex-start", center: "center", centerContinuous: "center", right: "flex-end", fill: "flex-start", justify: "flex-start", distributed: "center" }[h] || "flex-start";
}

function textWidth(text, style, sizePt, options) {
  measureContext.font = `${style.font.italic ? "italic " : ""}${style.font.bold ? "700" : "400"} ${sizePt}pt ${familyFor(style, options)}`;
  return measureContext.measureText(text).width * squeezeFor(style, options);
}

// Breaks after commas, spaces, plus and minus signs and slashes, like the bill maker's estimate on the server.
function wrapLines(text, style, sizePt, options, width) {
  const tokens = text.match(/[^,\s+/-]+[,\s+/-]*|[,\s+/-]+/g) || [text];
  const fits = (t) => textWidth(t, style, sizePt, options) <= width;
  const lines = [];
  let line = "";
  for (const token of tokens) {
    if (fits(line + token)) { line += token; continue; }
    if (line) { lines.push(line.trimEnd()); line = ""; }
    const piece = token.trimStart();
    if (fits(piece)) { line = piece; continue; }
    for (const ch of piece) {
      if (line && !fits(line + ch)) { lines.push(line); line = ""; }
      line += ch;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.length ? lines : [text];
}

// Biggest font that fits the cell: one line when it fits, else wrapped over the cell's rows; never spills out.
function fitText(text, style, startPt, smallestPt, options, widthPx, heightPx, rows) {
  if (textWidth(text, style, startPt, options) <= widthPx) return { size: startPt, lines: [text] };
  const oneLine = Math.floor(startPt * (widthPx / textWidth(text, style, startPt, options)) * 10) / 10;
  if (rows <= 1) return { size: Math.max(MIN_FONT_PT, oneLine), lines: [text] };
  if (oneLine >= smallestPt) return { size: oneLine, lines: [text] };
  for (let size = startPt; size >= MIN_FONT_PT; size -= 0.25) {
    const lines = wrapLines(text, style, size, options, widthPx);
    if (lines.length * size * LINE_HEIGHT * PT <= heightPx) return { size, lines };
  }
  return { size: MIN_FONT_PT, lines: wrapLines(text, style, MIN_FONT_PT, options, widthPx) };
}

function renderCell(layout, area, style, entry, options) {
  const div = document.createElement("div");
  div.className = "xc";
  const left = layout.colX[area.c];
  const top = layout.rowY[area.r];
  const width = layout.colX[area.c + area.cols] - left;
  const height = layout.rowY[area.r + area.rows] - top;
  const line = layout.isLine(area.r);
  const baseSize = line ? Math.min(style.font.size, options.lineFont) : style.font.size;
  Object.assign(div.style, {
    position: "absolute", left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
    display: "flex", overflow: "hidden", padding: "0 2px",
    alignItems: { top: "flex-start", center: "center", bottom: "flex-end", justify: "center", distributed: "center" }[style.align.v] || "flex-end",
    fontFamily: familyFor(style, options),
    fontSize: `${baseSize}pt`, fontWeight: style.font.bold ? "700" : "400", fontStyle: style.font.italic ? "italic" : "normal",
    textDecoration: style.font.underline ? "underline" : "none", color: entry.color || style.font.color || "#000",
    lineHeight: String(LINE_HEIGHT),
  });
  const squeeze = squeezeFor(style, options);
  if (style.font.name === NARROW_FONT && squeeze === 1) div.style.fontStretch = "condensed";
  const fill = entry.fill !== undefined ? entry.fill : style.fill;
  if (fill) div.style.background = fill;

  const raw = entry.value;
  const numeric = typeof raw === "number";
  const formatted = numeric ? formatNumber(raw, style.numFmt, options.indian) : { text: raw ?? "" };
  div.style.justifyContent = justify(style.align.h, numeric);
  const span = document.createElement("span");
  const wraps = style.align.wrap && !line && squeeze === 1;
  span.style.whiteSpace = wraps ? "pre-wrap" : "pre";
  if (squeeze !== 1) {
    span.style.transform = `scaleX(${squeeze})`;
    span.style.transformOrigin = { center: "center", centerContinuous: "center", right: "right" }[style.align.h] || (numeric ? "right" : "left");
  }
  if (wraps) { span.style.overflowWrap = "anywhere"; span.style.textAlign = { center: "center", right: "right" }[style.align.h] || (numeric ? "right" : "left"); }
  const usable = width - CELL_PADDING_PX - 1;
  if (line && formatted.text) {
    const fit = fitText(formatted.text, style, baseSize, options.smallestFont, options, usable, height - 1, area.rows);
    if (fit.size !== baseSize) div.style.fontSize = `${fit.size}pt`;
    span.textContent = fit.lines.join("\n");
    if (fit.lines.length > 1) span.style.textAlign = { center: "center", right: "right" }[style.align.h] || (numeric ? "right" : "left");
    if (fit.size < baseSize) div.dataset.shrunk = String(fit.size);
    if (fit.lines.length > 1) div.dataset.wrapped = String(fit.lines.length);
  } else {
    span.textContent = formatted.text;
    // A text wider than its cell (usually a font missing on this computer) is made smaller rather than cut off.
    const wide = formatted.text ? textWidth(formatted.text + (formatted.pad || ""), style, baseSize, options) : 0;
    const roomForTwoLines = height >= 2 * baseSize * LINE_HEIGHT * PT;
    if (wide > usable && !(wraps && roomForTwoLines)) {
      const size = Math.max(MIN_FONT_PT, Math.floor(baseSize * (usable / wide) * 10) / 10);
      div.style.fontSize = `${size}pt`;
      span.style.whiteSpace = "pre";
      div.dataset.shrunk = String(size);
    }
  }
  if (formatted.negative && style.numFmt.includes("[Red]")) span.style.color = "#ff0000";
  if (formatted.pad) {
    const pad = document.createElement("span");
    pad.style.visibility = "hidden";
    pad.textContent = formatted.pad;
    span.append(pad);
  }
  div.append(span);
  return div;
}

const WEIGHT = (side) => (side ? (BORDER_WIDTH[side.style] || 1) * 10 + (side.color?.toLowerCase() === "#ffffff" ? 0 : 1) : -1);

// Excel draws one line per cell edge; where two neighbouring cells set the same edge, the heavier line shows.
function collectEdges(layout, thickBoxes) {
  const h = new Map();
  const v = new Map();
  const put = (map, key, side) => { if (side && WEIGHT(side) > WEIGHT(map.get(key))) map.set(key, side); };
  for (const cell of layout.cells.values()) {
    const { r, c } = cell;
    const area = layout.area(r, c);
    const b = thickBoxes.has(`${area.r},${area.c}`) ? Object.fromEntries(["left", "right", "top", "bottom"].map((k) => [k, { style: "thick", color: "#000000" }])) : cell.border;
    if (r === area.r) put(h, `${r},${c}`, b.top);
    if (r === area.r + area.rows - 1) put(h, `${r + 1},${c}`, b.bottom);
    if (c === area.c) put(v, `${r},${c}`, b.left);
    if (c === area.c + area.cols - 1) put(v, `${r},${c + 1}`, b.right);
  }
  return { h, v };
}

function renderEdges(layout, edges, target) {
  const line = (left, top, width, height, side) => {
    const d = document.createElement("div");
    const css = BORDER_CSS[side.style];
    Object.assign(d.style, { position: "absolute", left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    if (css === "double") {
      d.style.border = "0 solid " + side.color;
      if (width > height) { d.style.borderTopWidth = "1px"; d.style.borderBottomWidth = "1px"; } else { d.style.borderLeftWidth = "1px"; d.style.borderRightWidth = "1px"; }
    } else if (css) {
      d.style[width > height ? "borderTop" : "borderLeft"] = `${Math.max(1, Math.min(width, height))}px ${css} ${side.color}`;
    } else {
      d.style.background = side.color;
    }
    target.append(d);
  };
  for (const [key, side] of edges.h) {
    const [r, c] = key.split(",").map(Number);
    const w = BORDER_WIDTH[side.style] || 1;
    const x0 = layout.colX[c] - (w > 1 ? w / 2 : 0);
    line(x0, layout.rowY[r] - w / 2, layout.colX[c + 1] - layout.colX[c] + (w > 1 ? w : 0) + (w === 1 ? 1 : 0), w, side);
  }
  for (const [key, side] of edges.v) {
    const [r, c] = key.split(",").map(Number);
    const w = BORDER_WIDTH[side.style] || 1;
    line(layout.colX[c] - w / 2, layout.rowY[r] - (w > 1 ? w / 2 : 0), w, layout.rowY[r + 1] - layout.rowY[r] + (w > 1 ? w : 0), side);
  }
}

function renderBill(template, doc, context) {
  const firm = doc.firm || context.firm;
  const texts = textsFor(firm, context.texts);
  const paperName = (context.print.paperSize || template.page.paper || "letter").toLowerCase();
  const positions = [];
  let used = 0;
  for (const line of doc.lines) { positions.push(used); used += Math.max(1, line.rows || 1); }
  const { count } = lineBlock(template);
  const slots = Math.max(count, firm.rowsPerInvoice || count, used);
  const { heights, font } = lineRowsFor(template, slots, paperName);
  const tall = doc.lines.map((line, i) => ({ slot: positions[i], rows: Math.max(1, line.rows || 1) })).filter((t) => t.rows > 1);
  const layout = new BillLayout(template, heights, tall);
  const options = {
    indian: context.print.indianDigitGrouping !== false,
    fonts: context.print.fontFallbacks || {},
    lineFont: font,
    smallestFont: Number(firm.smallestFontPt ?? context.print.smallestFontPt ?? 7.5),
    squeezeNarrow: context.squeezeNarrow,
  };
  const values = billValues(layout, doc, firm, texts, { party: context.partyColors[String(doc.party || "").toLowerCase()], finishes: context.finishColors }, context.colors, positions);
  const area = document.createElement("div");
  area.className = "area";
  area.style.width = `${layout.width}px`;
  area.style.height = `${layout.height}px`;

  const thickBoxes = new Set([...values].filter(([, e]) => e.thickBox).map(([k]) => k));
  const drawn = new Set();
  for (let r = 0; r < layout.rowsPt.length; r++) {
    for (let c = 0; c < template.columnsPx.length; c++) {
      const a = layout.area(r, c);
      const key = `${a.r},${a.c}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const style = layout.cell(a.r, a.c);
      if (!style) continue;
      const entry = values.get(key) ?? { value: "" };
      if ((entry.value === "" || entry.value === null || entry.value === undefined) && !style.fill && entry.fill == null) continue;
      area.append(renderCell(layout, a, style, entry, options));
    }
  }
  renderEdges(layout, collectEdges(layout, thickBoxes), area);

  const img = layout.image;
  if (img && context.hasSignature) {
    const sig = document.createElement("img");
    sig.className = "signature";
    sig.alt = "";
    sig.src = "/api/settings/signature";
    Object.assign(sig.style, {
      left: `${layout.colX[img.c] + img.colOffEmu / 9525}px`, top: `${layout.rowY[img.r] + img.rowOffEmu / 9525}px`,
      width: `${img.widthEmu / 9525}px`, height: `${img.heightEmu / 9525}px`,
    });
    area.append(sig);
  }

  const paper = PAPER[paperName] || PAPER.letter;
  const m = template.page.marginsIn;
  const sheet = document.createElement("section");
  sheet.className = `sheet${doc.status === "cancelled" ? " cancelled" : ""}`;
  sheet.dataset.rows = String(slots);
  Object.assign(sheet.style, {
    width: `${paper.w}in`, height: `${paper.h}in`,
    padding: `${m.top}in ${m.right}in ${m.bottom}in ${m.left}in`,
  });
  sheet.append(area);
  return { sheet, rows: used, slots };
}

function setPage(context, template) {
  const paper = (context.print.paperSize || template.page.paper || "letter").toLowerCase() === "a4" ? "A4" : "letter";
  const m = template.page.marginsIn;
  document.getElementById("pageStyle").textContent =
    `@page { size: ${paper} ${template.page.orientation || "portrait"}; margin: ${m.top}in ${m.right}in ${m.bottom}in ${m.left}in; }`;
}

async function getJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`);
  return response.json();
}

async function savePdf(ids, button, status) {
  button.disabled = true;
  status.textContent = "Making the PDF…";
  try {
    const response = await fetch("/api/invoices/pdf", {
      method: "POST", headers: { "Content-Type": "application/json", "X-MPH-Request": "1" }, body: JSON.stringify({ ids }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.errors?.join(" ") || `PDF failed (${response.status}).`);
    }
    const name = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(response.headers.get("Content-Disposition") || "")?.[1];
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = name ? decodeURIComponent(name) : "Bills.pdf";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status.textContent = "PDF saved to your Downloads folder.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function main() {
  const params = new URLSearchParams(location.search);
  const status = document.getElementById("status");
  const ids = (params.get("ids") || "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) { status.textContent = "No bills chosen."; return; }
  status.textContent = `Loading ${ids.length} bill(s)…`;
  try {
    const [template, context] = await Promise.all([getJson("/assets/templates/bill-template.json"), getJson("/api/settings/print-context")]);
    setPage(context, template);
    await Promise.all(["400 10pt Carlito", "700 10pt Carlito", "italic 400 10pt Carlito", "italic 700 10pt Carlito"].map((f) => document.fonts.load(f).catch(() => [])));
    await document.fonts.ready;
    context.squeezeNarrow = !installed(NARROW_FONT);
    const container = document.getElementById("bills");
    const notes = [];
    const numbers = [];
    // Up to six bills are read at once (a month can be hundreds), then drawn in the order chosen.
    const docs = new Array(ids.length);
    let next = 0;
    const reader = async () => {
      while (next < ids.length) {
        const at = next++;
        docs[at] = await getJson(`/api/invoices/${ids[at]}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, ids.length) }, reader));
    for (const doc of docs) {
      numbers.push(doc.invoiceNo);
      const { sheet, rows, slots } = renderBill(template, doc, context);
      if (rows > (doc.firm?.rowsPerInvoice || context.firm.rowsPerInvoice)) notes.push(`${doc.invoiceNo} needs ${rows} rows, more than its ${doc.firm?.rowsPerInvoice} — printed with ${slots} smaller rows.`);
      container.append(sheet);
    }
    document.title = numbers.length === 1 ? `Bill ${numbers[0]}` : `Bills ${numbers[0]} to ${numbers.at(-1)}`;
    document.body.dataset.ready = "1";
    status.textContent = `${ids.length} bill(s) ready — printed like the Excel bill (${(context.print.paperSize || "letter").toUpperCase()}, scale 100%, no headers/footers). ${notes.join(" ")}`;
    document.getElementById("pdfNow").addEventListener("click", (e) => savePdf(ids, e.currentTarget, status));
    if (params.get("pdf") !== "1" && params.get("auto") !== "0") setTimeout(() => window.print(), 300);
  } catch (error) {
    status.textContent = error.message;
  }
}

try { document.documentElement.dataset.theme = localStorage.getItem("mph-theme") || "light"; } catch { /* private mode */ }
document.getElementById("printNow").addEventListener("click", () => window.print());
document.getElementById("closeNow").addEventListener("click", () => window.close());
main();
