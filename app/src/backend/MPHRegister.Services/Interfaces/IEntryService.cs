using MPHRegister.Contracts.Entries;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Interfaces;

public interface IEntryService
{
    /// <summary>The month's entries; with no valid month, those of <paramref name="months"/> (or all when it is null).</summary>
    IReadOnlyList<EntryDto> List(string? month, MonthRange? months = null);

    IReadOnlyList<EntryDto> Recent(int? limit);

    EntryDto Get(long id);

    /// <summary>The import that added the entry and the latest that updated it, with what the update changed.</summary>
    ImportHistoryDto ImportHistory(long id);

    EntryDto Create(EntryInput input);

    EntryDto Update(long id, EntryInput input);

    /// <summary>Deletes an entry that is on no saved bill and not marked billed outside the app; it can be restored later.</summary>
    DeleteEntryResult Delete(long id);

    /// <summary>Entries deleted in the app, newest first, each with whether it can be restored now.</summary>
    IReadOnlyList<DeletedEntryDto> Deleted();

    /// <summary>Puts a deleted entry back under its own id, after checking nothing clashes with it.</summary>
    EntryDto Restore(long id);

    /// <summary>Permanently removes every deleted entry; none of them can be restored afterwards.</summary>
    PurgeDeletedResult PurgeDeleted();

    /// <summary>What an all-zero slip of this register month and party would link to with this D.N.</summary>
    IReadOnlyList<EntryLinkDto> LinksFor(string? month, string? party, string? designNo);

    IReadOnlyList<EntryDto> PartyWise(string? month, string? party, MonthRange? months = null);

    IReadOnlyList<MonthSummary> Months();

    NextInwardDto NextInward(string? month);
}
