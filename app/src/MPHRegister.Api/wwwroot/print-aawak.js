"use strict";

// Printable AAWAK totals (the workbook's Total sheet for any period) and one statement per lorry wala.
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
  head.forEach(([text, cls]) => thead.append(node("th", text, cls)));
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
  return table([[caption], ["Rows", "n"], ["NAG", "n"]],
    lines.map((l) => [[l.isGroup ? `${l.name} (${l.members.join(", ")})` : l.name], [INDIAN.format(l.arrivals), "n"], [INDIAN.format(l.nag), "n"]]),
    [["Grand Total"], [INDIAN.format(lines.reduce((s, l) => s + l.arrivals, 0)), "n"], [INDIAN.format(nag), "n"]]);
}

async function main() {
  const query = new URLSearchParams({ from: params.get("from") || "", to: params.get("to") || "", group: params.get("group") || "true", order: params.get("order") || "nag" });
  const totals = await get(`/api/arrivals/totals?${query}`);
  const period = `${day(totals.from)} to ${day(totals.to)}`;
  if (params.get("kind") === "statements") {
    document.title = `AAWAK lorry-wala statements ${period}`;
    for (const lorry of totals.transporters) {
      const statement = await get(`/api/arrivals/statement?${new URLSearchParams({ from: totals.from, to: totals.to, transporter: lorry.name })}`);
      const section = node("section", undefined, "statement");
      section.append(node("h1", `AAWAK — ${statement.transporter}`), node("p", `${period} · ${INDIAN.format(statement.arrivals.length)} rows · ${INDIAN.format(statement.nag)} NAG`, "sub"));
      section.append(table([["DATE"], ["AAWAK NO"], ["PARTY"], ["NAG", "n"], ["INW NO"]],
        statement.arrivals.map((a) => [[day(a.arrivalDate)], [a.number], [a.party], [INDIAN.format(a.nag), "n"], [a.inwardText]]),
        [[""], [""], ["Total"], [INDIAN.format(statement.nag), "n"], [""]]));
      page.append(section);
    }
    if (!totals.transporters.length) page.append(node("p", `No AAWAK rows from ${period}.`));
    return;
  }
  document.title = `AAWAK totals ${period}`;
  page.append(node("h1", "AAWAK totals"), node("p", `${period} · ${INDIAN.format(totals.arrivals)} rows · ${INDIAN.format(totals.nag)} NAG`, "sub"));
  const pair = node("div", undefined, "pair");
  pair.append(totalsTable(totals.groupSisters ? "PARTY / GROUP" : "PARTY", totals.parties, totals.nag), totalsTable("LORRY WALA", totals.transporters, totals.nag));
  page.append(pair);
}

document.getElementById("printNow").addEventListener("click", () => window.print());
document.getElementById("closePage").addEventListener("click", () => window.close());
main().catch((error) => page.replaceChildren(node("p", `Could not load the totals: ${error.message}`, "error")));
