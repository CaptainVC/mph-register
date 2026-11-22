"""Deep check after importing every month: every Excel bill value, carryovers merged (never duplicated), totals per month.

Usage: python verify_history.py <mph-data.db> <Workbooks/History folder> <Workbooks folder> [corrections.json]
Corrections are confirmed changes to the registers, e.g. an entry moved to another party. They hold real names, so they
live next to the workbooks: by default the "corrections" file of Workbooks/private-test-data.json (see private-data.js).
Skipped when that private file is not on this machine.
"""
import datetime
import json
import os
import re
import sqlite3
import sys
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from mph_lib import read_bills, read_inward, key  # noqa: E402

WORKBOOKS = os.environ.get("MPH_WORKBOOKS") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "Workbooks"))
PRIVATE = os.environ.get("MPH_PRIVATE_TEST_DATA") or os.path.join(WORKBOOKS, "private-test-data.json")
if not os.path.exists(PRIVATE):
    print(f"SKIPPED: {PRIVATE} is not on this machine (the real-workbook suites need it).")
    sys.exit(0)
with open(PRIVATE, encoding="utf-8") as fh:
    CORRECTIONS_FILE = os.path.join(WORKBOOKS, json.load(fh).get("corrections", "history-corrections.json"))
DB, BACKUP, MAIN = sys.argv[1:4]
with open(sys.argv[4] if len(sys.argv) > 4 else CORRECTIONS_FILE, encoding="utf-8") as fh:
    CORRECTIONS = json.load(fh)
BASE = os.environ.get("BASE", "http://127.0.0.1:5152")
MONTHS = ["APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT"]
get = lambda p: json.load(urllib.request.urlopen(BASE + p))
problems, checked = [], 0
UNBILLED_SHARE = 0.04


def same(label, a, b):
    global checked
    checked += 1
    if a != b:
        problems.append(f"{label}: sheet={a!r} app={b!r}")


def text(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return re.sub(r"\s+", " ", str(v)).strip()


def dot(v):
    if hasattr(v, "strftime"):
        return v.strftime("%Y-%m-%d")
    d, m, y = text(v).split(".")
    return f"20{y[-2:]}-{m}-{d}"


app = {i["invoiceNo"]: i for i in get("/api/invoices")}
docs = {}
sheet_count = 0
for m in MONTHS:
    path = os.path.join(MAIN if m == "OCT" else os.path.join(BACKUP, "Bills"), f"MPH BILL--{m}.-26-27.xlsm")
    for b in read_bills(path)["bills"]:
        sheet_count += 1
        no = text(b["no"])
        summary = app.get(no)
        if summary is None:
            problems.append(f"{no}: missing in app")
            continue
        d = docs[no] = get(f"/api/invoices/{summary['id']}")
        same(f"{no} party", text(b["party"]), d["partyName"])
        same(f"{no} date", dot(b["date"]), d["billDate"])
        for k, sk in [("gross", "gross"), ("discount", "discount"), ("taxable", "taxable"), ("cgst", "t1"), ("sgst", "t2"), ("total", "total")]:
            same(f"{no} {k}", int(round(float(b[sk] or 0))), d[k])
        lines = d["lines"]
        for pos, sl in enumerate(b["lines"]):
            al = lines[pos] if pos < len(lines) else {"kind": "blank", "gpn": "", "dn": "", "lot": "", "finish": "", "qty": None, "rate": None, "amount": None}
            tag = f"{no} row {pos + 1}"
            for f, sf in [("gpn", "gpn"), ("dn", "dn"), ("lot", "lot"), ("finish", "finish")]:
                same(f"{tag} {f}", text(sl[sf]), al[f] or "")
            same(f"{tag} THAN", int(round(float(sl["than"]))) if sl["than"] not in (None, "") else None, al["qty"] if al["kind"] != "blank" else None)
            if text(sl["finish"]):
                same(f"{tag} amount", int(round(float(sl["amount"]))) if sl["amount"] not in (None, "") else None, al["amount"])
        words = b["words"]
        if isinstance(words, str) and not words.startswith("#"):
            same(f"{no} words", words, d["amountInWords"])

db = sqlite3.connect(DB)
dups = db.execute("""
    SELECT party, entry_date, inward_no, COUNT(*), group_concat(register_month) FROM entries
    WHERE inward_no > 0 GROUP BY party COLLATE NOCASE, entry_date, inward_no HAVING COUNT(*) > 1""").fetchall()
# An entry split over the continuation bills of one party and month is fine; on bills of two months or parties it is billed twice.
twice = db.execute("""
    SELECT ie.entry_id, COUNT(DISTINCT i.bill_month || '|' || i.party) FROM invoice_entries ie JOIN invoices i ON i.id = ie.invoice_id
    WHERE i.status = 'saved' GROUP BY ie.entry_id HAVING COUNT(DISTINCT i.bill_month || '|' || i.party) > 1""").fetchall()
per_month = db.execute("SELECT bill_month, COUNT(*), SUM(total) FROM invoices GROUP BY bill_month ORDER BY bill_month").fetchall()
entries = db.execute("SELECT register_month, COUNT(*), SUM(carried_over), SUM(than) FROM entries GROUP BY register_month ORDER BY register_month").fetchall()
linked = db.execute("SELECT COUNT(DISTINCT entry_id) FROM invoice_entries").fetchone()[0]
unbilled = db.execute("""
    SELECT register_month, COUNT(*), SUM(than) FROM entries e WHERE repair = 0 AND than > 0
      AND NOT EXISTS (SELECT 1 FROM invoice_entries ie WHERE ie.entry_id = e.id)
      AND NOT EXISTS (SELECT 1 FROM billed_elsewhere b WHERE b.entry_id = e.id)
    GROUP BY register_month ORDER BY register_month""").fetchall()
received = dict(db.execute("SELECT register_month, SUM(than) FROM entries WHERE repair = 0 AND than > 0 GROUP BY register_month").fetchall())
unlinked_lines = db.execute("""
    SELECT COUNT(*) FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
    WHERE i.status = 'saved' AND l.kind <> 'blank' AND l.auto_sum = 0 AND COALESCE(l.qty, 0) > 0 AND l.entry_ids = '[]'""").fetchone()[0]

# The same inward slip must exist once, even though carryover rows repeat it in later registers.
sheet_slips = set()
for name in sorted(os.listdir(os.path.join(BACKUP, "Inwards"))):
    if not name.endswith(".xlsm"):
        continue
    path = os.path.join(MAIN, "INWARD REG.-OCT.-26-27.xlsm") if ".OCT." in name else os.path.join(BACKUP, "Inwards", name)
    for e in read_inward(path)["entries"]:
        if isinstance(e["inw"], (int, float)) and hasattr(e["date"], "strftime"):
            sheet_slips.add((key(e["party"]), e["date"].strftime("%Y-%m-%d"), int(e["inw"])))
if not os.path.exists(os.path.join(BACKUP, "Inwards", "INWARD REG.-OCT.-26-27.xlsm")):
    for e in read_inward(os.path.join(MAIN, "INWARD REG.-OCT.-26-27.xlsm"))["entries"]:
        if isinstance(e["inw"], (int, float)) and hasattr(e["date"], "strftime"):
            sheet_slips.add((key(e["party"]), e["date"].strftime("%Y-%m-%d"), int(e["inw"])))
app_slips = {(key(p), d, n) for p, d, n in db.execute("SELECT party, entry_date, inward_no FROM entries WHERE inward_no > 0")}
for c in CORRECTIONS:
    month_dates = {d for p, d, n in sheet_slips if p == key(c["party"]) and n == c["inwardNo"] and d[:7] in (c["month"], f"{c['month'][:5]}{int(c['month'][5:]) - 1:02d}")}
    for d in month_dates:
        sheet_slips.discard((key(c["party"]), d, c["inwardNo"]))
        sheet_slips.add((key(c["movedTo"]), d, c["inwardNo"]))
    print(f"correction applied to the workbook side: {c['month']} INW {c['inwardNo']} {c['party']} -> {c['movedTo']} ({len(month_dates)} slip)")

print(f"CHECKED {checked} bill values across {sheet_count} Excel bills ({len(app)} bills in the app)")
print("bills per month:", [(m, n, t) for m, n, t in per_month])
print("entries per register month (rows, carryovers kept as own entry, THAN):", entries)
# A carryover row whose date was mistyped (08.06 for 13.06) merges into its slip, which keeps the first month's date.
def same_slip_other_date(party, day, number):
    return any(p == party and n == number and abs((datetime.date.fromisoformat(d) - datetime.date.fromisoformat(day)).days) <= 20 for p, d, n in app_slips)


retyped = {s for s in sheet_slips - app_slips if same_slip_other_date(*s)}
missing = sheet_slips - app_slips - retyped
print(f"distinct inward slips: workbooks {len(sheet_slips)}, app {len(app_slips)}; missing {len(missing)}, extra {len(app_slips - sheet_slips)}, "
      f"carryover rows with another date merged into their slip {sorted(retyped)}")
print(f"entries linked to bills: {linked}; bill lines not linked (memo rows included): {unlinked_lines}; still unbilled per month:", unbilled)
# Every month up to the last bill workbook is billed in Excel: what stays unbilled is cloth still in the factory, samples and
# the few typing slips the bill and register disagree on, never more than a small share of the month.
for month, count, than in unbilled:
    if month <= "2026-09" and than > UNBILLED_SHARE * received[month]:
        problems.append(f"{month}: {count} entries ({than} THAN) still unbilled, more than {UNBILLED_SHARE:.0%} of the {received[month]} THAN received")
if dups:
    problems.append(f"{len(dups)} inward slips stored twice, e.g. {dups[:3]}")
if twice:
    problems.append(f"{len(twice)} entries on two saved bills, e.g. {twice[:3]}")
if missing:
    problems.append(f"slips missing in app, e.g. {sorted(missing)[:3]}")
if problems:
    print(f"FAILED {len(problems)}")
    for p in problems[:40]:
        print("  " + p)
    sys.exit(1)
print("PASS: all months imported; every bill value matches Excel; no inward slip duplicated; no entry billed twice")
