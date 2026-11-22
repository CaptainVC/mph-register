using MPHRegister.Contracts.Entries;

namespace MPHRegister.Services.Interfaces;

public interface IEntryService
{
    IReadOnlyList<EntryDto> List(string? month);

    IReadOnlyList<EntryDto> Recent(int? limit);

    EntryDto Get(long id);

    EntryDto Create(EntryInput input);

    EntryDto Update(long id, EntryInput input);

    IReadOnlyList<EntryDto> PartyWise(string? month, string? party);

    IReadOnlyList<MonthSummary> Months();

    NextInwardDto NextInward(string? month);
}
