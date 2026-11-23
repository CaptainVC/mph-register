using MPHRegister.Contracts.Imports;

namespace MPHRegister.Contracts.Arrivals;

/// <param name="AawakMonth">yyyy-MM; empty uses the month of <paramref name="ArrivalDate"/>.</param>
/// <param name="AawakNo">"217" or "217A"; empty takes the month's next number.</param>
/// <param name="InwardText">The slips as written: "12-14", "13 TO 17", "7 TO 11,13".</param>
public sealed record ArrivalInput(
    string? AawakMonth,
    string? AawakNo,
    string? ArrivalDate,
    string? Party,
    int? Nag,
    string? Transporter,
    string? InwardText,
    string? Note);

/// <summary>
/// An inward entry that came on the arrival. <c>Nag</c> is what came on this arrival: <c>Share</c> when the slip came in two
/// loads, else the entry's whole NAG (THAN + TP).
/// </summary>
public sealed record ArrivalSlipDto(
    long EntryId,
    string RegisterMonth,
    int InwardNo,
    string EntryDate,
    string Party,
    int Nag,
    int EntryNag,
    int? Share,
    bool Manual,
    bool Deleted,
    bool SisterFirm);

public sealed record ArrivalImportMarkDto(string Action, string FileName, string ImportedAt, string Changes);

/// <summary>Arrival statuses: every slip found and NAG matches, NAG differs, some numbers not found yet, nothing linked.</summary>
public static class ArrivalStatus
{
    public const string Linked = "linked";
    public const string NagDiffers = "nagDiffers";
    public const string PartlyLinked = "partlyLinked";
    public const string NotLinked = "notLinked";
}

/// <param name="Number">AAWAK NO as written ("217A").</param>
/// <param name="Group">The party's sister-firm group, or the party itself.</param>
/// <param name="Refs">The slip numbers the arrival names.</param>
/// <param name="Missing">Named numbers with no inward entry found (yet).</param>
public sealed record ArrivalDto(
    long Id,
    string AawakMonth,
    int AawakNo,
    string AawakSuffix,
    string Number,
    string ArrivalDate,
    string Party,
    string Group,
    int Nag,
    string Transporter,
    string InwardText,
    string Note,
    IReadOnlyList<int> Refs,
    IReadOnlyList<ArrivalSlipDto> Slips,
    IReadOnlyList<int> Missing,
    int SlipsNag,
    string Status,
    IReadOnlyList<string> Warnings,
    bool Imported,
    ArrivalImportMarkDto? LastImport);

public sealed record AawakMonthDto(string Month, int Arrivals);

public sealed record NextAawakDto(string Month, int Next);

/// <summary>A slip number with more than one entry that could be it (none was picked).</summary>
public sealed record SlipChoiceDto(int InwardNo, IReadOnlyList<ArrivalSlipDto> Entries);

/// <summary>
/// The slips an arrival being typed would link to. <c>Suggestion</c> is another reading of the numbers ("237-240") when that
/// one matches the NAG and the text as typed does not.
/// </summary>
public sealed record SlipPreviewDto(
    IReadOnlyList<int> Numbers,
    IReadOnlyList<ArrivalSlipDto> Found,
    IReadOnlyList<int> Missing,
    IReadOnlyList<SlipChoiceDto> Choices,
    int SlipsNag,
    string Status,
    string? Suggestion,
    string Group);

public sealed record ArrivalLinkInput(long EntryId, int? Nag);

public sealed record DeletedArrivalDto(
    long Id,
    string AawakMonth,
    string Number,
    string ArrivalDate,
    string Party,
    int Nag,
    string Transporter,
    string InwardText,
    bool Imported,
    string DeletedAt,
    bool CanRestore,
    IReadOnlyList<string> Problems);

public sealed record DeleteArrivalResult(DeletedArrivalDto Deleted, IReadOnlyList<string> Notes);

/// <summary>An arrival of the same firm or its sister firms around a slip's date, with NAG not yet matched to slips.</summary>
public sealed record ArrivalCandidateDto(long Id, string AawakMonth, string Number, string ArrivalDate, string Party, string Transporter, int Nag, int FreeNag, string InwardText);

public sealed record NoArrivalInput(string? Note);

public sealed record RelinkResult(int Arrivals, int Linked, int NagDiffers, int PartlyLinked, int NotLinked);

public sealed record ArrivalTotalLine(string Name, bool IsGroup, IReadOnlyList<string> Members, int Arrivals, int Nag);

public sealed record ArrivalDayTotal(string Date, int Arrivals, int Nag);

public sealed record ArrivalMatrixCell(string Transporter, string Party, int Nag);

/// <param name="Order">"nag" (most NAG first) or "first" (in order of first arrival, as the workbook's Total sheet).</param>
public sealed record ArrivalTotalsDto(
    string From,
    string To,
    bool GroupSisters,
    string Order,
    int Arrivals,
    int Nag,
    IReadOnlyList<ArrivalTotalLine> Parties,
    IReadOnlyList<ArrivalTotalLine> Transporters,
    IReadOnlyList<ArrivalDayTotal> Days,
    IReadOnlyList<ArrivalMatrixCell> Matrix);

/// <summary>One lorry wala's arrivals in a period, for the printed statement.</summary>
public sealed record ArrivalStatementDto(string From, string To, string Transporter, int Nag, IReadOnlyList<ArrivalDto> Arrivals);

public sealed record SlipWithoutArrivalDto(long EntryId, string RegisterMonth, int InwardNo, string EntryDate, string Party, int Nag);

/// <summary>A slip on more than one arrival whose NAG adds up to more than the slip has.</summary>
public sealed record OverlinkedSlipDto(long EntryId, string RegisterMonth, int InwardNo, string EntryDate, string Party, int Nag, int ArrivedNag, IReadOnlyList<long> ArrivalIds, IReadOnlyList<string> Numbers);

/// <param name="CheckSlipsFrom">Slips dated before this day are not checked for an AAWAK row (null: no AAWAK rows yet).</param>
public sealed record ArrivalCheckDto(
    string From,
    string To,
    string? CheckSlipsFrom,
    IReadOnlyList<ArrivalDto> NotLinked,
    IReadOnlyList<ArrivalDto> NagDiffers,
    IReadOnlyList<SlipWithoutArrivalDto> SlipsWithout,
    IReadOnlyList<OverlinkedSlipDto> Overlinked);

/// <summary>A party group read from the workbook's Details sheet, given to a party that has none (when ticked).</summary>
public sealed record GroupProposal(string Party, string Group, string CurrentGroup, bool Applied);

public sealed record ArrivalLinkSummary(int Linked, int NagDiffers, int PartlyLinked, int NotLinked);

/// <summary>
/// The check (or result) of importing an AAWAK workbook. Into a month that already has rows it is an update: rows are matched
/// by AAWAK NO, what changed in the workbook since the last import is applied and what was changed in the app is kept.
/// </summary>
public sealed record AawakImportReport(
    bool Imported,
    string FileName,
    string AawakMonth,
    int Rows,
    int Nag,
    int Added,
    int Updated,
    int Unchanged,
    int Removed,
    int KeptDeleted,
    int KeptTyped,
    bool UpToDate,
    IReadOnlyList<string> AddedParties,
    IReadOnlyList<string> AddedTransporters,
    IReadOnlyList<GroupProposal> Groups,
    IReadOnlyList<ImportIssue> Changes,
    IReadOnlyList<ImportIssue> Kept,
    IReadOnlyList<ImportIssue> NotInWorkbook,
    IReadOnlyList<ImportIssue> Warnings,
    IReadOnlyList<ImportIssue> Errors,
    ArrivalLinkSummary? Links);
