using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Enums;

namespace MPHRegister.Contracts.Masters;

/// <param name="Group">For parties: the sister-firm group (empty for a party on its own).</param>
public sealed record MasterItem(string Name, bool Active, string Group = "");

public sealed record MastersDto(IReadOnlyList<MasterItem> Parties, IReadOnlyList<MasterItem> Finishes, IReadOnlyList<MasterItem>? Transporters = null);

/// <param name="BillingStyle">The style name the party chose.</param>
/// <param name="Style">That style's settings (the first style when the name is not found).</param>
public sealed record PartyDto(
    string Name,
    bool Active,
    string Address,
    string State,
    string Gstin,
    decimal? Discount,
    string Color,
    string BillingStyle,
    BillingStyle Style,
    bool BillBeforeDispatch,
    IReadOnlyDictionary<string, string> BillAs,
    IReadOnlyDictionary<string, decimal> Rates,
    int Entries,
    IReadOnlyList<string> Problems,
    string SisterGroup = "",
    bool NoBillNeeded = false);

/// <param name="Rates">Optional; null leaves the party's rates as they are (rates are usually changed one at a time).</param>
/// <param name="SisterGroup">Optional; null leaves the party's sister-firm group as it is.</param>
/// <param name="NoBillNeeded">Optional; null leaves the party's "no bill needed" setting as it is.</param>
public sealed record PartyInput(
    string? OriginalName,
    string? Name,
    bool Active,
    string? Address,
    string? State,
    string? Gstin,
    decimal? Discount,
    string? Color,
    string? BillingStyle,
    bool BillBeforeDispatch,
    IReadOnlyDictionary<string, string>? BillAs,
    IReadOnlyDictionary<string, decimal?>? Rates,
    string? SisterGroup = null,
    bool? NoBillNeeded = null);

/// <summary>A sister-firm group is not stored on its own: it is the set of parties that share a group name.</summary>
public sealed record SisterGroupDto(string Name, IReadOnlyList<string> Parties);

/// <param name="OriginalName">The group being edited or renamed; null to create a new group.</param>
/// <param name="Parties">Exactly the parties that belong to the group afterwards; parties left out of it lose the group.</param>
public sealed record SisterGroupInput(string? OriginalName, string? Name, IReadOnlyList<string>? Parties);

/// <param name="OriginalFinish">The finish being edited when the finish itself is changed; null to add a rate.</param>
public sealed record RateInput(string? Party, string? Finish, string? OriginalFinish, decimal? Rate);

public sealed record FinishDto(string Name, bool Active, string Group, string Color, IReadOnlyList<string> Fallback, int Entries, int RatedBy);

public sealed record FinishInput(string? OriginalName, string? Name, bool Active, string? Group, string? Color, IReadOnlyList<string>? Fallback);

public sealed record GroupDto(string Name, bool Active, int Finishes);

public sealed record GroupInput(string? OriginalName, string? Name, bool Active);

public sealed record StyleDto(
    string Name,
    string Description,
    ColumnContent GpnColumn,
    ColumnContent DnColumn,
    ColumnContent LotColumn,
    LineGrouping Lines,
    LineOrder Order,
    bool ShowQuantityBreakdown,
    bool CombineSmallEntries,
    int Parties);

public sealed record StyleInput(
    string? OriginalName,
    string? Name,
    string? Description,
    ColumnContent GpnColumn,
    ColumnContent DnColumn,
    ColumnContent LotColumn,
    LineGrouping Lines,
    LineOrder Order,
    bool ShowQuantityBreakdown,
    bool CombineSmallEntries);

public sealed record ColorDto(string Name, string Hex, int Parties, int Finishes);

public sealed record ColorInput(string? OriginalName, string? Name, string? Hex);

public sealed record FullMastersDto(
    IReadOnlyList<PartyDto> Parties,
    IReadOnlyList<FinishDto> Finishes,
    IReadOnlyList<GroupDto> Groups,
    IReadOnlyList<StyleDto> Styles,
    IReadOnlyList<ColorDto> Colors);

/// <summary>A lorry wala of the Aawak register, with how often it was used.</summary>
public sealed record TransporterDto(string Name, bool Active, IReadOnlyList<string> OtherSpellings, bool OwnVehicle, int Arrivals, string? LastArrival);

/// <param name="OriginalName">The lorry wala being edited or renamed; null to add one.</param>
/// <param name="Merge">Renaming to another lorry wala's name merges the two (its Aawak rows and spellings move over).</param>
public sealed record TransporterInput(string? OriginalName, string? Name, bool Active, IReadOnlyList<string>? OtherSpellings, bool OwnVehicle, bool Merge = false);
