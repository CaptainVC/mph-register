-- No invoice foreign key: the audit snapshot must survive removal of the internal save.
CREATE TABLE invoice_undos (
    invoice_id INTEGER PRIMARY KEY,
    invoice_no TEXT NOT NULL COLLATE NOCASE,
    fy TEXT NOT NULL,
    serial INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    undone_at TEXT NOT NULL,
    confirmed_never_issued INTEGER NOT NULL CHECK (confirmed_never_issued = 1)
);
