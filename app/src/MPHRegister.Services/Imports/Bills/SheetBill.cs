using MPHRegister.Contracts.Billing;

namespace MPHRegister.Services.Imports.Bills;

public sealed record SheetBill(
    string Cell,
    string InvoiceNo,
    string Fy,
    int Serial,
    string PartyText,
    string Address,
    string State,
    string Gstin,
    string BillDate,
    string PeriodFrom,
    string PeriodTo,
    IReadOnlyList<LineDto> Lines,
    long Gross,
    long Discount,
    long Taxable,
    long Cgst,
    long Sgst,
    long Total,
    decimal? CgstRate,
    decimal? SgstRate);

/// <summary>A row of the bill workbook's Details sheet (party master as it was for that month).</summary>
public sealed record SheetParty(
    string Name,
    string Address,
    string State,
    string Gstin,
    decimal? Discount,
    bool Active,
    string Color,
    IReadOnlyDictionary<string, decimal> Rates);

public sealed record BillSheet(IReadOnlyList<SheetBill> Bills, IReadOnlyDictionary<string, SheetParty> Parties, IReadOnlyList<string> Errors);
