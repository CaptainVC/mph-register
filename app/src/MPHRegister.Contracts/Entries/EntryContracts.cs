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
