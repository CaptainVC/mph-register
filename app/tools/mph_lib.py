"""Shared read-only readers for MPH inward and bill workbooks."""
import re, warnings
import openpyxl
warnings.filterwarnings("ignore")

def norm(s):
    return re.sub(r"\s+", " ", str(s if s is not None else "")).strip()

def key(s):
    return norm(s).upper()

def read_inward(path):
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    ws = wb["Main"]
    rows = list(ws.iter_rows(values_only=True, max_col=30))
    hdr = [norm(h) for h in rows[0]]
    col = {h: i for i, h in enumerate(hdr) if h and h not in col_seen(hdr, i)}
    def g(r, h):
        i = col.get(h)
        return r[i] if i is not None and i < len(r) else None
    out = []
    blank_after_data = False
    for n, r in enumerate(rows[1:], start=2):
        party = g(r, "PARTY")
        if party in (None, "") or norm(party) == "":
            if out:
                blank_after_data = True
            stray = [h for h in ("D.N.", "LOT N.", "THAN", "TP", "FINISH", "TWO PART", "JAWAK NAG 1", "GATE PASS NO 1", "DATE 1") if g(r, h) not in (None, "")]
            if stray:
                out.append({"row": n, "stray": stray, "raw": [g(r, h) for h in stray]})
            continue
        disp = []
        for k in (1, 2, 3):
            q, gp, d = g(r, f"JAWAK NAG {k}"), g(r, f"GATE PASS NO {k}"), g(r, f"DATE {k}")
            if q in (None, "") and gp in (None, "") and d in (None, ""):
                continue
            disp.append({"k": k, "qty": q, "gp": gp, "date": d})
        out.append({
            "row": n, "inw": g(r, "INW. NO."), "date": g(r, "DATE"), "party": party, "dn": g(r, "D.N."), "lot": g(r, "LOT N."),
            "rep": g(r, "REP."), "than": g(r, "THAN"), "tp": g(r, "TP"), "nag": g(r, "NAG"), "finish": g(r, "FINISH"),
            "nett": g(r, "NETT THAN"), "two": g(r, "TWO PART"), "disp": disp, "short": g(r, "SHORT THAN"),
            "carry": blank_after_data,
        })
    details = []
    if "Details" in wb.sheetnames:
        d = wb["Details"]
        drows = list(d.iter_rows(values_only=True, max_col=15))
        for r in drows[6:]:
            if r[0]:
                details.append(("party", norm(r[0]), r[1]))
            if len(r) > 10 and r[8]:
                details.append(("finish", norm(r[8]), r[9], norm(r[10])))
    stock = []
    if "Stock" in wb.sheetnames:
        for n, r in enumerate(wb["Stock"].iter_rows(values_only=True, max_col=25), start=1):
            if n > 1 and r[2] not in (None, ""):
                stock.append({"row": n, "inw": r[0], "date": r[1], "party": r[2], "dn": r[3], "lot": r[4], "than": r[6], "finish": r[9]})
    wb.close()
    return {"header": hdr, "entries": [e for e in out if "stray" not in e], "stray": [e for e in out if "stray" in e], "details": details, "stock": stock}

def col_seen(hdr, i):
    return set(hdr[:i])

def read_bills(path, with_formulas=False):
    wv = openpyxl.load_workbook(path, data_only=True)
    wf = openpyxl.load_workbook(path, data_only=False) if with_formulas else None
    vs = wv["Main"]
    fs = wf["Main"] if wf else None
    bills = []
    for panel in range(4):
        c0 = 1 + panel * 7
        for k in range(25):
            r0 = 1 + k * 49
            v = lambda dr, dc, r0=r0, c0=c0: vs.cell(r0 + dr, c0 + dc).value
            f = lambda dr, dc, r0=r0, c0=c0: fs.cell(r0 + dr, c0 + dc).value if fs else None
            if v(7, 0) in (None, ""):
                continue
            lines = []
            for i in range(25):
                dr = 12 + i
                lines.append({"pos": i + 1, "gpn": v(dr, 0), "dn": v(dr, 1), "lot": v(dr, 2), "finish": v(dr, 3), "than": v(dr, 4),
                              "rate": v(dr, 5), "amount": v(dr, 6), "thanF": f(dr, 4), "rateF": f(dr, 5)})
            bills.append({
                "panel": panel, "block": k, "cell": f"{openpyxl.utils.get_column_letter(c0)}{r0}",
                "no": v(6, 5), "party": v(7, 0), "date": v(7, 5), "period": v(9, 5), "addr1": v(8, 0), "addr2": v(9, 0), "gstin": v(10, 0),
                "gross": v(37, 6), "discount": v(38, 6), "taxable": v(39, 6), "t1label": v(40, 3), "t1rate": v(40, 5), "t1": v(40, 6),
                "t2label": v(41, 3), "t2rate": v(41, 5), "t2": v(41, 6), "total": v(42, 6), "words": v(42, 0), "lines": lines,
                "noF": f(6, 5), "discountF": f(38, 6),
            })
    details = []
    if "Details" in wv.sheetnames:
        d = wv["Details"]
        hdr = [d.cell(6, c).value for c in range(1, 33)]
        for r in range(7, d.max_row + 1):
            name = d.cell(r, 1).value
            if name:
                details.append({str(hdr[c - 1]): d.cell(r, c).value for c in range(1, 33) if hdr[c - 1]})
    return {"bills": bills, "details": details}
