using MPHRegister.Data.Database;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;

namespace MPHRegister.Data.Repositories;

public sealed class ImportLogRepository(IDbSession session) : RepositoryBase(session), IImportLogRepository
{
    public string? InwardFileByHash(string sha256) =>
        First<string>("SELECT file_name FROM import_batches WHERE sha256 = @sha256 LIMIT 1;", new { sha256 });

    public IReadOnlySet<string> InwardImportTimesAfter(string month) =>
        Query<string>("SELECT DISTINCT imported_at FROM import_batches WHERE register_month > @month;", new { month }).ToHashSet(StringComparer.Ordinal);

    public long AddInwardBatch(ImportBatchEntity batch) => Scalar<long>(
        """
        INSERT INTO import_batches(file_name, sha256, register_month, imported_at, entry_count, dispatch_count)
        VALUES (@FileName, @Sha256, @RegisterMonth, @ImportedAt, @EntryCount, @DispatchCount) RETURNING id;
        """,
        batch);

    public void AddInwardBatchEntries(IReadOnlyCollection<ImportBatchEntryEntity> rows)
    {
        if (rows.Count == 0) return;
        Execute(
            """
            INSERT OR REPLACE INTO import_batch_entries(batch_id, entry_id, action, source_row, changes)
            VALUES (@BatchId, @EntryId, @Action, @SourceRow, @Changes);
            """,
            rows);
    }

    public IReadOnlyDictionary<long, ImportMarkEntity> LatestImportMarks(IReadOnlyCollection<long>? entryIds)
    {
        var marks = new Dictionary<long, ImportMarkEntity>();
        if (entryIds is { Count: 0 }) return marks;
        var rows = Query<ImportMarkEntity>(
            $"""
            SELECT ie.entry_id, ie.action, ie.changes, b.id AS batch_id, b.file_name, b.imported_at, b.register_month
            FROM import_batch_entries ie JOIN import_batches b ON b.id = ie.batch_id
            WHERE b.id IN (SELECT MAX(id) FROM import_batches GROUP BY register_month)
              {(entryIds is null ? string.Empty : "AND ie.entry_id IN (SELECT value FROM json_each(@entryIds))")}
            ORDER BY b.id;
            """,
            new { entryIds = entryIds is null ? null : Json(entryIds) });
        foreach (var mark in rows) marks[mark.EntryId] = mark;
        return marks;
    }

    public string? BillFileByHash(string sha256) =>
        First<string>("SELECT file_name FROM bill_imports WHERE sha256 = @sha256;", new { sha256 });

    public void AddBillImport(BillImportEntity import) => Execute(
        "INSERT INTO bill_imports(file_name, sha256, imported_at, invoice_count) VALUES (@FileName, @Sha256, @ImportedAt, @InvoiceCount);",
        import);
}
