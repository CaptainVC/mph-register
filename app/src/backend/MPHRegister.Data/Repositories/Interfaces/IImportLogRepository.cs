using MPHRegister.Data.Entities;

namespace MPHRegister.Data.Repositories.Interfaces;

public interface IImportLogRepository
{
    string? InwardFileByHash(string sha256);

    /// <summary>When inward workbooks of months after <paramref name="month"/> were imported.</summary>
    IReadOnlySet<string> InwardImportTimesAfter(string month);

    long AddInwardBatch(ImportBatchEntity batch);

    void AddInwardBatchEntries(IReadOnlyCollection<ImportBatchEntryEntity> rows);

    /// <summary>
    /// What the latest import of each month did to the entries it added or updated, by entry. An entry both its own month's
    /// latest import and a later month's (through a carryover row) updated has the newer of the two.
    /// </summary>
    IReadOnlyDictionary<long, ImportMarkEntity> LatestImportMarks();

    string? BillFileByHash(string sha256);

    void AddBillImport(BillImportEntity import);
}
