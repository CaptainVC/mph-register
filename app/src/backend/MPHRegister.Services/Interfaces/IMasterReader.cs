using MPHRegister.Contracts.Masters;
using MPHRegister.Shared.Configuration;

namespace MPHRegister.Services.Interfaces;

/// <summary>Read side of the parties, finishes and other lists in the config file, shared by masters, billing and imports.</summary>
public interface IMasterReader
{
    AppConfig Config { get; }

    IReadOnlyList<PartyDto> Parties();

    /// <summary>The party with its settings; <paramref name="withCounts"/> false leaves its entry count at 0 (bills never show it, and
    /// counting reads every entry).</summary>
    PartyDto? Party(string? name, bool withCounts = true);

    IReadOnlyList<FinishDto> Finishes();

    IReadOnlyList<GroupDto> Groups();

    IReadOnlyList<StyleDto> Styles();

    IReadOnlyList<ColorDto> Colors();

    IReadOnlyDictionary<string, IReadOnlyList<string>> FinishFallbacks();

    /// <summary>The party a bill goes to (its bill-to party if set) and every party whose entries go on that bill.</summary>
    IReadOnlyList<string> BillRecipients(string? party);
}
