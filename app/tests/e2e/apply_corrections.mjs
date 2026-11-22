// Applies the confirmed corrections to imported entries through the app's own API. They hold real names, so they live next
// to the workbooks (the "corrections" file of Workbooks/private-test-data.json, see private-data.js), never in git.
// Usage: node apply_corrections.mjs [corrections.json]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { load } = createRequire(import.meta.url)("./private-data.js");
const { corrections: correctionsFile } = load();
const CORRECTIONS = process.argv[2] || correctionsFile;
const BASE = process.env.BASE || "http://127.0.0.1:5152";
const H = { "X-MPH-Request": "1", "Content-Type": "application/json" };

(async () => {
  const corrections = JSON.parse(readFileSync(CORRECTIONS, "utf8"));
  for (const c of corrections) {
    const entries = await (await fetch(`${BASE}/api/entries?month=${c.month}`)).json();
    const matches = entries.filter((e) => e.inwardNo === c.inwardNo && !e.carriedOver && e.party === c.party);
    if (matches.length !== 1) throw new Error(`${c.month} INW ${c.inwardNo}: expected one entry of ${c.party}, found ${matches.length}`);
    const e = matches[0];
    if (e.dispatches.some((d) => !d.date)) throw new Error(`${c.month} INW ${c.inwardNo}: a dispatch date is not a real date; fix it first`);
    const body = {
      registerMonth: e.registerMonth, inwardNo: e.inwardNo, entryDate: e.entryDate, party: c.movedTo, designNo: e.designNo, lotNo: e.lotNo,
      repair: e.repair, than: e.than, tp: e.tp, twoPart: e.twoPart, finish: e.finish, shortThan: e.shortThan,
      dispatches: e.dispatches.map((d) => ({ qty: d.qty, gatePass: d.gatePass, date: d.date })),
    };
    const r = await fetch(`${BASE}/api/entries/${e.id}`, { method: "PUT", headers: H, body: JSON.stringify(body) });
    const saved = await r.json();
    if (!r.ok) throw new Error(`${c.month} INW ${c.inwardNo}: ${JSON.stringify(saved)}`);
    console.log(`  corrected ${c.month} INW ${c.inwardNo}: ${c.party} -> ${saved.party} (${saved.than} THAN ${saved.finish}, lot ${saved.lotNo})`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
