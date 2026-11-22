using MPHRegister.Contracts.Entries;
using MPHRegister.Data.Entities;

namespace MPHRegister.Services.Interfaces;

/// <summary>Turns stored entry rows into entries with dispatches, status and warnings.</summary>
public interface IEntryReader
{
    IReadOnlyList<EntryDto> Read(IReadOnlyList<EntryEntity> rows);
}
