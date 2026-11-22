namespace MPHRegister.Contracts.Imports;

public sealed record ImportIssue(int Row, string Message);

/// <summary>
/// The check (or result) of importing an inward workbook. When the month already has entries (<see cref="SavedEntries"/>
/// above 0) the import updates them: <see cref="Changes"/> lists what the workbook changes, <see cref="Kept"/> the values
/// kept as they are in the app and <see cref="NotInWorkbook"/> the saved entries the workbook no longer has.
/// </summary>
public sealed record ImportReport(
    bool Imported,
    string FileName,
    string RegisterMonth,
    int Entries,
    int Dispatches,
    int CarriedOver,
    int Than,
    int Tp,
    int Nag,
    int NettThan,
    int TwoPart,
    int Dispatched,
    int MergedCarryovers,
    IReadOnlyList<string> AddedParties,
    IReadOnlyList<string> AddedFinishes,
    IReadOnlyList<ImportIssue> Warnings,
    IReadOnlyList<ImportIssue> Errors,
    int SavedEntries,
    int UpdatedEntries,
    int UnchangedEntries,
    int RemovedEntries,
    bool UpToDate,
    IReadOnlyList<ImportIssue> Changes,
    IReadOnlyList<ImportIssue> Kept,
    IReadOnlyList<ImportIssue> NotInWorkbook);

public sealed record BillImportInvoice(
    string InvoiceNo,
    string Party,
    string BillDate,
    string Cell,
    int Lines,
    int Matched,
    int Unmatched,
    long SheetTotal,
    long AppTotal,
    IReadOnlyList<string> Problems);

public sealed record BillImportLine(string InvoiceNo, int Row, string Party, string Gpn, string Dn, string Lot, string Finish, int Qty);

public sealed record LeftoverEntry(
    long EntryId,
    string Party,
    string RegisterMonth,
    int InwardNo,
    string DesignNo,
    string LotNo,
    string Finish,
    int NettThan,
    string DispatchState);

/// <summary>A bill line that matches the inward entries of a party this bill's party does not bill (not linked).</summary>
public sealed record BillLinkSuggestion(string InvoiceNo, int Row, string BillParty, string EntryParty, string RegisterMonth, IReadOnlyList<int> InwardNos, int Qty);

public sealed record BillImportReport(
    bool Imported,
    string FileName,
    int Invoices,
    long Total,
    int LinkedEntries,
    IReadOnlyList<string> AddedParties,
    IReadOnlyList<BillImportInvoice> Bills,
    IReadOnlyList<BillImportLine> UnmatchedLines,
    IReadOnlyList<LeftoverEntry> Leftovers,
    IReadOnlyList<string> Errors,
    IReadOnlyList<string> Warnings,
    IReadOnlyList<BillLinkSuggestion> Suggestions,
    int AlreadyInApp = 0);

public sealed record RelinkRequest(bool Commit);

/// <summary>Bills imported from Excel matched again to the inward register with the current matching rules and party groups.</summary>
/// <param name="Saved">True when the new links were saved.</param>
/// <param name="Bills">Bills imported from Excel that were checked.</param>
/// <param name="ChangedBills">Bills whose links change.</param>
/// <param name="LinkedBefore">Inward entries linked to these bills before.</param>
/// <param name="LinkedAfter">Inward entries linked to them with the new links.</param>
/// <param name="UnmatchedBefore">Bill lines without any linked entry before.</param>
/// <param name="UnmatchedAfter">Bill lines without any linked entry with the new links.</param>
/// <param name="NoLongerLinked">Entries that were linked before but no bill line points at them now (they show as unbilled again).</param>
public sealed record BillRelinkReport(
    bool Saved,
    int Bills,
    int ChangedBills,
    int LinkedBefore,
    int LinkedAfter,
    int UnmatchedBefore,
    int UnmatchedAfter,
    IReadOnlyList<BillImportLine> UnmatchedLines,
    IReadOnlyList<LeftoverEntry> NoLongerLinked,
    IReadOnlyList<BillLinkSuggestion> Suggestions,
    IReadOnlyList<string> Warnings);
