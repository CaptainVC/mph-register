"""Extract the Excel bill template (one 49-row block, A1:G49) into wwwroot/bill-template.json.

The app's print page draws bills from this file, so a printed or PDF bill has the same column widths, row heights,
merges, fonts, borders, fills, alignment and number formats as the bill printed from Excel. The file holds layout only:
every text on a bill (firm details, labels, terms) comes from the config file (mph-config.json) or the bill itself.
Per-cell styles are the most common style of that cell across all 100 bill blocks, so one-off manual formatting
on a single bill does not leak into the template. Colours that the workbook's VBA macros paint at run time
(party/finish font colours, THAN borders, the 2-lakh red fill) are applied by the print page, not stored here.

Usage: python make_bill_template.py "MPH BILL--OCT.-26-27.xlsm" ../src/MPHRegister.Api/wwwroot/bill-template.json
"""
import collections
import json
import sys
import zipfile
import xml.etree.ElementTree as ET

import openpyxl
from openpyxl.utils import get_column_letter

BLOCK_ROWS, BLOCK_COLS, PANELS, BLOCKS = 49, 7, 4, 25
FIRST_LINE_ROW, LINE_ROWS = 12, 25
NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
INDEXED = ["000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF"] * 2 + [
    "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080", "9999FF", "993366", "FFFFCC", "CCFFFF",
    "660066", "FF8080", "0066CC", "CCCCFF", "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
    "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99", "3366FF", "33CCCC", "99CC00", "FFCC00",
    "FF9900", "FF6600", "666699", "969696", "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333"]


def theme_colors(path):
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("xl/theme/theme1.xml"))
    scheme = root.find(".//a:clrScheme", NS)
    names = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"]
    out = []
    for name in names:
        node = scheme.find(f"a:{name}", NS)
        child = list(node)[0]
        out.append(child.get("lastClr") or child.get("val"))
    return out


def tinted(hex6, tint):
    if not tint:
        return hex6
    r, g, b = (int(hex6[i:i + 2], 16) for i in (0, 2, 4))
    def adj(c):
        return round(c * (1 + tint)) if tint < 0 else round(c + (255 - c) * tint)
    return "".join(f"{adj(c):02X}" for c in (r, g, b))


def color(c, theme):
    if c is None:
        return None
    try:
        if c.type == "rgb" and isinstance(c.rgb, str):
            return "#" + c.rgb[-6:].upper()
        if c.type == "theme":
            return "#" + tinted(theme[c.theme], c.tint).upper()
        if c.type == "indexed" and c.indexed is not None and c.indexed < len(INDEXED):
            return "#" + INDEXED[c.indexed]
    except (TypeError, IndexError, ValueError):
        return None
    return None


def style_of(cell, theme):
    f, b, a = cell.font, cell.border, cell.alignment
    fill = None
    if cell.fill is not None and cell.fill.fill_type == "solid":
        fill = color(cell.fill.fgColor, theme)
    def side(s):
        return None if s is None or not s.style else {"style": s.style, "color": color(s.color, theme) or "#000000"}
    return {
        "font": {"name": f.name, "size": float(f.sz or 11), "bold": bool(f.b), "italic": bool(f.i),
                 "underline": f.u or None, "color": color(f.color, theme) or "#000000"},
        "fill": None if fill in (None, "#FFFFFF") else fill,
        "border": {k: side(getattr(b, k)) for k in ("left", "right", "top", "bottom")},
        "align": {"h": a.horizontal or "general", "v": a.vertical or "bottom", "wrap": bool(a.wrap_text), "indent": int(a.indent or 0)},
        "numFmt": cell.number_format,
    }


def main(path, out_path):
    theme = theme_colors(path)
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["Main"]

    styles = collections.defaultdict(collections.Counter)
    for panel in range(PANELS):
        for block in range(BLOCKS):
            r0, c0 = block * BLOCK_ROWS, panel * BLOCK_COLS
            for dr in range(BLOCK_ROWS):
                for dc in range(BLOCK_COLS):
                    s = style_of(ws.cell(r0 + dr + 1, c0 + dc + 1), theme)
                    styles[(dr, dc)][json.dumps(s, sort_keys=True)] += 1

    merges = []
    for mr in ws.merged_cells.ranges:
        if mr.max_row <= BLOCK_ROWS and mr.max_col <= BLOCK_COLS:
            merges.append({"r": mr.min_row - 1, "c": mr.min_col - 1, "rows": mr.max_row - mr.min_row + 1, "cols": mr.max_col - mr.min_col + 1})
    merges.sort(key=lambda m: (m["r"], m["c"]))

    cells = []
    for dr in range(BLOCK_ROWS):
        for dc in range(BLOCK_COLS):
            style, count = styles[(dr, dc)].most_common(1)[0]
            entry = {"r": dr, "c": dc, **json.loads(style), "share": round(count / (PANELS * BLOCKS), 2)}
            cells.append(entry)

    default_height = ws.sheet_format.defaultRowHeight or 15
    rows = [float(ws.row_dimensions[r].height or default_height) for r in range(1, BLOCK_ROWS + 1)]
    widths = [float(ws.column_dimensions[get_column_letter(c)].width) for c in range(1, BLOCK_COLS + 1)]
    mdw = 7  # Calibri 11 maximum digit width at 96 DPI
    pixels = [int(((256 * w + int(128 / mdw)) / 256) * mdw) for w in widths]

    image = None
    for img in ws._images:
        anchor = img.anchor._from
        if anchor.row < BLOCK_ROWS and anchor.col < BLOCK_COLS:
            ext = img.anchor.ext
            image = {"r": anchor.row, "c": anchor.col, "rowOffEmu": anchor.rowOff, "colOffEmu": anchor.colOff,
                     "widthEmu": ext.width if ext else None, "heightEmu": ext.height if ext else None}
            break

    ps, pm = ws.page_setup, ws.page_margins
    template = {
        "source": path.split("/")[-1],
        "note": "Layout only: every text printed on a bill comes from the config file or the bill itself.",
        "page": {"paper": {"1": "letter", "9": "a4"}.get(str(ps.paperSize), "letter"), "orientation": ps.orientation or "portrait",
                 "scale": ps.scale or 100, "marginsIn": {"left": pm.left, "right": pm.right, "top": pm.top, "bottom": pm.bottom}},
        "defaultFont": {"name": wb._fonts[0].name, "size": float(wb._fonts[0].sz)},
        "columnsPx": pixels,
        "columnsChars": widths,
        "rowsPt": rows,
        "lineRows": {"first": FIRST_LINE_ROW, "count": LINE_ROWS},
        "merges": merges,
        "cells": cells,
        "image": image,
    }
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(template, fh, ensure_ascii=False, indent=1)
    print(f"columns px {pixels} = {sum(pixels)} px ({sum(pixels) / 96:.2f} in); rows {sum(rows):.2f} pt; merges {len(merges)}; image {image}")
    print("page", template["page"], "default font", template["defaultFont"])


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
