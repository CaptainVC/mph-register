// Billing + masters API tests. Run against a fresh data folder (started from the real v0.4 seed, see private-data.js, so the
// config file holds the frozen seed lists) with October inward imported.
import { createRequire } from "node:module";
const { load } = createRequire(import.meta.url)("./private-data.js");
const { P, GSTIN, FIRM } = load();
const TWO_BILL = encodeURIComponent(P.twoBillParty);
const BASE = process.env.BASE || "http://127.0.0.1:5152";
const H = { "X-MPH-Request": "1", "Content-Type": "application/json" };
let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => (ok ? passed++ : failures.push(`${name}${detail ? ` — ${detail}` : ""}`));
const call = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: method === "GET" ? {} : H, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await r.json(); } catch { json = null; }
  return { status: r.status, body: json };
};
const errorsOf = (r) => (r.body && r.body.errors ? r.body.errors.join(" | ") : "");
// Excel's October bills took the whole October register: inward from 26 Sep plus 2 slips carried over from 25 Sep.
const PERIOD = "from=2026-09-25&to=2026-10-31";
const OCT = { month: "2026-10", billDate: "2026-10-31", periodFrom: "2026-09-25", periodTo: "2026-10-31" };

function gstin(prefix) {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < 14; i++) { const p = chars.indexOf(prefix[i]) * (i % 2 === 0 ? 1 : 2); sum += Math.floor(p / 36) + (p % 36); }
  return prefix + chars[(36 - (sum % 36)) % 36];
}

async function build(party, entryFilter = (e) => e.selected) {
  const c = (await call("GET", `/api/billing/candidates?party=${encodeURIComponent(party)}&${PERIOD}`)).body;
  const ids = c.entries.filter(entryFilter).map((e) => e.entryId);
  return { c, ids, r: await call("POST", "/api/billing/build", { party, entryIds: ids, ...OCT }) };
}

(async () => {
  // ---------- Masters ----------
  let m = (await call("GET", "/api/masters/full")).body;
  check("seeded parties (all months, incl. one only in another month)", m.parties.length === 158 && m.parties.some((p) => p.name === P.otherMonthParty), String(m.parties.length));
  check("seeded finishes incl. bill-only and November ones", m.finishes.length === 30 && m.finishes.some((f) => f.name === "2SCZ") && m.finishes.some((f) => f.name === "Z"), String(m.finishes.length));
  check("seeded finish groups", m.groups.length === 11, String(m.groups.length));
  const badGstin = m.parties.find((p) => p.name === P.badGstinParty);
  check("bad GSTIN flagged", badGstin.problems.includes("GSTIN is not valid"), badGstin.problems.join(","));
  const big = m.parties.find((p) => p.name === P.bigParty);
  check("big party billing details", big.discount === 19.75 && big.gstin === GSTIN.bigParty && big.rates.S2G === 75 && big.rates["2S2G"] === 100 && big.billBeforeDispatch === true
    && big.style.gpnColumn === "gatePass" && big.style.order === "reference");
  check("named billing styles shared by parties", m.styles.length === 12 && m.styles[0].name === "D.N. + LOT" && m.styles.reduce((s, x) => s + x.parties, 0) === m.parties.length, m.styles.map((x) => `${x.name}:${x.parties}`).join("|"));
  const sisterGroup = m.parties.find((p) => p.name === P.sisterA).sisterGroup;
  check("sister firm A linked to sister firm B", Boolean(sisterGroup) && m.parties.find((p) => p.name === P.sisterB).sisterGroup === sisterGroup);
  check("finish groups from inward Details", m.finishes.find((f) => f.name === "SMG").group === "SGZ" && m.finishes.find((f) => f.name === "2S2G").group === "MIX");

  const good = gstin("08ABCDE1234F1Z");
  const base = { name: "TEST PARTY ONE", active: true, address: "TEST TOWN-000000", state: "(RAJASTHAN)", gstin: good, discount: 12.5, color: "black", billingStyle: "D.N. + LOT", billBeforeDispatch: false, billAs: {}, rates: { SGZ: 90, S2G: 75.5 } };
  let r = await call("POST", "/api/masters/party", base);
  check("add party", r.status === 200 && r.body.name === "TEST PARTY ONE" && r.body.rates.S2G === 75.5, errorsOf(r));
  r = await call("POST", "/api/masters/party", { ...base, name: "  test   party one " });
  check("duplicate name rejected (case/spaces)", r.status === 400 && errorsOf(r).includes("already exists"), errorsOf(r));
  r = await call("POST", "/api/masters/party", { ...base, name: "TEST PARTY TWO", gstin: "08ABCDE1234F1ZX" });
  check("GSTIN with wrong check character rejected", r.status === 400 && errorsOf(r).includes("not valid"), errorsOf(r));
  r = await call("POST", "/api/masters/party", { ...base, name: "TEST PARTY TWO", gstin: `08${good}` });
  check("17-character GSTIN rejected", r.status === 400, errorsOf(r));
  r = await call("POST", "/api/masters/party", { ...base, name: "TEST PARTY TWO", discount: 120 });
  check("discount over 100 rejected", r.status === 400 && errorsOf(r).includes("between 0 and 100"));
  r = await call("POST", "/api/masters/party", { ...base, name: "TEST PARTY TWO", rates: { NOPE: 10 } });
  check("rate for unknown finish rejected", r.status === 400 && errorsOf(r).includes("unknown finish"));
  r = await call("POST", "/api/masters/party", { ...base, name: "TEST PARTY TWO", rates: { SGZ: -5 } });
  check("negative rate rejected", r.status === 400 && errorsOf(r).includes("more than 0"));
  r = await call("POST", "/api/masters/style", { name: "NOTHING SHOWN", gpnColumn: "blank", dnColumn: "blank", lotColumn: "blank", lines: "onePerEntry", order: "inward" });
  check("bill with no reference columns rejected", r.status === 400 && errorsOf(r).includes("at least one"));
  r = await call("POST", "/api/masters/party", { ...base, name: "TEST PARTY TWO", billingStyle: "NO SUCH STYLE" });
  check("unknown billing style rejected", r.status === 400 && errorsOf(r).includes("not in the list of billing styles"), errorsOf(r));
  r = await call("POST", "/api/masters/party", { ...base, name: "TEST PARTY TWO", color: "rainbow" });
  check("unknown colour rejected", r.status === 400);
  r = await call("POST", "/api/masters/party", { ...base, originalName: "TEST PARTY ONE", active: false });
  check("mark party inactive", r.status === 200 && r.body.active === false);
  const light = (await call("GET", "/api/masters")).body;
  check("inactive party still listed for combos (as inactive)", light.parties.some((p) => p.name === "TEST PARTY ONE" && !p.active));

  // Rename a party with entries: entries, rates follow; bills keep their snapshot.
  const renamed = m.parties.find((p) => p.name === P.renameParty);
  const newName = `${P.renameParty} NEW`;
  r = await call("POST", "/api/masters/party", { ...renamed, originalName: P.renameParty, name: newName, rates: renamed.rates });
  const oct = (await call("GET", "/api/entries?month=2026-10")).body;
  check("rename moves entries", r.status === 200 && oct.filter((e) => e.party === newName).length === renamed.entries && !oct.some((e) => e.party === P.renameParty), errorsOf(r));
  check("rename keeps rates", r.body && r.body.rates.SGZ === renamed.rates.SGZ);
  r = await call("POST", "/api/masters/party", { ...renamed, originalName: newName, name: P.renameParty, rates: renamed.rates });
  check("rename back", r.status === 200);

  // Finishes and groups
  r = await call("POST", "/api/masters/group", { name: "TESTGROUP", active: true });
  check("add group", r.status === 200);
  r = await call("POST", "/api/masters/finish", { name: "TST1", active: true, group: "TESTGROUP", color: "red" });
  check("add finish with group and colour", r.status === 200 && r.body.group === "TESTGROUP" && r.body.color === "red", errorsOf(r));
  r = await call("POST", "/api/masters/finish", { name: "tst1", active: true });
  check("duplicate finish rejected", r.status === 400);
  r = await call("POST", "/api/masters/finish", { name: "TST2", group: "NOGROUP", active: true });
  check("unknown group rejected", r.status === 400 && errorsOf(r).includes("not in the group list"));
  await call("POST", "/api/masters/party", { ...base, originalName: "TEST PARTY ONE", rates: { SGZ: 90, TST1: 50 }, billAs: { TST1: "SGZ" } });
  r = await call("POST", "/api/masters/finish", { originalName: "TST1", name: "TST9", active: true, group: "TESTGROUP", color: "red" });
  m = (await call("GET", "/api/masters/full")).body;
  const tp = m.parties.find((p) => p.name === "TEST PARTY ONE");
  check("finish rename updates rates and bill-as map", r.status === 200 && tp.rates.TST9 === 50 && tp.billAs.TST9 === "SGZ" && !tp.rates.TST1, JSON.stringify(tp.billAs));
  r = await call("POST", "/api/masters/group", { originalName: "TESTGROUP", name: "TESTGROUP2", active: false });
  m = (await call("GET", "/api/masters/full")).body;
  check("group rename moves finishes", r.status === 200 && m.finishes.find((f) => f.name === "TST9").group === "TESTGROUP2");

  // Settings
  const settings = (await call("GET", "/api/settings?fy=26-27")).body;
  check("firm settings moved from the data file", settings.firm.name === FIRM.name && settings.billRules.totalMustStayBelow === 200000 && settings.billRules.combineSmallBelowThan === 5
    && settings.billRules.combineUpTo === 4 && settings.nextSerial === 279 && settings.printedTexts.sacLine === "SAC CODE-998821", JSON.stringify({ n: settings.nextSerial }));
  r = await call("PUT", "/api/settings", { billRules: { ...settings.billRules, rowsPerBill: 3 }, fy: "26-27" });
  check("rows per bill too small rejected", r.status === 400);
  r = await call("PUT", "/api/settings", { billRules: { ...settings.billRules, rowsPerBill: settings.limits.maxRowsLetter + 1 }, fy: "26-27" });
  check("rows per bill above what Letter paper holds rejected", r.status === 400 && errorsOf(r).includes(`At most ${settings.limits.maxRowsLetter} rows`), errorsOf(r));
  r = await call("PUT", "/api/settings", { firm: { ...settings.firm, gstin: FIRM.gstin.slice(0, 14) + (FIRM.gstin.endsWith("X") ? "Y" : "X") }, fy: "26-27" });
  check("bad firm GSTIN rejected", r.status === 400);
  r = await call("PUT", "/api/settings", { printedTexts: { ...settings.printedTexts, sacLine: "SAC CODE-998821" }, fy: "26-27", nextSerial: 279 });
  check("save settings", r.status === 200, errorsOf(r));

  // ---------- Candidates and confirmed rules ----------
  let { c, ids, r: built } = await build(P.bigParty);
  check("bill-before-dispatch party ticks undispatched entries", c.entries.filter((e) => e.dispatchState === "none").every((e) => e.selected) && c.entries.filter((e) => e.dispatchState === "none").length === 6);
  check("repairs never offered", !c.entries.some((e) => e.inwardNo === 668));
  check("D.N. 12409 taken from inward (not 13409)", c.entries.some((e) => e.inwardNo === 337 && e.designNo === "12409"));
  const dn217 = c.entries.find((e) => e.designNo === "217");
  check("D.N. 217 billed at NETT THAN 27", dn217 && dn217.nettThan === 27);
  const vdocs = built.body;
  const vlines = vdocs.flatMap((d) => d.lines);
  check("big party builds", built.status === 200 && vdocs.length >= 11, errorsOf(built));
  check("D.N. 217 line qty is 27", vlines.some((l) => l.dn === "217" && l.qty === 27));
  const small = vlines.filter((l) => (l.entryIds || []).length > 1);
  const byId = new Map(c.entries.map((e) => [e.entryId, e]));
  check("small 2S2G entries combined (up to 4 per line)", small.length > 0 && small.every((l) => l.entryIds.length <= 4 && l.entryIds.every((id) => byId.get(id).nettThan < 5)), JSON.stringify(small.map((l) => l.entryIds.length)));
  check("combined lines keep one finish", small.every((l) => new Set(l.entryIds.map((id) => byId.get(id).billFinish)).size === 1));
  const finishOk = vdocs.every((d) => {
    let pending = [];
    return d.lines.every((l) => {
      if (l.kind === "blank") { pending = []; return true; }
      if (l.kind === "detail") { pending.push(...(l.entryIds || [])); return true; }
      const ids = [...pending, ...(l.entryIds || [])];
      pending = [];
      return ids.every((id) => byId.get(id).billFinish === l.finish);
    });
  });
  check("every priced row only sums entries of its own finish", finishOk);
  const twoS2G = vlines.filter((l) => l.kind === "priced" && l.finish === "2S2G");
  check("2S2G group kept whole: 116 THAN x 100 = 11600", twoS2G.length === 1 && twoS2G[0].qty === 116 && twoS2G[0].amount === 11600, JSON.stringify(twoS2G.map((l) => [l.qty, l.amount])));
  check("all quantities billed = NETT THAN", vdocs.reduce((s, d) => s + d.than, 0) === c.entries.filter((e) => ids.includes(e.entryId)).reduce((s, e) => s + e.nettThan, 0));
  check("every bill has at most 25 printed rows", vdocs.every((d) => d.lines.reduce((s, l) => s + l.rows, 0) <= 25), vdocs.map((d) => d.lines.reduce((s, l) => s + l.rows, 0)).join(","));
  check("early-billed entries warned", vdocs.some((d) => d.warnings.some((w) => w.includes("before dispatch"))));

  ({ c, ids, r: built } = await build(P.twoBillParty));
  check("dispatched-only party leaves undispatched unticked", c.entries.filter((e) => e.dispatchState === "none").length === 4 && c.entries.filter((e) => e.dispatchState === "none").every((e) => !e.selected));
  check("two-bill party total equals Excel (223,999)", built.body.reduce((s, d) => s + d.total, 0) === 223999, built.body.map((d) => d.total).join(","));
  check("two-bill party carryovers come first", built.body[0].lines[0].lot === "82" && built.body[0].lines[1].lot === "77", `${built.body[0].lines[0].lot},${built.body[0].lines[1].lot}`);

  // Bill period: only slips with an inward date inside it are offered or billed.
  const octOnly = (await call("GET", `/api/billing/candidates?party=${TWO_BILL}&from=2026-10-01&to=2026-10-31`)).body;
  const sepSlips = c.entries.filter((e) => e.entryDate < "2026-10-01");
  check("1-31 Oct period hides the party's September slips (incl. carryovers 82, 77)", sepSlips.length === 6 && ["82", "77"].every((lot) => sepSlips.some((e) => e.lotNo === lot))
    && octOnly.entries.length === c.entries.length - sepSlips.length && octOnly.entries.every((e) => e.entryDate >= "2026-10-01" && e.entryDate <= "2026-10-31"),
  `${sepSlips.length} Sep, ${octOnly.entries.length} of ${c.entries.length} in Oct`);
  const octParty = (await call("GET", "/api/billing/parties?from=2026-10-01&to=2026-10-31")).body.find((p) => p.party === P.twoBillParty);
  check("to-bill list counts only slips in the period", octParty.entries === octOnly.entries.length, JSON.stringify(octParty));
  r = await call("POST", "/api/billing/build", { party: P.twoBillParty, entryIds: sepSlips.map((e) => e.entryId), ...OCT, periodFrom: "2026-10-01" });
  check("slips dated before the period cannot be billed in it", r.status === 400 && errorsOf(r).includes("outside the bill period"), errorsOf(r));
  r = await call("GET", "/api/billing/parties?month=2026-10");
  check("to-bill list needs a bill period", r.status === 400 && errorsOf(r).includes("valid bill period"), errorsOf(r));

  for (const [alias, party] of [["twinNameA", P.twinNameA], ["twinNameB", P.twinNameB], ["splitBillsA", P.splitBillsA], ["splitBillsB", P.splitBillsB]]) {
    const b = (await build(party)).r.body;
    check(`${alias}: every bill below 2 lakh`, b.length > 1 && b.every((d) => d.total < 200000), b.map((d) => d.total).join(","));
  }
  const sister = (await call("GET", `/api/billing/candidates?party=${encodeURIComponent(P.sisterA)}&${PERIOD}`)).body;
  check("sister firm A's entries can be billed as sister firm B", sister.billParty === P.sisterA && sister.billRecipients.includes(P.sisterB)
    && sister.entries.length === 1 && sister.entries[0].party === P.sisterA);
  const billAs = (await build(P.billAsParty)).r.body;
  check("bill-as finish (Gotka S2G billed as S2G)", billAs.every((d) => d.lines.filter((l) => l.kind === "priced").every((l) => l.finish === "S2G")) && billAs[0].total === 23000, billAs.map((d) => d.total).join(","));
  const dnInLot = (await build(P.dnInLotParty)).r.body;
  check("D.N. shown in LOT NO. column", dnInLot[0].lines[0].lot === "487" && dnInLot[0].lines[0].dn === "" && dnInLot[0].total === 9702, JSON.stringify(dnInLot[0].lines[0]));

  // ---------- Compute ----------
  const doc = dnInLot[0];
  const words = (await call("POST", "/api/billing/compute", { ...doc, lines: [{ kind: "priced", finish: "SGZ", qty: 2129, rate: 90, autoSum: false, entryIds: [] }], discountPct: 10 })).body;
  check("amount in words (exact Excel RupeeFormat text)", words.total === 181071 && words.amountInWords === " Rupees  One Lakh Eighty One Thousand Seventy One Only", `${words.total} ${JSON.stringify(words.amountInWords)}`);
  r = await call("POST", "/api/billing/compute", { ...doc, lines: [{ kind: "priced", finish: "SGZ", qty: 5, rate: 1.005, autoSum: false, entryIds: [] }] });
  check("rate with 3 decimals rejected", r.status === 400);
  const half = (await call("POST", "/api/billing/compute", { ...doc, discountPct: 0, lines: [{ kind: "priced", finish: "SGZ", qty: 1, rate: 10.5, autoSum: false, entryIds: [] }] })).body;
  check("Excel rounding (half away from zero)", half.gross === 11, String(half.gross));
  const autoSum = (await call("POST", "/api/billing/compute", { ...doc, lines: [
    { kind: "detail", lot: "1", qty: 10, entryIds: [] }, { kind: "detail", lot: "2", qty: 15, entryIds: [] },
    { kind: "priced", finish: "S2G", qty: 999, rate: 75, autoSum: true, entryIds: [] }] })).body;
  check("summary row adds the lines above", autoSum.lines[2].qty === 25 && autoSum.gross === 1875);

  // ---------- Save, numbering, double billing ----------
  ({ c, ids, r: built } = await build(P.twoBillParty));
  r = await call("POST", "/api/billing/save", { invoices: built.body });
  const saved = r.body;
  check("save numbers bills in sequence", r.status === 200 && saved.map((s) => s.invoiceNo).join(",") === "26-27\\JOB\\279,26-27\\JOB\\280", errorsOf(r) || saved.map((s) => s.invoiceNo).join(","));
  check("saved totals unchanged", saved.reduce((s, d) => s + d.total, 0) === 223999);
  r = await call("POST", "/api/billing/save", { invoices: built.body });
  check("same entries cannot be billed twice", r.status === 400 && errorsOf(r).includes("already billed"), errorsOf(r));
  const after = (await call("GET", `/api/billing/candidates?party=${TWO_BILL}&${PERIOD}`)).body;
  check("billed entries leave the list", after.entries.length === 4);
  const octAfter = (await call("GET", "/api/entries?month=2026-10")).body;
  check("register shows bill number", octAfter.filter((e) => e.billedIn === "26-27\\JOB\\279").length === saved[0].lines.reduce((s, l) => s + (l.entryIds || []).length, 0));
  const parties = (await call("GET", `/api/billing/parties?${PERIOD}`)).body;
  check("to-bill list shows the party's 4 undelivered entries", parties.find((p) => p.party === P.twoBillParty).entries === 4 && parties.find((p) => p.party === P.twoBillParty).notDispatched === 4);

  // Edit
  const inv = (await call("GET", `/api/invoices/${saved[0].id}`)).body;
  const edited = inv.lines.map((l) => (l.kind === "priced" ? { ...l, rate: 91 } : l));
  r = await call("PUT", `/api/invoices/${inv.id}`, { billDate: inv.billDate, periodFrom: inv.periodFrom, periodTo: inv.periodTo, notes: "rate check", refreshParty: false, lines: edited });
  check("edit rate recomputes totals", r.status === 200 && r.body.gross === inv.than * 91 && r.body.invoiceNo === inv.invoiceNo, errorsOf(r));
  r = await call("PUT", `/api/invoices/${inv.id}`, { billDate: "2027-04-02", periodFrom: inv.periodFrom, periodTo: inv.periodTo, lines: edited });
  check("bill date cannot move to another financial year", r.status === 400 && errorsOf(r).includes("financial year"));
  r = await call("PUT", `/api/invoices/${inv.id}`, { billDate: inv.billDate, periodFrom: inv.periodFrom, periodTo: inv.periodTo, lines: [...edited, { kind: "detail", lot: "X", qty: 1, entryIds: [after.entries[0].entryId] }] });
  check("cannot add new entries to a saved bill", r.status === 400 && errorsOf(r).includes("only be removed"));
  const firstDetail = edited.findIndex((l) => l.kind === "detail" && (l.entryIds || []).length);
  const released = edited[firstDetail].entryIds;
  r = await call("PUT", `/api/invoices/${inv.id}`, { billDate: inv.billDate, periodFrom: inv.periodFrom, periodTo: inv.periodTo, lines: edited.filter((_, i) => i !== firstDetail) });
  const afterRemove = (await call("GET", `/api/billing/candidates?party=${TWO_BILL}&${PERIOD}`)).body;
  check("removing a line releases its entries", r.status === 200 && released.every((id) => afterRemove.entries.some((e) => e.entryId === id)), errorsOf(r));

  // Cancel
  r = await call("POST", `/api/invoices/${saved[1].id}/cancel`);
  check("cancel bill", r.status === 200 && r.body.status === "cancelled");
  r = await call("POST", `/api/invoices/${saved[1].id}/cancel`);
  check("cancel twice rejected", r.status === 400);
  r = await call("PUT", `/api/invoices/${saved[1].id}`, { billDate: inv.billDate, periodFrom: inv.periodFrom, periodTo: inv.periodTo, lines: edited });
  check("cancelled bill cannot be edited", r.status === 400);
  const rebuilt = await build(P.twoBillParty, (e) => e.dispatchState !== "none");
  r = await call("POST", "/api/billing/save", { invoices: rebuilt.r.body });
  check("cancelled number is not reused", r.status === 200 && r.body[0].invoiceNo === "26-27\\JOB\\281", errorsOf(r) || r.body.map((x) => x.invoiceNo).join(","));
  const list = (await call("GET", "/api/invoices?month=2026-10")).body;
  check("bill list", list.length === 3 && list.some((i) => i.status === "cancelled"));

  // Inter-state party → IGST
  await call("POST", "/api/masters/party", { ...base, originalName: "TEST PARTY ONE", active: true, gstin: gstin("24TESTA0001A1Z"), state: "TEST CITY-(GUJ.)" });
  const igst = (await call("POST", "/api/billing/compute", { ...doc, party: "TEST PARTY ONE", taxMode: "inter", discountPct: 0, igstRate: 5, lines: [{ kind: "priced", finish: "SGZ", qty: 100, rate: 90, autoSum: false, entryIds: [] }] })).body;
  check("IGST for other-state bill", igst.igst === 450 && igst.cgst === 0 && igst.sgst === 0 && igst.total === 9450, JSON.stringify({ i: igst.igst, c: igst.cgst, t: igst.total }));

  // Billed elsewhere
  const left = (await call("GET", `/api/billing/candidates?party=${TWO_BILL}&${PERIOD}`)).body.entries.map((e) => e.entryId);
  r = await call("POST", "/api/billing/elsewhere", { entryIds: left.slice(0, 2), note: "Billed in Excel" });
  const afterMark = (await call("GET", `/api/billing/candidates?party=${TWO_BILL}&${PERIOD}`)).body.entries.length;
  check("mark billed elsewhere", r.status === 200 && r.body.changed === 2 && afterMark === left.length - 2);
  r = await call("POST", "/api/billing/elsewhere", { entryIds: left.slice(0, 2), undo: true });
  check("undo billed elsewhere", r.status === 200 && (await call("GET", `/api/billing/candidates?party=${TWO_BILL}&${PERIOD}`)).body.entries.length === left.length);

  // Security
  const noHeader = await fetch(`${BASE}/api/billing/save`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  check("billing writes need the app header", noHeader.status === 403);

  console.log(`PASSED ${passed}`);
  if (failures.length) { console.log(`FAILED ${failures.length}`); failures.forEach((f) => console.log("  " + f)); process.exit(1); }
  console.log("PASS: masters, billing rules, numbering, editing, cancelling, IGST and safety checks");
})().catch((e) => { console.error(e); process.exit(1); });
