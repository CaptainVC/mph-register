-- What each inward import did to an entry: 'added' it (a row the month did not have) or 'updated' it (the workbook changed
-- it; changes says what). The Register's New and Updated filters show what the latest import of each month did. No foreign
-- key on entry_id: an entry deleted in the app and restored keeps its id, and entries no longer saved are simply not shown.
CREATE TABLE import_batch_entries (
    batch_id INTEGER NOT NULL REFERENCES import_batches(id),
    entry_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('added', 'updated')),
    source_row INTEGER,
    changes TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (batch_id, entry_id)
);
CREATE INDEX ix_import_batch_entries_entry ON import_batch_entries(entry_id);
-- Imports made before this table, as far as the entries still tell: the latest import of each month added the entries it
-- created then, and updated the ones it matched that changed at that moment and were not edited since (what changed is
-- not known).
INSERT INTO import_batch_entries(batch_id, entry_id, action, source_row, changes)
SELECT b.id, e.id, CASE WHEN e.created_at = b.imported_at THEN 'added' ELSE 'updated' END, e.source_row, ''
FROM import_batches b JOIN entries e ON e.import_batch_id = b.id
WHERE b.id = (SELECT MAX(x.id) FROM import_batches x WHERE x.register_month = b.register_month)
  AND (e.created_at = b.imported_at OR e.updated_at = b.imported_at);
