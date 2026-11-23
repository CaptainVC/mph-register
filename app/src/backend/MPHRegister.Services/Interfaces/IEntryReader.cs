using MPHRegister.Contracts.Entries;
using MPHRegister.Data.Entities;

namespace MPHRegister.Services.Interfaces;

/// <summary>Turns stored entry rows into entries with dispatches, status and warnings.</summary>
public interface IEntryReader
{
    IReadOnlyList<EntryDto> Read(IReadOnlyList<EntryEntity> rows);

    /// <summary>
    /// What bills need only: dispatches, status and the figures. Leaves out what bills never show (Aawak rows and state, the
    /// latest import, D.N. links and the warning for an inward number used twice), which take most of the reading.
    /// </summary>
    IReadOnlyList<EntryDto> ReadForBilling(IReadOnlyList<EntryEntity> rows);
}
