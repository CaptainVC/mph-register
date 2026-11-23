-- Each time a saved bill was written into (or found already in) a copy of the Excel bill workbook. invoice_updated_at is the
-- bill's updated_at then, so the Saved bills list can say when the bill changed after it was written.
CREATE TABLE bill_exports (
    id INTEGER PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    invoice_no TEXT NOT NULL,
    file_name TEXT NOT NULL,
    cell TEXT NOT NULL,
    exported_at TEXT NOT NULL,
    invoice_updated_at TEXT NOT NULL
);
CREATE INDEX ix_bill_exports_invoice ON bill_exports(invoice_id, exported_at);
