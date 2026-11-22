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

    public string? BillFileByHash(string sha256) =>
        First<string>("SELECT file_name FROM bill_imports WHERE sha256 = @sha256;", new { sha256 });

    public void AddBillImport(BillImportEntity import) => Execute(
        "INSERT INTO bill_imports(file_name, sha256, imported_at, invoice_count) VALUES (@FileName, @Sha256, @ImportedAt, @InvoiceCount);",
        import);
}
