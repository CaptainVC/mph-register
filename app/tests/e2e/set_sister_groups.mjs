// Gives parties a sister-firm group through the app's own API, so the bill import links a bill of one firm to the inward
// entries of the other. The groups hold real names, so they live next to the workbooks (the "sisterGroups" file of
// Workbooks/private-test-data.json, see private-data.js), never in git. Usage: node set_sister_groups.mjs [groups.json]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { load } = createRequire(import.meta.url)("./private-data.js");
const { sisterGroups } = load();
const GROUPS = process.argv[2] || sisterGroups;
const BASE = process.env.BASE || "http://127.0.0.1:5152";
const H = { "X-MPH-Request": "1", "Content-Type": "application/json" };
const FIELDS = ["name", "active", "address", "state", "gstin", "discount", "color", "billingStyle", "billBeforeDispatch", "billAs"];

(async () => {
  const groups = JSON.parse(readFileSync(GROUPS, "utf8"));
  const parties = (await (await fetch(`${BASE}/api/masters/full`)).json()).parties;
  for (const g of groups) {
    for (const name of g.parties) {
      const p = parties.find((x) => x.name.toUpperCase() === name.toUpperCase());
      if (!p) throw new Error(`Party ${name} is not in the party list`);
      const body = Object.fromEntries(FIELDS.map((f) => [f, p[f]]));
      const r = await fetch(`${BASE}/api/masters/party`, { method: "POST", headers: H, body: JSON.stringify({ ...body, originalName: p.name, sisterGroup: g.group }) });
      const saved = await r.json();
      if (!r.ok) throw new Error(`${name}: ${JSON.stringify(saved)}`);
      console.log(`  sister group ${saved.sisterGroup}: ${saved.name}`);
    }
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
