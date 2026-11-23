using MPHRegister.Data.Database;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;

namespace MPHRegister.Data.Repositories;

public sealed class InvoiceRepository(IDbSession session) : RepositoryBase(session), IInvoiceRepository
{
    private const string Columns = """
        id, invoice_no, fy, serial, party, party_name, address, state, gstin, bill_date, bill_month, period_from, period_to,
        discount_pct, tax_mode, cgst_rate, sgst_rate, igst_rate, gross, discount, taxable, cgst, sgst, igst, total, status,
        source, firm, notes, created_at, updated_at, cancelled_at
        """;

    public IReadOnlyList<InvoiceSummaryRow> List(string? month, string? party, string? fromMonth = null, string? toMonth = null)
    {
        // Only the conditions asked for: "(@month IS NULL OR …)" would keep SQLite from using the month index.
        var where = new List<string>();
        if (month is not null) where.Add("i.bill_month = @month");
        if (party is not null) where.Add("i.party = @party");
        if (fromMonth is not null && toMonth is not null) where.Add("i.bill_month BETWEEN @fromMonth AND @toMonth");
        return Query<InvoiceSummaryRow>(
            $"""
            SELECT i.id, i.invoice_no, i.bill_date, i.bill_month, i.fy, i.serial, i.party, i.party_name,
                (SELECT COALESCE(SUM(qty), 0) FROM invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'priced') AS than,
                i.total, i.status, i.source,
                (SELECT group_concat(DISTINCT finish) FROM invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'priced') AS finishes,
                (SELECT COUNT(*) FROM invoice_entries ie WHERE ie.invoice_id = i.id) AS entries,
                x.exported_at, x.file_name AS exported_to, COALESCE(x.invoice_updated_at <> i.updated_at, 0) AS changed_since_export
            FROM invoices i
            LEFT JOIN bill_exports x ON x.id = (SELECT id FROM bill_exports WHERE invoice_id = i.id ORDER BY exported_at DESC, id DESC LIMIT 1)
            {(where.Count == 0 ? string.Empty : "WHERE " + string.Join(" AND ", where))}
            ORDER BY i.fy, i.serial;
            """,
            new { month, party, fromMonth, toMonth });
    }

    public IReadOnlyList<BillMonthCount> Months() =>
        Query<BillMonthCount>("SELECT bill_month AS month, COUNT(*) AS bills FROM invoices GROUP BY bill_month ORDER BY bill_month DESC;");

    public IReadOnlySet<long> ExistingIds(IReadOnlyCollection<long> ids) => ids.Count == 0
        ? new HashSet<long>()
        : Query<long>("SELECT id FROM invoices WHERE id IN (SELECT value FROM json_each(@ids));", new { ids = Json(ids) }).ToHashSet();

    public InvoiceEntity? Get(long id) => First<InvoiceEntity>($"SELECT {Columns} FROM invoices WHERE id = @id;", new { id });

    public IReadOnlyList<InvoiceEntity> Saved(string source) => Query<InvoiceEntity>(
        $"SELECT {Columns} FROM invoices WHERE status = 'saved' AND source = @source ORDER BY bill_month, fy, serial, id;",
        new { source });

    public IReadOnlyList<InvoiceLineEntity> Lines(long invoiceId) => Query<InvoiceLineEntity>(
        "SELECT kind, gpn, dn, lot, finish, qty, rate, amount, auto_sum, entry_ids FROM invoice_lines WHERE invoice_id = @invoiceId ORDER BY seq;",
        new { invoiceId });

    public long Insert(InvoiceEntity invoice) => Scalar<long>(
        """
        INSERT INTO invoices(invoice_no, fy, serial, party, party_name, address, state, gstin, bill_date, bill_month,
            period_from, period_to, discount_pct, tax_mode, cgst_rate, sgst_rate, igst_rate, gross, discount, taxable,
            cgst, sgst, igst, total, status, source, firm, notes, created_at, updated_at)
        VALUES (@InvoiceNo, @Fy, @Serial, @Party, @PartyName, @Address, @State, @Gstin, @BillDate, @BillMonth,
            @PeriodFrom, @PeriodTo, @DiscountPct, @TaxMode, @CgstRate, @SgstRate, @IgstRate, @Gross, @Discount, @Taxable,
            @Cgst, @Sgst, @Igst, @Total, @Status, @Source, @Firm, @Notes, @CreatedAt, @UpdatedAt)
        RETURNING id;
        """,
        invoice);

    public void UpdateEdited(InvoiceEntity invoice) => Execute(
        """
        UPDATE invoices SET party_name = @PartyName, address = @Address, state = @State, gstin = @Gstin, bill_date = @BillDate,
            bill_month = @BillMonth, period_from = @PeriodFrom, period_to = @PeriodTo, discount_pct = @DiscountPct, tax_mode = @TaxMode,
            cgst_rate = @CgstRate, sgst_rate = @SgstRate, igst_rate = @IgstRate, gross = @Gross, discount = @Discount,
            taxable = @Taxable, cgst = @Cgst, sgst = @Sgst, igst = @Igst, total = @Total, notes = @Notes, updated_at = @UpdatedAt
        WHERE id = @Id;
        """,
        invoice);

    public void ReplaceLines(long invoiceId, IReadOnlyList<InvoiceLineEntity> lines, IReadOnlyCollection<long> entryIds)
    {
        ArgumentNullException.ThrowIfNull(lines);
        ArgumentNullException.ThrowIfNull(entryIds);
        Execute("DELETE FROM invoice_lines WHERE invoice_id = @invoiceId; DELETE FROM invoice_entries WHERE invoice_id = @invoiceId;", new { invoiceId });
        var seq = 0;
        foreach (var l in lines)
        {
            Execute(
                """
                INSERT INTO invoice_lines(invoice_id, seq, kind, gpn, dn, lot, finish, qty, rate, amount, auto_sum, entry_ids)
                VALUES (@invoiceId, @seq, @Kind, @Gpn, @Dn, @Lot, @Finish, @Qty, @Rate, @Amount, @AutoSum, @EntryIds);
                """,
                new { invoiceId, seq = ++seq, l.Kind, l.Gpn, l.Dn, l.Lot, l.Finish, l.Qty, l.Rate, l.Amount, l.AutoSum, l.EntryIds });
        }
        foreach (var entryId in entryIds.Distinct())
        {
            Execute("INSERT OR IGNORE INTO invoice_entries(invoice_id, entry_id) VALUES (@invoiceId, @entryId);", new { invoiceId, entryId });
        }
    }

    public void Cancel(long invoiceId, string at) => Execute(
        """
        UPDATE invoices SET status = 'cancelled', cancelled_at = @at, updated_at = @at WHERE id = @invoiceId;
        DELETE FROM invoice_entries WHERE invoice_id = @invoiceId;
        """,
        new { invoiceId, at });

    public void Restore(long invoiceId, IReadOnlyCollection<long> entryIds, string at)
    {
        ArgumentNullException.ThrowIfNull(entryIds);
        Execute("UPDATE invoices SET status = 'saved', cancelled_at = NULL, updated_at = @at WHERE id = @invoiceId;", new { invoiceId, at });
        foreach (var entryId in entryIds.Distinct())
        {
            Execute("INSERT OR IGNORE INTO invoice_entries(invoice_id, entry_id) VALUES (@invoiceId, @entryId);", new { invoiceId, entryId });
        }
    }

    public IReadOnlyList<InvoiceEntryClaim> EntryClaims(long invoiceId, IReadOnlyCollection<long> entryIds)
    {
        ArgumentNullException.ThrowIfNull(entryIds);
        if (entryIds.Count == 0) return [];
        return Query<InvoiceEntryClaim>(
            """
            SELECT x.id AS EntryId, e.party AS Party, e.register_month AS RegisterMonth, COALESCE(e.inward_no, 0) AS InwardNo,
                e.id IS NULL AS Missing,
                (SELECT group_concat(i.invoice_no, ', ') FROM invoice_entries ie JOIN invoices i ON i.id = ie.invoice_id
                 WHERE ie.entry_id = x.id AND i.status = 'saved' AND i.id <> @invoiceId) AS Bill,
                (SELECT note FROM billed_elsewhere b WHERE b.entry_id = x.id) AS Elsewhere
            FROM (SELECT value AS id FROM json_each(@ids)) x
            LEFT JOIN entries e ON e.id = x.id
            WHERE e.id IS NULL
               OR EXISTS (SELECT 1 FROM invoice_entries ie JOIN invoices i ON i.id = ie.invoice_id
                          WHERE ie.entry_id = x.id AND i.status = 'saved' AND i.id <> @invoiceId)
               OR EXISTS (SELECT 1 FROM billed_elsewhere b WHERE b.entry_id = x.id)
            ORDER BY e.register_month, e.inward_no, x.id;
            """,
            new { invoiceId, ids = System.Text.Json.JsonSerializer.Serialize(entryIds.Distinct()) });
    }

    public void UndoSave(InvoiceUndoEntity undo) => Execute(
        """
        INSERT INTO invoice_undos(invoice_id, invoice_no, fy, serial, snapshot, undone_at, confirmed_never_issued)
        VALUES (@InvoiceId, @InvoiceNo, @Fy, @Serial, @Snapshot, @UndoneAt, 1);
        DELETE FROM invoices WHERE id = @InvoiceId;
        """,
        undo);

    public InvoiceEntity? FindByNumber(string invoiceNo, string fy, int serial) => First<InvoiceEntity>(
        $"SELECT {Columns} FROM invoices WHERE invoice_no = @invoiceNo OR (fy = @fy AND serial = @serial) ORDER BY id LIMIT 1;", new { invoiceNo, fy, serial });

    public bool Exists(string invoiceNo, string fy, int serial) =>
        Scalar<long?>("SELECT 1 FROM invoices WHERE invoice_no = @invoiceNo OR (fy = @fy AND serial = @serial) LIMIT 1;", new { invoiceNo, fy, serial }) is not null;

    public int MaxSerial(string fy) => Scalar<int>("SELECT COALESCE(MAX(serial), 0) FROM invoices WHERE fy = @fy;", new { fy });
}
