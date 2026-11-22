CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE parties (name TEXT PRIMARY KEY COLLATE NOCASE, active INTEGER NOT NULL);
CREATE TABLE finishes (name TEXT PRIMARY KEY COLLATE NOCASE, active INTEGER NOT NULL);
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
