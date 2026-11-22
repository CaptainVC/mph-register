// Restart the smoke server on 5152 and dry-run the bill import.
const fs = require("fs");
const r = JSON.parse(fs.readFileSync("/tmp/mph-billimport.json"));
if (!r.bills) { console.log(r); process.exit(); }
console.log("invoices", r.invoices, "total", r.total, "linked entries", r.linkedEntries, "errors", r.errors.length,
  "warnings", r.warnings.length, "unmatched lines", r.unmatchedLines.length, "leftovers", r.leftovers.length);
r.errors.slice(0, 15).forEach((e) => console.log(" ERR", e));
r.warnings.forEach((w) => console.log(" WARN", w));
const mism = r.bills.filter((b) => b.sheetTotal !== b.appTotal || b.problems.length);
console.log("bills with problems:", mism.length);
mism.forEach((b) => console.log(" ", b.invoiceNo, b.party, b.problems.join("; ")));
const byParty = {};
r.unmatchedLines.forEach((l) => (byParty[l.party] = (byParty[l.party] || 0) + 1));
console.log("unmatched by party", byParty);
const lo = {};
r.leftovers.forEach((l) => (lo[l.party] = (lo[l.party] || []).concat(`${l.inwardNo}:${l.dispatchState}`)));
for (const [k, v] of Object.entries(lo)) console.log(" leftover", k, v.length, v.slice(0, 14).join(" "));
