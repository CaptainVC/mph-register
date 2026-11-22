-- Finishes a party is billed under when it has no rate for the inward finish (e.g. Gotka S2G -> S2G).
ALTER TABLE finishes ADD COLUMN fallback TEXT NOT NULL DEFAULT '';
-- Keeps carryover rows linked to the entry they repeat, so a later month's register updates it instead of duplicating it.
CREATE INDEX ix_entries_carry_lookup ON entries(party, entry_date, inward_no);
