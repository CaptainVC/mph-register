using MPHRegister.Data.Entities;

namespace MPHRegister.Data.Repositories.Interfaces;

public interface IImportLogRepository
{
    string? InwardFileByHash(string sha256);

    /// <summary>When inward workbooks of months after <paramref name="month"/> were imported.</summary>
    IReadOnlySet<string> InwardImportTimesAfter(string month);

    long AddInwardBatch(ImportBatchEntity batch);

    /// <summary>
    /// Records what an import did to entries. An entry keeps the import that added it and the latest one that updated it:
    /// the updates before are removed, so the data file does not grow with every import.
    /// </summary>
    void AddInwardBatchEntries(IReadOnlyCollection<ImportBatchEntryEntity> rows);

    /// <summary>
    /// What the latest import of each month did to the entries it added or updated, by entry (these entries; null: every entry). An entry both its own month's
    /// latest import and a later month's (through a carryover row) updated has the newer of the two.
    /// </summary>
    IReadOnlyDictionary<long, ImportMarkEntity> LatestImportMarks(IReadOnlyCollection<long>? entryIds);

    /// <summary>When the latest import that updated each entry did so, by entry (these entries; null: every entry).</summary>
    IReadOnlyDictionary<long, string> LatestImportUpdates(IReadOnlyCollection<long>? entryIds);

    /// <summary>The import that added the entry and the latest that updated it, newest first.</summary>
    IReadOnlyList<ImportMarkEntity> ImportHistory(long entryId);

    string? BillFileByHash(string sha256);

    void AddBillImport(BillImportEntity import);
}
