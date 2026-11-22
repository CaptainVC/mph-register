"""Independent check: compare every inward workbook cell with what the app stores and returns."""
import hashlib
import json
import sqlite3
import sys
import urllib.request
from datetime import datetime

from openpyxl import load_workbook

WORKBOOK = sys.argv[1]
DATABASE = sys.argv[2]
BASE = "http://127.0.0.1:5152"


def api(path):
    with urllib.request.urlopen(BASE + path) as response:
        return json.load(response)


def text(value):
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def num(value):
    return int(value) if isinstance(value, (int, float)) else 0


sheet = load_workbook(WORKBOOK, data_only=True)["Main"]
headers = {str(c.value).strip().upper(): c.column for c in sheet[1] if c.value is not None}
rows = [r for r in range(2, sheet.max_row + 1) if text(sheet.cell(r, headers["PARTY"]).value)]
api_entries = {e["sourceRow"]: e for e in api("/api/entries?month=2026-10")}
failures = []
checked = 0


def check(row, field, expected, actual):
    global checked
    checked += 1
    if expected != actual:
        failures.append(f"row {row} {field}: workbook={expected!r} app={actual!r}")


last_regular = max(r for r in rows if r < 985)
for r in rows:
    cell = lambda name, r=r: sheet.cell(r, headers[name]).value
    entry = api_entries.get(r)
    if entry is None:
        failures.append(f"row {r}: missing from app")
        continue
    check(r, "INW. NO.", num(cell("INW. NO.")), entry["inwardNo"])
    check(r, "DATE", text(cell("DATE")), entry["entryDate"])
    check(r, "PARTY", text(cell("PARTY")), entry["party"])
    check(r, "D.N.", text(cell("D.N.")), entry["designNo"])
    check(r, "LOT N.", text(cell("LOT N.")), entry["lotNo"])
    check(r, "REP.", text(cell("REP.")) == "Yes", entry["repair"])
    check(r, "THAN", num(cell("THAN")), entry["than"])
    check(r, "TP", num(cell("TP")), entry["tp"])
    check(r, "NAG (sheet vs app)", num(cell("NAG")), entry["nag"])
    check(r, "FINISH", text(cell("FINISH")), entry["finish"])
    check(r, "NETT THAN (sheet vs app)", num(cell("NETT THAN")), entry["nettThan"])
    check(r, "TWO PART", num(cell("TWO PART")), entry["twoPart"])
    short = cell("SHORT THAN")
    check(r, "SHORT THAN", None if short is None else num(short), entry["shortThan"])
    check(r, "carryover flag", r > last_regular + 1, entry["carriedOver"])
    expected_dispatches = []
    for i in (1, 2, 3):
        qty, gate, date = cell(f"JAWAK NAG {i}"), cell(f"GATE PASS NO {i}"), cell(f"DATE {i}")
        if qty is None and gate is None and date is None:
            continue
        expected_dispatches.append({
            "qty": num(qty),
            "gatePass": text(gate),
            "date": text(date) if isinstance(date, datetime) else None,
            "dateText": None if isinstance(date, datetime) or date is None else text(date),
        })
    check(r, "dispatches", expected_dispatches, entry["dispatches"])
    available = num(cell("NAG")) + num(cell("TWO PART"))
    dispatched = sum(d["qty"] for d in expected_dispatches)
    check(r, "balance", available - dispatched, entry["balance"])
    # An all-zero slip: its THAN were entered and billed in the earlier register.
    all_zero = num(cell("THAN")) == num(cell("TP")) == num(cell("TWO PART")) == 0 and not expected_dispatches
    expected_status = ("allZero" if all_zero else "over" if dispatched > available
                       else "pending" if available > 0 and dispatched == 0
                       else "partial" if available > dispatched else "done")
    check(r, "status colour", expected_status, entry["status"])

check(0, "entry count", len(rows), len(api_entries))

# Database-level checks, independent of the API.
db = sqlite3.connect(f"file:{DATABASE}?mode=ro", uri=True)
check(0, "integrity_check", "ok", db.execute("PRAGMA integrity_check").fetchone()[0])
check(0, "foreign keys", [], db.execute("PRAGMA foreign_key_check").fetchall())
check(0, "db entries", len(rows), db.execute("SELECT COUNT(*) FROM entries").fetchone()[0])
check(0, "db dispatches", sum(len(e["dispatches"]) for e in api_entries.values()),
      db.execute("SELECT COUNT(*) FROM dispatches").fetchone()[0])
orphans = db.execute("SELECT COUNT(*) FROM dispatches d LEFT JOIN entries e ON e.id = d.entry_id WHERE e.id IS NULL").fetchone()[0]
check(0, "orphan dispatches", 0, orphans)
stored_hash = db.execute("SELECT sha256 FROM import_batches").fetchone()[0]
check(0, "import file hash", hashlib.sha256(open(WORKBOOK, "rb").read()).hexdigest().upper(), stored_hash)

totals = {
    "THAN": sum(num(sheet.cell(r, headers["THAN"]).value) for r in rows),
    "NETT THAN": sum(num(sheet.cell(r, headers["NETT THAN"]).value) for r in rows),
    "JAWAK": sum(num(sheet.cell(r, headers[f"JAWAK NAG {i}"]).value) for r in rows for i in (1, 2, 3)),
}
app_totals = {
    "THAN": sum(e["than"] for e in api_entries.values()),
    "NETT THAN": sum(e["nettThan"] for e in api_entries.values()),
    "JAWAK": sum(e["dispatched"] for e in api_entries.values()),
}
check(0, "totals", totals, app_totals)

print(f"CHECKED {checked} values across {len(rows)} rows")
print(f"TOTALS workbook={totals} app={app_totals}")
if failures:
    print(f"FAILURES {len(failures)}")
    for failure in failures[:40]:
        print("  " + failure)
    sys.exit(1)
print("PASS: every workbook value matches the app exactly")
