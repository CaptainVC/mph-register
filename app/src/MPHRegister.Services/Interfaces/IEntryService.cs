using MPHRegister.Contracts.Entries;

namespace MPHRegister.Services.Interfaces;

public interface IEntryService
{
    IReadOnlyList<EntryDto> List(string? month);

    IReadOnlyList<EntryDto> Recent(int? limit);

    EntryDto Get(long id);

    EntryDto Create(EntryInput input);

    EntryDto Update(long id, EntryInput input);

    /// <summary>Deletes an entry that is on no saved bill and not marked billed outside the app; it can be restored later.</summary>
    DeleteEntryResult Delete(long id);

    /// <summary>Entries deleted in the app, newest first, each with whether it can be restored now.</summary>
    IReadOnlyList<DeletedEntryDto> Deleted();

    /// <summary>Puts a deleted entry back under its own id, after checking nothing clashes with it.</summary>
    EntryDto Restore(long id);

    IReadOnlyList<EntryDto> PartyWise(string? month, string? party);

    IReadOnlyList<MonthSummary> Months();

    NextInwardDto NextInward(string? month);
}
