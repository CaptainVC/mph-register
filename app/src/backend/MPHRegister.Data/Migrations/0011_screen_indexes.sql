-- Indexes the screens' queries can use. Parties are compared without regard to case, so the party index uses NOCASE (the
-- plain one from 0003 was never used for that and goes); bills and Aawak look slips up by inward number and inward date.
CREATE INDEX IF NOT EXISTS ix_entries_party_nc ON entries(party COLLATE NOCASE, entry_date, inward_no);
CREATE INDEX IF NOT EXISTS ix_entries_date ON entries(entry_date);
CREATE INDEX IF NOT EXISTS ix_entries_inward ON entries(inward_no, entry_date);
-- The numbered slips of a month (duplicate numbers, the next inward number).
CREATE INDEX IF NOT EXISTS ix_entries_numbered ON entries(register_month, inward_no) WHERE carried_over = 0 AND inward_no > 0;
-- Entries and Aawak rows typed in the app, newest first (the Recent lists).
CREATE INDEX IF NOT EXISTS ix_entries_typed ON entries(id) WHERE import_batch_id IS NULL;
CREATE INDEX IF NOT EXISTS ix_arrivals_typed ON arrivals(id) WHERE import_batch_id IS NULL;
-- Bills by date (the dashboard). Not led by status: the planner would then walk every saved bill to find one entry's bill.
CREATE INDEX IF NOT EXISTS ix_invoices_date ON invoices(bill_date, status);
CREATE INDEX IF NOT EXISTS ix_invoices_party ON invoices(party);
DROP INDEX IF EXISTS ix_entries_carry_lookup;
