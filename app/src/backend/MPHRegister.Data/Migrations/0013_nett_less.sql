-- THAN that the workbook's NETT THAN charges less than THAN. The column is a formula in the registers (THAN, or 0 for a repair),
-- but a slip can have it typed over: "1 than bina finish" has THAN 24 and NETT THAN 23. 0 is the usual case: NETT THAN is THAN.
ALTER TABLE entries ADD COLUMN nett_less INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deleted_entries ADD COLUMN nett_less INTEGER NOT NULL DEFAULT 0;
