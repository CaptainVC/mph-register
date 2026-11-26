using MPHRegister.Shared.Enums;

namespace MPHRegister.Contracts.Entries;

public sealed record DispatchInput(int? Qty, string? GatePass, string? Date);

public sealed record EntryInput(
    string? RegisterMonth,
    int? InwardNo,
    string? EntryDate,
    string? Party,
    string? DesignNo,
    string? LotNo,
    bool Repair,
    int? Than,
    int? Tp,
    int? TwoPart,
    string? Finish,
    int? ShortThan,
    IReadOnlyList<DispatchInput>? Dispatches);

public sealed record DispatchDto(int Qty, string GatePass, string? Date, string? DateText);

/// <summary>
/// What the latest import of a month's workbook did to the entry: <c>Action</c> "added" (a new row) or "updated" (the
/// workbook changed it; <c>Changes</c> says what, when known). <c>RegisterMonth</c> is the imported month: a later month's
/// carryover rows can update an earlier month's entry.
/// </summary>
public sealed record ImportMarkDto(string Action, string FileName, string ImportedAt, string RegisterMonth, string Changes);

public sealed record EntryDto(
    long Id,
    string RegisterMonth,
    int InwardNo,
    string EntryDate,
    string Party,
    string DesignNo,
    string LotNo,
    bool Repair,
    int Than,
    int Tp,
    int Nag,
    string Finish,
    int NettThan,
    int TwoPart,
    int? ShortThan,
    bool CarriedOver,
    bool Imported,
    int? SourceRow,
    IReadOnlyList<DispatchDto> Dispatches,
    int Dispatched,
    int Balance,
    EntryStatus Status,
    IReadOnlyList<string> Warnings,
    string? BilledIn,
    bool NoBillNeeded = false,
    ImportMarkDto? LastImport = null,
    IReadOnlyList<EntryArrivalDto>? Aawak = null,
    string AawakState = "",
    IReadOnlyList<EntryLinkDto>? Links = null,
    string? ImportUpdatedAt = null,
    int NettLess = 0);

/// <summary>An Aawak row the entry came on.</summary>
public sealed record EntryArrivalDto(long Id, string AawakMonth, string Number, string ArrivalDate, string Transporter, int Nag);

/// <summary>Whether an entry has its Aawak row: found, none found, not needed (marked), or not checked (empty).</summary>
public static class EntryAawakState
{
    public const string Found = "found";
    public const string None = "none";
    public const string NotNeeded = "notNeeded";
    public const string NotChecked = "";
}

/// <summary>
/// The other end of an all-zero slip's D.N.: an <c>earlier</c> link goes from the zero slip to the entry its D.N. names,
/// a <c>later</c> link from that entry back to the zero slip. <c>EntryId</c> is the entry at the other end (empty when
/// <c>State</c> is <c>notFound</c>; <c>InwardNo</c> is then the number looked for).
/// </summary>
public sealed record EntryLinkDto(string Direction, string State, long? EntryId, int InwardNo, string? RegisterMonth, string? EntryDate, string? Party, int Than);

public static class EntryLinkDirection
{
    public const string Earlier = "earlier";
    public const string Later = "later";
}

/// <summary>Found with the same firm, found under another party (probably a typing mistake), or no such slip before the month.</summary>
public static class EntryLinkState
{
    public const string Found = "found";
    public const string OtherParty = "otherParty";
    public const string NotFound = "notFound";
}

public sealed record MonthSummary(string Month, int Entries);

public sealed record NextInwardDto(string Month, int Next);

/// <summary>
/// Whether a deleted entry can go back now. <c>Clashes</c> stop it (its INW. NO. or slip is in use again, its party or finish
/// left the lists); <c>Warnings</c> only ask the user to check (another entry looks the same).
/// </summary>
public sealed record EntryRestoreCheck(bool Allowed, IReadOnlyList<string> Clashes, IReadOnlyList<string> Warnings);

/// <summary>An entry deleted in the app, kept so it can be restored.</summary>
public sealed record DeletedEntryDto(
    long Id,
    string RegisterMonth,
    int InwardNo,
    string EntryDate,
    string Party,
    string DesignNo,
    string LotNo,
    bool Repair,
    int Than,
    int Tp,
    int TwoPart,
    string Finish,
    bool CarriedOver,
    bool Imported,
    int Dispatches,
    string DeletedAt,
    EntryRestoreCheck Restore);

/// <summary>How many deleted entries were removed for good.</summary>
public sealed record PurgeDeletedResult(int Removed);

/// <summary>The entry just deleted, and notes about what still refers to it.</summary>
public sealed record DeleteEntryResult(DeletedEntryDto Deleted, IReadOnlyList<string> Notes);
