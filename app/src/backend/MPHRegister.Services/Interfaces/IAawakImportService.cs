using MPHRegister.Contracts.Arrivals;

namespace MPHRegister.Services.Interfaces;

public interface IAawakImportService
{
    /// <param name="applyGroups">Give parties without a sister-firm group the party group the workbook's Details sheet has.</param>
    AawakImportReport Import(string filePath, string fileName, string? month, bool commit, bool applyGroups);
}
