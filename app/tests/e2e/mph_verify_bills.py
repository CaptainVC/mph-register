import json, re, sys, urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5152"
sheet = [b for b in json.load(open("/tmp/mph_bills.json")) if b["party"]]
get = lambda p: json.load(urllib.request.urlopen(BASE + p))
app = {i["invoiceNo"]: get(f"/api/invoices/{i['id']}") for i in get("/api/invoices")}

def text(v):
    if v is None: return ""
    if isinstance(v, float) and v.is_integer(): v = int(v)
    return re.sub(r"\s+", " ", str(v)).strip()

def iso(dot):
    d, m, y = text(dot).split(".")
    return f"20{y}-{m}-{d}"

# Exact port of the bill workbook's RupeeFormat VBA (matches all 139 cached Excel texts in the April-September workbooks).
PLACES = ["", "", " Thousand ", " Lakh ", " Crores ", " Trillion ", "", "", "", ""]
def get_d(s):
    a = [" One", " Two", " Three", " Four", " Five", " Six", " Seven", " Eight", " Nine", ""]
    v = int(s) if s.strip().isdigit() else 0
    return a[v - 1] if v > 0 else ""
def get_t(s):
    t1 = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
    t2 = ["", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]
    first = int(s[0]) if s[:1].isdigit() else 0
    if first == 1:
        return t1[int(s[1]) if len(s) > 1 and s[1].isdigit() else 0]
    return (t2[first - 1] if first > 0 else "") + get_d(s[-1])
def get_h(s, lp):
    if (int(s) if s.isdigit() else 0) < 1: return ""
    s = ("000" + s)[-3:]
    r = get_d(s[0]) + (" Lakh " if lp > 0 else " Hundred ") if s[0] != "0" else ""
    return r + (get_t(s[1:]) if s[1] != "0" else get_d(s[2]))
def rupee(n):
    num, out, lp, f = str(int(n)), "", 0, 1
    while num != "":
        t = num[-2:] if f >= 2 or len(num) <= 2 else num[-3:]
        v, st = int(t), ""
        if v > 99:
            st = get_h(t[-3:], lp); lp += 1
        elif v > 9: st = get_t(t[-2:])
        else: st = get_d(t[-2:])
        if st != "": out = st + PLACES[f] + out
        if f == 2: num = "" if len(num) == 1 else num[:-2]
        elif f == 3: num = num[:-2] if len(num) >= 3 else ""
        elif f == 4: num = ""
        else: num = "" if len(num) <= 2 else num[:-3]
        f += 1
    return ("No Rupees" if out == "" else " Rupees " + out) + " Only"

checked = 0
problems = []
def same(label, a, b):
    global checked
    checked += 1
    if a != b:
        problems.append(f"{label}: sheet={a!r} app={b!r}")

for b in sheet:
    no = b["invoiceNo"]
    d = app.get(no)
    if d is None:
        problems.append(f"{no}: missing in app")
        continue
    same(f"{no} party", text(b["party"]), d["partyName"])
    same(f"{no} address", text(b["addr1"]), d["address"])
    same(f"{no} state", text(b["addr2"]), d["state"])
    same(f"{no} gstin", re.sub(r"^GSTIN:\s*", "", text(b["gstin"])), d["gstin"])
    same(f"{no} date", iso(b["date"]), d["billDate"])
    f, t = re.split(r"\s+TO\s+", text(b["period"]))
    same(f"{no} period", (iso(f), iso(t)), (d["periodFrom"], d["periodTo"]))
    for key, sheet_key in [("gross", "gross"), ("discount", "discount"), ("taxable", "taxable"), ("cgst", "tax1"), ("sgst", "tax2"), ("total", "total")]:
        same(f"{no} {key}", int(b[sheet_key]), d[key])
    same(f"{no} cgst rate", float(b["tax1Rate"]) * 100, float(d["cgstRate"]))
    same(f"{no} sgst rate", float(b["tax2Rate"]) * 100, float(d["sgstRate"]))
    lines = d["lines"]
    for pos, sl in enumerate(b["lines"]):
        al = lines[pos] if pos < len(lines) else {"kind": "blank", "gpn": "", "dn": "", "lot": "", "finish": "", "qty": None, "rate": None, "amount": None}
        tag = f"{no} row {pos + 1}"
        same(f"{tag} G.P.N.", text(sl["gpn"]), al["gpn"] or "")
        same(f"{tag} D.N.", text(sl["dn"]), al["dn"] or "")
        same(f"{tag} LOT", text(sl["lot"]), al["lot"] or "")
        same(f"{tag} FINISH", text(sl["finish"]), al["finish"] or "")
        same(f"{tag} THAN", int(sl["than"]) if sl["than"] not in (None, "") else None, al["qty"] if al["kind"] != "blank" else None)
        if sl["finish"]:
            same(f"{tag} RATE", float(sl["rate"]) if sl["rate"] is not None else None, float(al["rate"]) if al["rate"] is not None else None)
            same(f"{tag} AMOUNT", int(sl["amount"]) if sl["amount"] is not None else None, al["amount"])
    cached = b.get("words")
    expected = cached if isinstance(cached, str) and not cached.startswith("#") else rupee(b["total"])
    same(f"{no} words (exact Excel text)", expected, d["amountInWords"])

print(f"CHECKED {checked} values across {len(sheet)} bills")
print(f"APP BILLS {len(app)}  SHEET BILLS {len(sheet)}")
if problems:
    print(f"FAILED {len(problems)}")
    for p in problems[:40]: print("  " + p)
    sys.exit(1)
print("PASS: every bill value matches the workbook exactly")
