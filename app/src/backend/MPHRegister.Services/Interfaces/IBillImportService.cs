using MPHRegister.Contracts.Imports;

namespace MPHRegister.Services.Interfaces;

public interface IBillImportService
{
    BillImportReport Import(string filePath, string fileName, bool commit);

    /// <summary>Matches every bill imported from Excel to the inward register again; saves the new links when <paramref name="commit"/> is true.</summary>
    BillRelinkReport Relink(bool commit);
}
