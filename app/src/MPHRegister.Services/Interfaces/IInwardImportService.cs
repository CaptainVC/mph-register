using MPHRegister.Contracts.Imports;

namespace MPHRegister.Services.Interfaces;

public interface IInwardImportService
{
    ImportReport Import(string filePath, string fileName, string? registerMonth, bool commit);
}
