"use strict";

// Printable Aawak totals (the workbook's Total sheet for any period) and one statement per lorry wala.
const params = new URLSearchParams(location.search);
const INDIAN = new Intl.NumberFormat("en-IN");
const page = document.getElementById("page");

function node(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}

function day(iso) {
  const [y, m, d] = String(iso || "").split("-");
  return y ? `${d}.${m}.${y.slice(2)}` : "";
}

function table(head, rows, foot) {
  const t = node("table");
  const thead = t.createTHead().insertRow();
  head.forEach(([text, cls]) => {
    const th = node("th", text, cls);
    th.scope = "col";
    thead.append(th);
  });
  const body = t.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    row.forEach(([text, cls]) => tr.append(node("td", text, cls)));
  }
  if (foot) {
    const tr = t.createTFoot().insertRow();
    foot.forEach(([text, cls]) => tr.append(node("th", text, cls)));
  }
  return t;
}

async function get(path) {
  const response = await fetch(path);
  const body = await response.json();
  if (!response.ok) throw new Error((body.errors || [`Request failed (${response.status})`]).join(" "));
  return body;
}

function totalsTable(caption, lines, nag) {
  const t = table([[caption], ["Rows", "n"], ["Share", "n"], ["NAG", "n"]],
    lines.map((l) => [[l.name], [INDIAN.format(l.arrivals), "n"], [`${nag ? (l.nag / nag * 100).toLocaleString("en-IN", { maximumFractionDigits: 1 }) : 0}%`, "n"], [INDIAN.format(l.nag), "n"]]),
    [["Period total"], [INDIAN.format(lines.reduce((s, l) => s + l.arrivals, 0)), "n"], [nag ? "100%" : "0%", "n"], [INDIAN.format(nag), "n"]]);
  t.className = "totals-table";
  lines.forEach((l, i) => {
    if (l.isGroup) t.tBodies[0].rows[i].cells[0].append(node("small", l.members.join(", ")));
  });
  return t;
}

function reportHeader(title, period, note) {
  const header = node("header", undefined, "report-header");
  header.append(node("p", "MPH REGISTER / GATE ARRIVALS", "eyebrow"), node("h1", title), node("p", period, "period"), node("p", note, "sub"));
  return header;
}

function reportSection(title, content) {
  const section = node("section", undefined, `report-section${content.tBodies[0].rows.length <= 12 ? " compact" : ""}`);
  section.append(node("h2", title), content);
  return section;
}

async function main() {
  const query = new URLSearchParams({ from: params.get("from") || "", to: params.get("to") || "", group: params.get("group") || "true", order: params.get("order") || "nag" });
  const totals = await get(`/api/arrivals/totals?${query}`);
  const period = `${day(totals.from)} to ${day(totals.to)}`;
  page.replaceChildren();
  if (!totals.arrivals) {
    page.append(reportHeader("Aawak totals", period, "No arrivals in this period."), node("p", "Choose another period in Aawak totals to prepare a report."));
    return;
  }
  if (params.get("kind") === "statements") {
    document.title = `Aawak lorry-wala statements ${period}`;
    for (const lorry of totals.transporters) {
      const statement = await get(`/api/arrivals/statement?${new URLSearchParams({ from: totals.from, to: totals.to, transporter: lorry.name })}`);
      const section = node("section", undefined, "statement");
      section.append(reportHeader(statement.transporter, period, `Lorry-wala statement \u00b7 ${INDIAN.format(statement.arrivals.length)} rows \u00b7 ${INDIAN.format(statement.nag)} NAG`));
      section.append(table([["DATE"], ["Aawak NO"], ["PARTY"], ["NAG", "n"], ["INW NO"]],
        statement.arrivals.map((a) => [[day(a.arrivalDate)], [a.number], [a.party], [INDIAN.format(a.nag), "n"], [a.inwardText]]),
        [[""], [""], ["Total"], [INDIAN.format(statement.nag), "n"], [""]]));
      page.append(section);
    }
    return;
  }
  document.title = `Aawak totals ${period}`;
  page.append(reportHeader("Aawak totals", period, `${totals.groupSisters ? "Sister firms combined under their group" : "Individual parties; sister firms shown separately"} \u00b7 ${totals.order === "first" ? "First arrival first" : "Most NAG first"}`));
  const summary = node("div", undefined, "summary");
  for (const [label, value] of [["Total NAG", totals.nag], ["Aawak rows", totals.arrivals], [totals.groupSisters ? "Parties / groups" : "Parties", totals.parties.length], ["Lorry walas", totals.transporters.length]]) {
    const stat = node("div");
    stat.append(node("span", label), node("b", INDIAN.format(value)));
    summary.append(stat);
  }
  const daily = reportSection("03 / Daily breakdown", totalsTable("Date", totals.days.map((d) => ({ name: day(d.date), arrivals: d.arrivals, nag: d.nag })), totals.nag));
  daily.id = "dailyReport";
  daily.hidden = true;
  page.append(summary,
    reportSection(totals.groupSisters ? "01 / By party / group" : "01 / By party", totalsTable(totals.groupSisters ? "Party / group" : "Party", totals.parties, totals.nag)),
    reportSection("02 / By lorry wala", totalsTable("Lorry wala", totals.transporters, totals.nag)),
    daily, node("footer", "Rows are Aawak entries, not inward slips. Each breakdown is a separate view of the same period total; do not add the sections together.", "report-footer"));
  document.getElementById("dailyOption").hidden = false;
}

document.getElementById("printNow").addEventListener("click", () => window.print());
document.getElementById("closePage").addEventListener("click", () => window.close());
document.getElementById("includeDaily").addEventListener("change", (event) => {
  document.getElementById("dailyReport").hidden = !event.target.checked;
});
main().then(() => {
  page.setAttribute("aria-busy", "false");
  document.getElementById("printNow").disabled = !page.querySelector("table");
}).catch((error) => {
  page.setAttribute("aria-busy", "false");
  page.replaceChildren(node("p", `Could not load the report: ${error.message}`, "error"));
});
