// Exercises every entry and validation path against the running app.
import { createRequire } from "node:module";
const { load } = createRequire(import.meta.url)("./private-data.js");
const { P } = load();
const BASE = "http://127.0.0.1:5152";
let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

async function call(method, path, json, headers = { "X-MPH-Request": "1" }) {
  const response = await fetch(BASE + path, {
    method,
    headers: { ...headers, ...(json ? { "Content-Type": "application/json" } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
  let body = null;
  try { body = await response.json(); } catch {}
  return { status: response.status, body };
}

const base = {
  registerMonth: "2026-11", entryDate: "2026-11-02", party: P.bigParty, designNo: "13501",
  lotNo: "L-77", repair: false, than: 20, tp: 1, twoPart: 2, finish: "S2G", shortThan: null, dispatches: [],
};

async function expectErrors(name, overrides, fragment) {
  const { status, body } = await call("POST", "/api/entries", { ...base, inwardNo: 9000, ...overrides });
  const text = (body?.errors || []).join(" | ");
  check(name, status === 400 && text.includes(fragment), `status ${status}: ${text}`);
}

(async () => {
  const before = (await call("GET", "/api/info")).body.entries;

  // Inward numbering per month.
  let r = await call("GET", "/api/next-inward?month=2026-11");
  check("next number starts at 1 in empty month", r.status === 200 && r.body.next === 1, JSON.stringify(r.body));
  r = await call("GET", "/api/next-inward?month=2026-10");
  check("next number continues October after imports (excludes carryovers)", r.body.next === 984, JSON.stringify(r.body));

  // Save a new entry.
  r = await call("POST", "/api/entries", { ...base, inwardNo: 1 });
  check("save new entry", r.status === 200, JSON.stringify(r.body));
  const created = r.body;
  check("NAG = THAN + TP", created.nag === 21);
  check("NETT THAN = THAN when not repair", created.nettThan === 20);
  check("balance = NAG + TWO PART", created.balance === 23);
  check("status nothing dispatched", created.status === "pending");
  check("text fields trimmed and kept", created.lotNo === "L-77" && created.designNo === "13501");
  r = await call("GET", "/api/next-inward?month=2026-11");
  check("next number advances", r.body.next === 2);

  // Party names are stored with their exact master spelling.
  r = await call("POST", "/api/entries", { ...base, inwardNo: 2, party: `  ${P.bigParty.toLowerCase()} `, finish: "s2g", repair: true });
  check("case-insensitive party/finish accepted", r.status === 200, JSON.stringify(r.body));
  check("stored with master spelling", r.body?.party === P.bigParty && r.body?.finish === "S2G", `${r.body?.party} / ${r.body?.finish}`);
  check("repair gives NETT THAN 0", r.body?.nettThan === 0);

  // Validation rules.
  await expectErrors("duplicate inward number in same month", { inwardNo: 1 }, "already used this month");
  await expectErrors("unknown party", { party: "NOT A REAL PARTY" }, "not in the party list");
  await expectErrors("blank party", { party: "" }, "Choose a party");
  await expectErrors("unknown finish", { finish: "ZZZ" }, "not in the finish list");
  await expectErrors("bad date", { entryDate: "2026-02-30" }, "valid date");
  await expectErrors("missing date", { entryDate: null }, "valid date");
  await expectErrors("negative THAN", { than: -1 }, "THAN must be 0 or more");
  await expectErrors("zero quantity", { than: 0, tp: 0 }, "more than 0");
  await expectErrors("negative TP", { tp: -2 }, "TP cannot be negative");
  await expectErrors("negative TWO PART", { twoPart: -2 }, "TWO PART cannot be negative");
  await expectErrors("negative SHORT THAN", { shortThan: -1 }, "SHORT THAN cannot be negative");
  await expectErrors("negative inward number", { inwardNo: -1 }, "Inward number must be 0 or more");

  // A blank finish (filled in later) and INW. NO. 0 (a slip without a number) save, and show as warnings instead.
  const entryBody = (e, extra) => ({
    registerMonth: e.registerMonth, inwardNo: e.inwardNo, entryDate: e.entryDate, party: e.party, designNo: e.designNo,
    lotNo: e.lotNo, repair: e.repair, than: e.than, tp: e.tp, twoPart: e.twoPart, finish: e.finish, shortThan: e.shortThan,
    dispatches: e.dispatches.map((d) => ({ qty: d.qty, gatePass: d.gatePass, date: d.date })), ...extra,
  });
  r = await call("PUT", `/api/entries/${created.id}`, entryBody(created, { finish: "" }));
  check("blank finish saves with a warning", r.status === 200 && r.body.finish === "" && r.body.warnings.includes("Finish is missing."), JSON.stringify(r.body));
  r = await call("PUT", `/api/entries/${created.id}`, entryBody(created, { inwardNo: 0 }));
  check("inward number 0 saves with a warning", r.status === 200 && r.body.inwardNo === 0 && r.body.warnings.includes("INW. NO. is blank in the register."), JSON.stringify(r.body));
  r = await call("PUT", `/api/entries/${created.id}`, entryBody(created, {}));
  check("entry restored after the warning checks", r.status === 200 && r.body.inwardNo === 1 && r.body.finish === "S2G" && r.body.warnings.length === 0, JSON.stringify(r.body));
  await expectErrors("bad register month", { registerMonth: "Oct" }, "Register month");
  await expectErrors("over-dispatch", { dispatches: [{ qty: 30, gatePass: "1", date: "2026-11-03" }] }, "more than NAG + TWO PART");
  await expectErrors("dispatch before inward date", { dispatches: [{ qty: 5, gatePass: "1", date: "2026-11-01" }] }, "before the inward date");
  await expectErrors("dispatch without gate pass", { dispatches: [{ qty: 5, gatePass: " ", date: "2026-11-03" }] }, "gate pass");
  await expectErrors("dispatch without quantity", { dispatches: [{ qty: null, gatePass: "9", date: "2026-11-03" }] }, "JAWAK NAG must be 1");
  await expectErrors("dispatch bad date", { dispatches: [{ qty: 5, gatePass: "9", date: "x" }] }, "valid date");

  // Dispatches: partial, full, and more than three lines.
  r = await call("POST", "/api/entries", {
    ...base, inwardNo: 3, than: 40, tp: 0, twoPart: 0,
    dispatches: [{ qty: 10, gatePass: "501", date: "2026-11-03" }, { qty: 10, gatePass: "502", date: "2026-11-04" }],
  });
  check("partial dispatch saved", r.status === 200 && r.body.status === "partial" && r.body.balance === 20, JSON.stringify(r.body));
  const partial = r.body;
  r = await call("PUT", `/api/entries/${partial.id}`, {
    ...base, inwardNo: 3, than: 40, tp: 0, twoPart: 0,
    dispatches: [1, 2, 3, 4].map((i) => ({ qty: 10, gatePass: `50${i}`, date: "2026-11-05" })),
  });
  check("four dispatches accepted, fully dispatched", r.status === 200 && r.body.status === "done" && r.body.dispatches.length === 4 && r.body.balance === 0, JSON.stringify(r.body));
  check("edit keeps the same record", r.body?.id === partial.id);
  r = await call("PUT", `/api/entries/${partial.id}`, { ...base, inwardNo: 1, than: 40 });
  check("edit cannot take another entry's number", r.status === 400);
  r = await call("PUT", `/api/entries/${partial.id}`, { ...base, inwardNo: 3, than: 40, dispatches: [] });
  check("removing dispatches works", r.status === 200 && r.body.dispatches.length === 0 && r.body.status === "pending");
  r = await call("PUT", "/api/entries/999999", { ...base, inwardNo: 50 });
  check("edit of missing entry returns 404", r.status === 404);

  // Correcting an imported October row keeps it in October with its source row.
  const october = (await call("GET", "/api/entries?month=2026-10")).body;
  const imported = october.find((e) => e.inwardNo === 337 && e.designNo === "12409");
  check("found imported row 12409", Boolean(imported));
  r = await call("PUT", `/api/entries/${imported.id}`, {
    registerMonth: imported.registerMonth, inwardNo: imported.inwardNo, entryDate: imported.entryDate, party: imported.party,
    designNo: "13409", lotNo: imported.lotNo, repair: imported.repair, than: imported.than, tp: imported.tp,
    twoPart: imported.twoPart, finish: imported.finish, shortThan: imported.shortThan,
    dispatches: imported.dispatches.map((d) => ({ qty: d.qty, gatePass: d.gatePass, date: d.date })),
  });
  check("correct imported design number", r.status === 200 && r.body.designNo === "13409" && r.body.sourceRow === imported.sourceRow && r.body.registerMonth === "2026-10", JSON.stringify(r.body));

  // Carryover rows share inward numbers with regular rows but must stay editable.
  const carry = october.find((e) => e.carriedOver && e.inwardNo === 729);
  r = await call("PUT", `/api/entries/${carry.id}`, {
    registerMonth: carry.registerMonth, inwardNo: carry.inwardNo, entryDate: carry.entryDate, party: carry.party,
    designNo: carry.designNo, lotNo: "77-checked", repair: carry.repair, than: carry.than, tp: carry.tp, twoPart: carry.twoPart,
    finish: carry.finish, shortThan: carry.shortThan, dispatches: carry.dispatches.map((d) => ({ qty: d.qty, gatePass: d.gatePass, date: d.date })),
  });
  check("carryover editable despite shared number", r.status === 200 && r.body.lotNo === "77-checked", JSON.stringify(r.body));

  // Imported row with a text dispatch date must be corrected before saving.
  const textDate = october.find((e) => e.dispatches.some((d) => d.dateText === "26-110"));
  check("text date kept and flagged", Boolean(textDate) && textDate.warnings.some((w) => w.includes("26-110")));
  r = await call("PUT", `/api/entries/${textDate.id}`, {
    registerMonth: textDate.registerMonth, inwardNo: textDate.inwardNo, entryDate: textDate.entryDate, party: textDate.party,
    designNo: textDate.designNo, lotNo: textDate.lotNo, repair: textDate.repair, than: textDate.than, tp: textDate.tp,
    twoPart: textDate.twoPart, finish: textDate.finish, shortThan: textDate.shortThan,
    dispatches: textDate.dispatches.map((d) => ({ qty: d.qty, gatePass: d.gatePass, date: d.date })),
  });
  check("saving needs the text date fixed", r.status === 400 && r.body.errors.join(" ").includes("valid date"), JSON.stringify(r.body));

  // All-zero slips: the THAN were entered and billed in the earlier register; the slip is kept only for its number.
  const zeros = october.filter((e) => e.status === "allZero");
  check("imported all-zero slips are marked, not warned", zeros.length === 2 && zeros.every((e) => e.than === 0 && e.finish === "" && e.warnings.length === 0), JSON.stringify(zeros.map((e) => [e.inwardNo, e.warnings])));
  const zero = zeros[0];
  const zeroBody = (extra) => ({
    registerMonth: zero.registerMonth, inwardNo: zero.inwardNo, entryDate: zero.entryDate, party: zero.party, designNo: `${zero.designNo} checked`,
    lotNo: zero.lotNo, repair: zero.repair, than: 0, tp: 0, twoPart: 0, finish: "", shortThan: null, dispatches: [], ...extra,
  });
  r = await call("PUT", `/api/entries/${zero.id}`, zeroBody({}));
  check("all-zero slip editable without a finish", r.status === 200 && r.body.status === "allZero" && r.body.designNo.endsWith(" checked"), JSON.stringify(r.body));
  r = await call("PUT", `/api/entries/${zero.id}`, zeroBody({ dispatches: [{ qty: 1, gatePass: "1", date: zero.entryDate }] }));
  check("with a dispatch it needs THAN again (the finish may stay blank)", r.status === 400 && r.body.errors.join(" ").includes("more than 0") && !r.body.errors.join(" ").includes("finish"), JSON.stringify(r.body));

  // Recent list shows only entries typed in the app, newest first.
  const recent = (await call("GET", "/api/entries/recent")).body;
  check("recent list excludes imported rows", recent.every((e) => !e.imported) && recent.length === 3);
  check("recent list newest first", recent[0].inwardNo === 3 || recent[0].id > recent[1].id);

  // Security: writes need the app header; other hosts are refused.
  r = await call("POST", "/api/entries", { ...base, inwardNo: 77 }, {});
  check("write without app header blocked", r.status === 403);
  r = await call("PUT", "/api/settings", { display: { theme: "dark" } }, {});
  check("settings change without app header blocked", r.status === 403);
  const months = (await call("GET", "/api/months")).body;
  check("months list", months.length === 2 && months.some((m) => m.month === "2026-11" && m.entries === 3), JSON.stringify(months));

  // Script-like text is stored and returned as plain data.
  r = await call("POST", "/api/entries", { ...base, inwardNo: 4, designNo: "<img src=x onerror=alert(1)>" });
  check("unusual text stored literally", r.status === 200 && r.body.designNo === "<img src=x onerror=alert(1)>");

  const after = (await call("GET", "/api/info")).body.entries;
  check("entry count increased by exactly 4", after === before + 4, `${before} -> ${after}`);

  console.log(`PASSED ${passed}`);
  if (failures.length) {
    console.log(`FAILED ${failures.length}`);
    failures.forEach((f) => console.log("  " + f));
    process.exit(1);
  }
  console.log("PASS: all entry, edit, dispatch, validation and security checks");
})();
