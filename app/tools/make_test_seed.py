"""Builds app/tests/fixtures/v04-seeded.db: a frozen data file in the v0.4 layout (parties, finishes, rates and firm
settings still inside the data file), filled with invented test data only. The startup tests prove that such a file
moves its lists into a new config file; the parties, firm, GSTINs, bank and phone numbers here are all fictional.

Usage: python make_test_seed.py [output]   (default: ../tests/fixtures/v04-seeded.db)
"""

import json
import random
import sqlite3
import sys
from pathlib import Path

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "v04-seeded.db"

SCHEMA = """
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE parties (name TEXT PRIMARY KEY COLLATE NOCASE, active INTEGER NOT NULL, address TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '', gstin TEXT NOT NULL DEFAULT '', discount REAL, color TEXT NOT NULL DEFAULT 'black', bill_to TEXT NOT NULL DEFAULT '', bill_style TEXT NOT NULL DEFAULT '{}');
CREATE TABLE finishes (name TEXT PRIMARY KEY COLLATE NOCASE, active INTEGER NOT NULL, finish_group TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'black', fallback TEXT NOT NULL DEFAULT '');
CREATE TABLE import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    register_month TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    entry_count INTEGER NOT NULL,
    dispatch_count INTEGER NOT NULL
);
CREATE TABLE entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    register_month TEXT NOT NULL,
    inward_no INTEGER NOT NULL,
    entry_date TEXT NOT NULL,
    party TEXT NOT NULL,
    design_no TEXT NOT NULL DEFAULT '',
    lot_no TEXT NOT NULL DEFAULT '',
    repair INTEGER NOT NULL DEFAULT 0,
    than INTEGER NOT NULL DEFAULT 0,
    tp INTEGER NOT NULL DEFAULT 0,
    two_part INTEGER NOT NULL DEFAULT 0,
    finish TEXT NOT NULL DEFAULT '',
    short_than INTEGER,
    carried_over INTEGER NOT NULL DEFAULT 0,
    import_batch_id INTEGER REFERENCES import_batches(id),
    source_row INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE dispatches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    qty INTEGER NOT NULL,
    gate_pass TEXT NOT NULL DEFAULT '',
    dispatch_date TEXT,
    date_text TEXT
);
CREATE INDEX ix_entries_month ON entries(register_month, inward_no);
CREATE INDEX ix_entries_party ON entries(party, finish, design_no, entry_date);
CREATE INDEX ix_dispatches_entry ON dispatches(entry_id, seq);
CREATE TABLE finish_groups (name TEXT PRIMARY KEY COLLATE NOCASE, active INTEGER NOT NULL);
CREATE TABLE rates (
    party TEXT NOT NULL COLLATE NOCASE,
    finish TEXT NOT NULL COLLATE NOCASE,
    rate REAL NOT NULL,
    PRIMARY KEY (party, finish)
);
CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
    fy TEXT NOT NULL,
    serial INTEGER NOT NULL,
    party TEXT NOT NULL COLLATE NOCASE,
    party_name TEXT NOT NULL,
    address TEXT NOT NULL,
    state TEXT NOT NULL,
    gstin TEXT NOT NULL,
    bill_date TEXT NOT NULL,
    bill_month TEXT NOT NULL,
    period_from TEXT NOT NULL,
    period_to TEXT NOT NULL,
    discount_pct REAL NOT NULL,
    tax_mode TEXT NOT NULL,
    cgst_rate REAL NOT NULL,
    sgst_rate REAL NOT NULL,
    igst_rate REAL NOT NULL,
    gross INTEGER NOT NULL,
    discount INTEGER NOT NULL,
    taxable INTEGER NOT NULL,
    cgst INTEGER NOT NULL,
    sgst INTEGER NOT NULL,
    igst INTEGER NOT NULL,
    total INTEGER NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    firm TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    cancelled_at TEXT
);
CREATE UNIQUE INDEX ux_invoices_serial ON invoices(fy, serial);
CREATE INDEX ix_invoices_month ON invoices(bill_month, party);
CREATE TABLE invoice_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL,
    gpn TEXT NOT NULL DEFAULT '',
    dn TEXT NOT NULL DEFAULT '',
    lot TEXT NOT NULL DEFAULT '',
    finish TEXT NOT NULL DEFAULT '',
    qty INTEGER,
    rate REAL,
    amount INTEGER,
    auto_sum INTEGER NOT NULL DEFAULT 0,
    entry_ids TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX ix_invoice_lines ON invoice_lines(invoice_id, seq);
CREATE TABLE invoice_entries (
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    entry_id INTEGER NOT NULL REFERENCES entries(id),
    PRIMARY KEY (invoice_id, entry_id)
);
CREATE INDEX ix_invoice_entries_entry ON invoice_entries(entry_id);
CREATE TABLE billed_elsewhere (
    entry_id INTEGER PRIMARY KEY REFERENCES entries(id),
    note TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE bill_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT NOT NULL,
    sha256 TEXT NOT NULL UNIQUE,
    imported_at TEXT NOT NULL,
    invoice_count INTEGER NOT NULL
);
CREATE INDEX ix_entries_carry_lookup ON entries(party, entry_date, inward_no);
"""

FINISH_GROUPS = ["SGZ", "SCZ", "S2GZ", "S2G", "SMG", "Gotka S2G", "SC2G", "SG", "Reyon SGZ", "2SGZ", "MIX"]
# name, group, colour, fallbacks
FINISHES = [
    ("SGZ", "SGZ", "black", "SGJ,SGB"), ("SCZ", "SCZ", "black", "SCJ,SCB"), ("SMZ", "SCZ", "black", "SCJ"),
    ("S2GZ", "S2GZ", "black", "S2GB"), ("S2G", "S2G", "black", ""), ("SCG", "SMG", "black", ""),
    ("SMG", "SGZ", "black", ""), ("SG", "SG", "black", ""), ("Gotka S2G", "Gotka S2G", "black", "S2G"),
    ("SC2G", "SC2G", "black", ""), ("Gotka SCG", "Gotka S2G", "black", "SCG"), ("Reyon SGZ", "Reyon SGZ", "black", ""),
    ("Chatan SMG", "MIX", "black", ""), ("SGJ", "SGZ", "red", ""), ("SCJ", "SCZ", "red", ""),
    ("LSGJ", "SGZ", "red", "SGJ"), ("LSCJ", "SCZ", "red", "SCJ"), ("2SGZ", "2SGZ", "black", ""), ("S", "MIX", "black", ""),
    ("G", "MIX", "black", ""), ("SZ", "MIX", "black", ""), ("Z", "MIX", "black", ""), ("XYZ", "MIX", "red", ""),
    ("ABC", "MIX", "black", ""), ("2SMZ", "MIX", "black", "2SCZ"), ("2S2G", "MIX", "black", ""), ("2SCZ", "", "black", ""),
    ("SGB", "", "black", ""), ("S2GB", "", "black", ""), ("SCB", "", "black", ""),
]


def style(gpn="none", dn="dn", lot="lot", group="entry", sort="inward", breakdown=False, finish_map=None):
    return {"gpn": gpn, "dn": dn, "lot": lot, "group": group, "sort": sort, "include": "dispatched",
            "breakdown": breakdown, "combineSmall": True, "finishMap": finish_map or {}}


STYLES = [
    style(), style(lot="none"), style(dn="none"), style(dn="none", lot="dn", sort="ref"),
    style(dn="none", group="lot", breakdown=True, finish_map={"LSGJ": "SGJ"}),
    style(dn="none", group="lot", finish_map={"LSGJ": "SGJ"}),
    style(gpn="gatepass", dn="none", lot="dn", sort="ref", finish_map={"Gotka S2G": "S2G"}),
    style(gpn="gatepass", lot="none", sort="ref"),
]

PARTIES = [
    "ABBOTT PRINTS", "ASHFORD TEXTILES", "BAKER MILLS", "BARNES FABRICS", "BENNETT TEX PRINT", "BROOKS & SONS",
    "CARTER TEXTILE MILLS", "CHANDLER FAB", "COOPER PRODUCT", "DAWSON MILLS", "ELLIOTT INDUSTRIES", "FLETCHER PRINTS",
    "FOSTER COTTON MILLS", "GRAHAM TEXTILES", "HARDING FABRICS", "HARRIS TEX FAB", "HAYES PRINTING", "HUDSON MILLS",
    "JENKINS ENTERPRISES", "KELLER TEXTILES PVT. LTD.", "LAWSON PRINTS", "MARSHALL MILLS", "MORGAN FABRICS",
    "NEWTON SILK MILLS", "OWEN TRADING CO.", "PARKER", "PRESTON DYEING", "QUINN TEXTILES", "REED PRINTS",
    "ROBERTS MILLS", "SAWYER FAB TEX", "SPENCER INDUSTRIES", "STANLEY PRODUCT", "THOMAS MILLS", "TURNER FABRICS",
    "WALKER TEXTILE", "WARREN PRINTS", "WEBSTER MILLS", "WHEELER SYNTHETICS", "YOUNG CLOTHING",
]
TOWNS = ["FAIRVIEW", "BROOKFIELD", "ASHLAND", "RIVERTON"]
ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def gstin(state: str, serial: int) -> str:
    """A GSTIN with a valid check character on a TEST… PAN, so it can never be a real one."""
    body = f"{state}TEST{ALPHABET[10 + serial % 26]}{serial:04d}{ALPHABET[10 + (serial * 7) % 26]}1Z"
    total = 0
    for i, ch in enumerate(body):
        product = ALPHABET.index(ch) * (1 if i % 2 == 0 else 2)
        total += product // 36 + product % 36
    return body + ALPHABET[(36 - total % 36) % 36]


FIRM = {
    "firmName": "WESTBROOK PROCESSING CO.",
    "gstin": gstin("08", 9001),
    "addressLine1": "UNIT 14, RIVERSIDE INDUSTRIAL ESTATE",
    "addressLine2": "FAIRVIEW-900001 (RAJASTHAN)",
    "phoneLine": "MOB.9000000001     OFF.MOB.9000000002",
    "msmeLine": "UDYAM REGISTRATION (MSME) NO. XX-00-0000001 (TYPE OF ENTERPRISE: MICRO)",
    "invoiceTitle": "TEXTILE JOB CHARGE INVOICE",
    "sacLine": "SAC CODE-998821",
    "copyLabel": "ORIGINAL COPY",
    "bankLine1": "TEST BANK A/C NO. 000000123456",
    "bankLine2": "IFS Code: TEST0000001",
    "paymentLine": "Payment by payee's A/C Cheque only.",
    "terms": "1.We are not responsible for any Goods damage during processing, transit & other.\n"
             "2.Payment must be made within 45 days from the date of the Bill.\n"
             "3.Any tax which will be applicable will be allowed.\n"
             "4.Subject to FAIRVIEW Jurisdiction only.",
    "signatory": "FOR :Westbrook Processing Co.",
    "signatureLabel": "Authorized Signatory",
    "checkedByLabel": "Checked by \u2026\u2026\u2026\u2026.",
    "homeStateCode": "08",
    "homeStateName": "RAJASTHAN",
    "cgstRate": 2.5,
    "sgstRate": 2.5,
    "igstRate": 5,
    "invoiceLimit": 200000,
    "rowsPerInvoice": 25,
    "invoicePrefix": "{FY}\\JOB\\",
    "smallThanBelow": 5,
    "combineMax": 4,
    "paperSize": "letter",
    "indianNumbers": True,
}
# A 1x1 PNG stands in for the signature.
SIGNATURE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="


def main() -> None:
    rng = random.Random(2026)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.unlink(missing_ok=True)
    db = sqlite3.connect(OUT)
    db.executescript(SCHEMA)
    db.execute("PRAGMA user_version = 3")
    db.executemany("INSERT INTO finish_groups VALUES (?, 1)", [(g,) for g in FINISH_GROUPS])
    db.executemany("INSERT INTO finishes VALUES (?, 1, ?, ?, ?)", FINISHES)
    finish_names = [f[0] for f in FINISHES]
    for i, name in enumerate(PARTIES):
        other_state = i == 7
        town = TOWNS[i % len(TOWNS)]
        db.execute(
            "INSERT INTO parties VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                name,
                1 if i % 3 == 0 else 0,
                f"{town}-9{rng.randint(10000, 99999)}" if i % 5 else "",
                "(GUJARAT)" if other_state else "(RAJASTHAN)",
                "" if i % 9 == 4 else gstin("24" if other_state else "08", 100 + i),
                rng.choice([0.0, 1.0, 5.0, 10.0, 12.5, 15.0]) if i % 6 else None,
                "red" if i % 13 == 2 else "" if i % 11 == 3 else "black",
                PARTIES[i - 1] if i == 33 else "",
                json.dumps(STYLES[i % len(STYLES)], indent=1),
            ),
        )
        for finish in rng.sample(finish_names, rng.randint(4, 14)):
            db.execute("INSERT INTO rates VALUES (?, ?, ?)", (name, finish, rng.randrange(120, 237) / 2))
    db.executemany("INSERT INTO settings VALUES (?, ?)", [
        ("firm", json.dumps(FIRM, indent=1, ensure_ascii=False)),
        ("invoice_next:26-27", "279"),
        ("signature_png", SIGNATURE),
    ])
    db.commit()
    db.execute("VACUUM")
    db.close()
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
