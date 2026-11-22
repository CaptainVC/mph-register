ALTER TABLE parties ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE parties ADD COLUMN state TEXT NOT NULL DEFAULT '';
ALTER TABLE parties ADD COLUMN gstin TEXT NOT NULL DEFAULT '';
ALTER TABLE parties ADD COLUMN discount REAL;
ALTER TABLE parties ADD COLUMN color TEXT NOT NULL DEFAULT 'black';
ALTER TABLE parties ADD COLUMN bill_to TEXT NOT NULL DEFAULT '';
ALTER TABLE parties ADD COLUMN bill_style TEXT NOT NULL DEFAULT '{}';
ALTER TABLE finishes ADD COLUMN finish_group TEXT NOT NULL DEFAULT '';
ALTER TABLE finishes ADD COLUMN color TEXT NOT NULL DEFAULT 'black';
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
