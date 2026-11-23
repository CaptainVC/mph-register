-- What each import changed in an entry, kept as data so the Register can show it (details: the fields and dispatches that
-- changed, and what follows from them, as JSON; empty for imports from before, where only the text in changes exists).
-- An entry keeps the import that added it and the latest that updated it; earlier updates go, so the file does not grow
-- with every import.
ALTER TABLE import_batch_entries ADD COLUMN details TEXT NOT NULL DEFAULT '';
DELETE FROM import_batch_entries
WHERE action = 'updated'
  AND batch_id < (SELECT MAX(x.batch_id) FROM import_batch_entries x WHERE x.entry_id = import_batch_entries.entry_id AND x.action = 'updated');
