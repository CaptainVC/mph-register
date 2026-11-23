-- Aawak: goods arriving at the gate. One row is one consignment (one party, one lorry wala, one day) and names the inward
-- slips it carries. Arrivals are linked to inward entries; the lorry walas themselves live in the config file.
CREATE TABLE arrival_import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    aawak_month TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    arrival_count INTEGER NOT NULL
);
-- aawak_month is the register's calendar month; aawak_suffix is the letter of a row put in later (217A). inward_text holds
-- the slip numbers as written ("12-14") and note the rest of COMMENTS. source_values is the workbook row last imported.
CREATE TABLE arrivals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aawak_month TEXT NOT NULL,
    aawak_no INTEGER NOT NULL,
    aawak_suffix TEXT NOT NULL DEFAULT '',
    arrival_date TEXT NOT NULL,
    party TEXT NOT NULL,
    nag INTEGER NOT NULL,
    transporter TEXT NOT NULL,
    inward_text TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    import_batch_id INTEGER REFERENCES arrival_import_batches(id),
    source_row INTEGER,
    source_values TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_arrivals_no ON arrivals(aawak_month, aawak_no, aawak_suffix);
CREATE INDEX ix_arrivals_date ON arrivals(arrival_date);
CREATE INDEX ix_arrivals_party ON arrivals(party, arrival_date);
CREATE INDEX ix_arrivals_transporter ON arrivals(transporter, arrival_date);
-- The slip numbers an arrival names, kept before the slips exist so they link when the office enters them.
CREATE TABLE arrival_refs (
    arrival_id INTEGER NOT NULL REFERENCES arrivals(id) ON DELETE CASCADE,
    inward_no INTEGER NOT NULL,
    PRIMARY KEY (arrival_id, inward_no)
);
CREATE INDEX ix_arrival_refs_no ON arrival_refs(inward_no);
-- Inward entries that came on an arrival. nag is the part of the entry that came on it when a slip came in two loads (null:
-- all of it); how is 'auto' (found by the app) or 'manual'. No foreign key on entry_id: an entry deleted in the app and
-- restored keeps its id.
CREATE TABLE arrival_entries (
    arrival_id INTEGER NOT NULL REFERENCES arrivals(id) ON DELETE CASCADE,
    entry_id INTEGER NOT NULL,
    nag INTEGER,
    how TEXT NOT NULL CHECK (how IN ('auto', 'manual')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (arrival_id, entry_id)
);
CREATE INDEX ix_arrival_entries_entry ON arrival_entries(entry_id);
-- Arrivals deleted in the app, kept whole (refs and links as JSON) so they can be restored under the same id; a later import
-- of the month leaves them deleted.
CREATE TABLE deleted_arrivals (
    id INTEGER PRIMARY KEY,
    aawak_month TEXT NOT NULL,
    aawak_no INTEGER NOT NULL,
    aawak_suffix TEXT NOT NULL DEFAULT '',
    arrival_date TEXT NOT NULL,
    party TEXT NOT NULL,
    nag INTEGER NOT NULL,
    transporter TEXT NOT NULL,
    inward_text TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    import_batch_id INTEGER,
    source_row INTEGER,
    source_values TEXT,
    refs TEXT NOT NULL DEFAULT '[]',
    links TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL
);
CREATE INDEX ix_deleted_arrivals_no ON deleted_arrivals(aawak_month, aawak_no, aawak_suffix);
-- What each Aawak import did to each arrival (the New and Updated filters).
CREATE TABLE arrival_import_marks (
    batch_id INTEGER NOT NULL REFERENCES arrival_import_batches(id),
    arrival_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('added', 'updated')),
    source_row INTEGER,
    changes TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (batch_id, arrival_id)
);
CREATE INDEX ix_arrival_import_marks_arrival ON arrival_import_marks(arrival_id);
-- Inward slips that never come through the gate (moved inside the factory, re-slipped): the "No Aawak found" check leaves
-- them out.
CREATE TABLE entry_no_arrival (
    entry_id INTEGER PRIMARY KEY,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL
);
