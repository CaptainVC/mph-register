using MPHRegister.Contracts.Entries;
using MPHRegister.Data.Entities;

namespace MPHRegister.Services.Interfaces;

/// <summary>Finds the earlier entry an all-zero slip's D.N. points to, and the all-zero slips that point at an entry.</summary>
public interface IEntryLinker
{
    /// <summary>The links of these entries: an all-zero slip to what its D.N. names, an entry back to the slips naming it.</summary>
    IReadOnlyDictionary<long, IReadOnlyList<EntryLinkDto>> For(IReadOnlyList<EntryEntity> rows);

    /// <summary>What a slip of this register month and party would link to with this D.N. (for the entry form, before it is saved).</summary>
    IReadOnlyList<EntryLinkDto> Preview(string registerMonth, string party, string? designNo);
}
