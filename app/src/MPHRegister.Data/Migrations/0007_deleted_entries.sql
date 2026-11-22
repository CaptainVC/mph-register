-- Entries deleted in the app, kept whole (with their dispatches and carryover rows as JSON) so they can be restored under the
-- same id: cancelled bills and later imports still know them by it. No foreign keys: the entry row itself is gone.
CREATE TABLE deleted_entries (
    id INTEGER PRIMARY KEY,
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
    import_batch_id INTEGER,
    source_row INTEGER,
    source_values TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    dispatches TEXT NOT NULL DEFAULT '[]',
    carryover_sources TEXT NOT NULL DEFAULT '[]',
    deleted_at TEXT NOT NULL
);
CREATE INDEX ix_deleted_entries_month ON deleted_entries(register_month, inward_no);
