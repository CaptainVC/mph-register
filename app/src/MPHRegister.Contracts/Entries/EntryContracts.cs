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
    bool NoBillNeeded = false);

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

/// <summary>The entry just deleted, and notes about what still refers to it.</summary>
public sealed record DeleteEntryResult(DeletedEntryDto Deleted, IReadOnlyList<string> Notes);
