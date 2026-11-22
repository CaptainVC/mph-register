using MPHRegister.Data.Entities;

namespace MPHRegister.Data.Repositories.Interfaces;

public interface IImportLogRepository
{
    string? InwardFileByHash(string sha256);

    /// <summary>When inward workbooks of months after <paramref name="month"/> were imported.</summary>
    IReadOnlySet<string> InwardImportTimesAfter(string month);

    long AddInwardBatch(ImportBatchEntity batch);

    string? BillFileByHash(string sha256);

    void AddBillImport(BillImportEntity import);
}
