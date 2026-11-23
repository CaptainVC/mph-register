using MPHRegister.Contracts.Settings;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Enums;

namespace MPHRegister.Contracts.Billing;

public sealed record CandidateDto(
    long EntryId,
    string RegisterMonth,
    int InwardNo,
    string EntryDate,
    string Party,
    string DesignNo,
    string LotNo,
    string Finish,
    string BillFinish,
    int NettThan,
    int Nag,
    int Dispatched,
    int Available,
    DispatchState DispatchState,
    string GatePasses,
    string? LastDispatch,
    bool CarriedOver,
    bool Selected,
    decimal? Rate);

/// <param name="Count">How many bills the entries ticked to start with make (what <c>POST /api/billing/count</c> answers for them);
/// null when none is ticked or no bill is needed.</param>
public sealed record CandidatesDto(
    string BillParty,
    IReadOnlyList<string> SourceParties,
    BillingStyle Style,
    bool BillBeforeDispatch,
    decimal? Discount,
    string Gstin,
    bool Active,
    IReadOnlyList<string> Problems,
    IReadOnlyList<CandidateDto> Entries,
    IReadOnlyList<string> BillRecipients,
    bool NoBillNeeded = false,
    int? Count = null);

/// <summary>A bill month and how many bills (saved or cancelled) it has.</summary>
public sealed record BillMonthDto(string Month, int Bills);

public sealed record PartyToBillDto(string Party, int Entries, int NettThan, int NotDispatched);

/// <param name="Rows">Printed rows the line takes: 2 or 3 when its lot / D.N. list is too long for one row even in the smallest font.</param>
public sealed record LineDto(
    LineKind Kind,
    string? Gpn,
    string? Dn,
    string? Lot,
    string? Finish,
    int? Qty,
    decimal? Rate,
    long? Amount,
    bool AutoSum,
    IReadOnlyList<long>? EntryIds,
    int Rows = 1);

public sealed record InvoiceDoc(
    long? Id,
    string? InvoiceNo,
    string Party,
    string PartyName,
    string Address,
    string State,
    string Gstin,
    string BillDate,
    string PeriodFrom,
    string PeriodTo,
    decimal DiscountPct,
    TaxMode TaxMode,
    decimal CgstRate,
    decimal SgstRate,
    decimal IgstRate,
    long Gross,
    long Discount,
    long Taxable,
    long Cgst,
    long Sgst,
    long Igst,
    long Total,
    int Than,
    InvoiceStatus Status,
    InvoiceSource Source,
    string Notes,
    string AmountInWords,
    IReadOnlyList<LineDto> Lines,
    IReadOnlyList<string> Warnings,
    FirmSettings? Firm,
    string? CreatedAt,
    string? UpdatedAt)
{
    public InvoiceUndoAvailability? UndoSave { get; init; }

    public InvoiceRestoreAvailability? Restore { get; init; }
}

/// <summary>Whether a cancelled bill can go back to saved, and if not, which entries are in the way.</summary>
public sealed record InvoiceRestoreAvailability(bool Allowed, string? Reason);

/// <summary>Whether a saved bill's number can be released, with a token identifying the bill being confirmed.</summary>
public sealed record InvoiceUndoAvailability(bool Allowed, string? Reason, string? Token);

/// <summary>Explicit confirmation that the displayed bill was never issued, including its undo token.</summary>
public sealed record UndoInvoiceSaveRequest(bool NeverIssued, string? Token);

/// <summary>The undone bill and the next serial available in its financial year.</summary>
public sealed record UndoInvoiceSaveResult(string InvoiceNo, int NextSerial);

public sealed record InvoiceSummary(
    long Id,
    string InvoiceNo,
    string BillDate,
    string BillMonth,
    string Party,
    string PartyName,
    int Than,
    long Total,
    InvoiceStatus Status,
    InvoiceSource Source,
    string Finishes,
    int Entries,
    string? ExportedAt = null,
    string? ExportedTo = null,
    bool ChangedSinceExport = false,
    string Fy = "",
    int Serial = 0);

/// <param name="PeriodFrom">The period printed on the bill.</param>
/// <param name="EntriesFrom">The inward dates the ticked entries must fall in; the bill period when left out.</param>
public sealed record BillRequest(
    string? Party,
    string? Month,
    IReadOnlyList<long>? EntryIds,
    string? BillDate,
    string? PeriodFrom,
    string? PeriodTo,
    string? EntriesFrom = null,
    string? EntriesTo = null);

public sealed record CountBillsRequest(string? Party, IReadOnlyList<long>? EntryIds);

/// <param name="Serials">The bill number typed for each invoice, in the same order; a missing or null entry means the next free number.</param>
public sealed record SaveBillsRequest(IReadOnlyList<InvoiceDoc>? Invoices, IReadOnlyList<int?>? Serials = null);

/// <param name="Serial">The bill number the user typed, or null to take the next free number.</param>
public sealed record BillNumberAsk(string? BillDate, int? Serial);

public sealed record BillNumbersRequest(IReadOnlyList<BillNumberAsk>? Bills);

/// <summary>The number a draft bill will get and, when it cannot have it, why.</summary>
public sealed record BillNumberDto(string Fy, int Serial, string InvoiceNo, string? Problem);

public sealed record InvoiceEdit(
    string? BillDate,
    string? PeriodFrom,
    string? PeriodTo,
    string? Notes,
    bool RefreshParty,
    IReadOnlyList<LineDto>? Lines);

public sealed record ElsewhereRequest(IReadOnlyList<long>? EntryIds, string? Note, bool Undo);

public sealed record ElsewhereResult(int Changed);

public sealed record PdfRequest(IReadOnlyList<long>? Ids);
