-- The row each entry had in the workbook it was last imported from (JSON). Importing a newer copy of that month's
-- workbook compares with it: what changed in the workbook is applied, what was changed in the app is kept.
ALTER TABLE entries ADD COLUMN source_values TEXT;
-- The same for carryover rows: a later month's row of an earlier entry, as that month's workbook last had it.
CREATE TABLE carryover_sources (
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    register_month TEXT NOT NULL,
    source_values TEXT NOT NULL,
    PRIMARY KEY (entry_id, register_month)
);
-- v0.5 left a later month's carryover that an earlier month adopted (with changes) in the later month. Put it in the month
-- whose import adopted it, so importing that month again finds it instead of adding it a second time.
UPDATE entries SET register_month = (SELECT b.register_month FROM import_batches b WHERE b.id = entries.import_batch_id)
WHERE register_month <> (SELECT b.register_month FROM import_batches b WHERE b.id = entries.import_batch_id);
