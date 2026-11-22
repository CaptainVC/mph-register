using MPHRegister.Contracts.Masters;
using MPHRegister.Shared.Configuration;

namespace MPHRegister.Services.Interfaces;

/// <summary>Read side of the parties, finishes and other lists in the config file, shared by masters, billing and imports.</summary>
public interface IMasterReader
{
    AppConfig Config { get; }

    IReadOnlyList<PartyDto> Parties();

    PartyDto? Party(string? name);

    IReadOnlyList<FinishDto> Finishes();

    IReadOnlyList<GroupDto> Groups();

    IReadOnlyList<StyleDto> Styles();

    IReadOnlyList<ColorDto> Colors();

    IReadOnlyDictionary<string, IReadOnlyList<string>> FinishFallbacks();

    /// <summary>The party a bill goes to (its bill-to party if set) and every party whose entries go on that bill.</summary>
    IReadOnlyList<string> BillRecipients(string? party);
}
