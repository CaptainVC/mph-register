import os, pathlib, sys
import json, re
import openpyxl
from openpyxl.utils import get_column_letter

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from mph_lib import find_workbooks  # noqa: E402

WORKBOOKS = find_workbooks()
PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(WORKBOOKS, "MPH BILL--OCT.-26-27.xlsm")
wf = openpyxl.load_workbook(PATH, data_only=False)
wv = openpyxl.load_workbook(PATH, data_only=True)
ws, vs = wf["Main"], wv["Main"]

def norm_formula(f, r0, c0):
    """Replace absolute coordinates with block-relative ones so template deviations stand out."""
    if not isinstance(f, str) or not f.startswith("="):
        return f
    def sub(m):
        col, row = m.group(1), int(m.group(2))
        if col.startswith("$") or "Details" in f[max(0, m.start() - 12):m.start()]:
            return m.group(0)
        ci = openpyxl.utils.column_index_from_string(col) - c0
        return f"c{ci}r{row - r0}"
    return re.sub(r"(?<![A-Za-z!$])(\$?[A-Z]{1,2})(\d+)", sub, f)

invoices = []
template = {}
for panel in range(4):
    c0 = 1 + panel * 7
    for k in range(25):
        r0 = 1 + k * 49
        cell = lambda dr, dc, r0=r0, c0=c0: ws.cell(r0 + dr, c0 + dc)
        val = lambda dr, dc, r0=r0, c0=c0: vs.cell(r0 + dr, c0 + dc).value
        inv = {
            "panel": panel, "block": k, "row": r0, "col": get_column_letter(c0),
            "party": val(7, 0), "invoiceNo": val(6, 5), "invoiceNoF": cell(6, 5).value,
            "date": val(7, 5), "dateF": cell(7, 5).value, "periodLabel": val(9, 3), "period": val(9, 5), "periodF": cell(9, 5).value,
            "addr1": val(8, 0), "addr2": val(9, 0), "gstin": val(10, 0),
            "gross": val(37, 6), "discount": val(38, 6), "taxable": val(39, 6),
            "tax1Label": val(40, 3), "tax1Rate": val(40, 5), "tax1": val(40, 6),
            "tax2Label": val(41, 3), "tax2Rate": val(41, 5), "tax2": val(41, 6),
            "total": val(42, 6), "words": val(42, 0), "wordsF": cell(42, 0).value,
            "lines": [], "deviations": [],
        }
        for i in range(25):
            dr = 12 + i
            row = {"pos": i + 1, "sheetRow": r0 + dr}
            for j, name in enumerate(["gpn", "dn", "lot", "finish", "than", "rate", "amount"]):
                row[name] = val(dr, j)
                row[name + "F"] = cell(dr, j).value if isinstance(cell(dr, j).value, str) and str(cell(dr, j).value).startswith("=") else None
            inv["lines"].append(row)
        # formula signatures, compared against block 0 of panel 0 as the template
        sig = {}
        for dr in range(0, 49):
            for dc in range(7):
                f = cell(dr, dc).value
                if isinstance(f, str) and f.startswith("="):
                    sig[(dr, dc)] = norm_formula(f, r0, c0)
        if panel == 0 and k == 0:
            template = sig
        else:
            for key, f in sig.items():
                if key in template and template[key] != f:
                    inv["deviations"].append({"cell": f"{get_column_letter(c0 + key[1])}{r0 + key[0]}", "formula": cell(*key).value})
                elif key not in template:
                    inv["deviations"].append({"cell": f"{get_column_letter(c0 + key[1])}{r0 + key[0]}", "formula": cell(*key).value, "extra": True})
            for key in template:
                if key not in sig:
                    v = cell(*key).value
                    inv["deviations"].append({"cell": f"{get_column_letter(c0 + key[1])}{r0 + key[0]}", "missingFormula": True, "value": v})
        invoices.append(inv)

json.dump(invoices, open("/tmp/mph_bills.json", "w"), default=str, indent=1)
print("template formulas:")
for key, f in sorted(template.items()):
    print(" ", key, f[:400])
