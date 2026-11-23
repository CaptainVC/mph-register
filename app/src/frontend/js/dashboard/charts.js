"use strict";

// Dashboard charts: columns, lines, bars and sparklines (SVG).

// ---------- Charts (plain SVG and HTML; nothing to download) ----------
/** Column chart. Each series is { name, values, className }; picked months are dark, compared months outlined; a click picks. */
function columnChart({ categories, labels, series, format, axisFormat, selected = [], compared = [], onPick, showValues = true, height = 300, width = 1000 }) {
  const padLeft = 86;
  const padRight = 10;
  const padTop = 30;
  const padBottom = 40;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const groupW = plotW / Math.max(1, categories.length);
  const barW = Math.min(58, (groupW * 0.74) / series.length);
  const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart", role: "img" });
  for (let i = 0; i <= 4; i++) {
    const y = padTop + plotH - (plotH * i) / 4;
    chart.append(svg("line", { x1: padLeft, x2: width - padRight, y1: y, y2: y, class: i ? "grid" : "axis" }));
    chart.append(svg("text", { x: padLeft - 8, y: y + 5, class: "tick", "text-anchor": "end" }, [document.createTextNode(axisFormat((max * i) / 4))]));
  }
  categories.forEach((category, ci) => {
    const x0 = padLeft + ci * groupW;
    const isSelected = selected.includes(category);
    const isCompared = !isSelected && compared.includes(category);
    if (isSelected) chart.append(svg("rect", { x: x0 + 2, y: padTop - 22, width: groupW - 4, height: plotH + 22, class: "chart-pick", rx: 6 }));
    series.forEach((s, si) => {
      const value = s.values[ci] || 0;
      const h = (value / max) * plotH;
      const x = x0 + (groupW - barW * series.length) / 2 + si * barW;
      chart.append(svg("rect", { x: x + 2, y: padTop + plotH - h, width: Math.max(1, barW - 4), height: Math.max(0, h), rx: 3, class: `bar ${s.className}${isSelected ? " on" : ""}${isCompared ? " cmp" : ""}` },
        [svg("title", {}, [document.createTextNode(`${labels[ci]} · ${s.name}: ${format(value)}`)])]));
      if (showValues && value > 0) {
        chart.append(svg("text", { x: x + barW / 2, y: padTop + plotH - h - 7, class: `bar-value${isSelected ? " on" : ""}`, "text-anchor": "middle" }, [document.createTextNode(s.short ? s.short(value) : format(value))]));
      }
    });
    chart.append(svg("text", { x: x0 + groupW / 2, y: height - 12, class: `cat${isSelected ? " on" : ""}`, "text-anchor": "middle" }, [document.createTextNode(labels[ci])]));
    if (onPick) {
      const hit = svg("rect", { x: x0, y: 0, width: groupW, height, class: "hit", tabindex: "0", role: "button", "aria-label": labels[ci] });
      hit.addEventListener("click", (event) => onPick(category, event));
      hit.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPick(category, event); } });
      chart.append(hit);
    }
  });
  return chart;
}

/** Line chart: one line per series (up to 8 colours) across the categories, with a dot and a tooltip on every point. */
function lineChart({ categories, labels, series, format, axisFormat, height = 300 }) {
  const width = 1000;
  const padLeft = 86;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 40;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const step = categories.length > 1 ? plotW / (categories.length - 1) : 0;
  const xOf = (i) => (categories.length > 1 ? padLeft + i * step : padLeft + plotW / 2);
  const yOf = (value) => padTop + plotH - (value / max) * plotH;
  const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart line-chart", role: "img" });
  for (let i = 0; i <= 4; i++) {
    const y = padTop + plotH - (plotH * i) / 4;
    chart.append(svg("line", { x1: padLeft, x2: width - padRight, y1: y, y2: y, class: i ? "grid" : "axis" }));
    chart.append(svg("text", { x: padLeft - 8, y: y + 5, class: "tick", "text-anchor": "end" }, [document.createTextNode(axisFormat((max * i) / 4))]));
  }
  const every = Math.ceil(categories.length / 14);
  categories.forEach((_, i) => {
    if (i % every === 0 || i === categories.length - 1) chart.append(svg("text", { x: xOf(i), y: height - 12, class: "cat", "text-anchor": "middle" }, [document.createTextNode(labels[i])]));
  });
  series.forEach((s, si) => {
    const cls = `s-c${si % DASH_LINES}`;
    if (s.values.length > 1) chart.append(svg("polyline", { points: s.values.map((v, i) => `${xOf(i)},${yOf(v)}`).join(" "), class: `line ${cls}` }));
    s.values.forEach((v, i) => chart.append(svg("circle", { cx: xOf(i), cy: yOf(v), r: 5, class: `dot ${cls}` }, [svg("title", {}, [document.createTextNode(`${s.name} · ${labels[i]}: ${format(v)}`)])])));
  });
  return chart;
}

/** Horizontal bars: [{ label, value, text, title, ghost, onClick, change }]; ghost is the compared value, drawn as a thin mark. */
function hbars(items, { cls = "" } = {}) {
  const max = Math.max(0, ...items.flatMap((item) => [item.value, item.ghost ?? 0]));
  const width = (v) => (max > 0 ? Math.max(0.5, (v / max) * 100) : 0);
  return el("ol", { class: `hbars ${cls}`.trim() }, items.map((item, i) => el("li", { class: "hbar" }, [
    item.onClick
      ? el("button", { type: "button", class: "hbar-name link-btn", title: item.label, text: item.label, onclick: item.onClick })
      : el("span", { class: "hbar-name", title: item.label, text: item.label }),
    el("span", { class: "hbar-track", "aria-hidden": "true" }, [
      el("i", { class: `s-c${(item.color ?? i) % DASH_LINES}`, style: `width: ${width(item.value)}%` }),
      item.ghost ? el("b", { class: "hbar-ghost", title: L("Compared period", "तुलना की अवधि"), style: `left: ${width(item.ghost)}%` }) : "",
    ]),
    el("span", { class: "hbar-value", title: item.title || "", text: item.text }),
    item.change ?? "",
  ])));
}

function sparkline(values) {
  if (values.filter((v) => v > 0).length < 2) return "";
  const width = 110;
  const height = 30;
  const max = Math.max(...values) || 1;
  const points = values.map((v, i) => `${((i * width) / (values.length - 1)).toFixed(1)},${(height - 3 - (v / max) * (height - 6)).toFixed(1)}`).join(" ");
  return svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "spark", "aria-hidden": "true", preserveAspectRatio: "none" }, [svg("polyline", { points })]);
}

function legend(items) {
  return el("div", { class: "legend" }, items.map(([className, text]) => el("span", { class: "legend-item" }, [el("i", { class: `legend-swatch ${className}` }), text])));
}

/** The 12 months up to the end of the period, for the small trend lines in the tiles. */
function sparkMonths(view) {
  const last = view.months.at(-1);
  return monthRange(addMonths(last, -11), last).filter(inData);
}
