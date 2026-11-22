using MPHRegister.Contracts.Billing;
using MPHRegister.Contracts.Entries;
using MPHRegister.Contracts.Masters;
using MPHRegister.Contracts.Settings;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Billing;

public sealed record BillTotals(IReadOnlyList<LineDto> Lines, long Gross, long Discount, long Taxable, long Cgst, long Sgst, long Igst, long Total, int Than);

/// <summary>Bill arithmetic exactly as the Excel bill: each amount ROUND(rate × THAN, 0), discount and each tax rounded separately.</summary>
public static class BillCalculator
{
    public static BillTotals Totals(IReadOnlyList<LineDto> input, decimal discountPct, TaxMode mode, decimal cgstRate, decimal sgstRate, decimal igstRate)
    {
        ArgumentNullException.ThrowIfNull(input);
        var lines = new List<LineDto>(input.Count);
        var runQty = 0;
        var runDetails = 0;
        foreach (var raw in input)
        {
            var line = raw with { Gpn = raw.Gpn ?? string.Empty, Dn = raw.Dn ?? string.Empty, Lot = raw.Lot ?? string.Empty, Finish = raw.Finish ?? string.Empty, EntryIds = raw.EntryIds ?? [] };
            switch (line.Kind)
            {
                case LineKind.Blank:
                    runQty = 0;
                    runDetails = 0;
                    lines.Add(line with { Qty = null, Rate = null, Amount = null, AutoSum = false });
                    break;
                case LineKind.Detail:
                    runQty += line.Qty ?? 0;
                    runDetails++;
                    lines.Add(line with { Rate = null, Amount = null, AutoSum = false });
                    break;
                default:
                    var autoSum = line.AutoSum && runDetails > 0;
                    var qty = autoSum ? runQty : line.Qty ?? 0;
                    var amount = line.Rate is { } rate ? Money.RoundRupee(rate * qty) : (long?)null;
                    lines.Add(line with { Qty = qty, Amount = amount, AutoSum = autoSum });
                    runQty = 0;
                    runDetails = 0;
                    break;
            }
        }
        var gross = lines.Sum(l => l.Amount ?? 0);
        var discount = Money.RoundRupee(gross * discountPct / 100m);
        var taxable = gross - discount;
        long cgst = 0, sgst = 0, igst = 0;
        if (mode == TaxMode.Inter)
        {
            igst = Money.RoundRupee(taxable * igstRate / 100m);
        }
        else
        {
            cgst = Money.RoundRupee(taxable * cgstRate / 100m);
            sgst = Money.RoundRupee(taxable * sgstRate / 100m);
        }
        var than = lines.Where(l => l.Kind == LineKind.Priced).Sum(l => l.Qty ?? 0);
        return new BillTotals(lines, gross, discount, taxable, cgst, sgst, igst, taxable + cgst + sgst + igst, than);
    }

    public static BillTotals Totals(IReadOnlyList<LineDto> lines, decimal discountPct, TaxMode mode, FirmSettings firm)
    {
        ArgumentNullException.ThrowIfNull(firm);
        return Totals(lines, discountPct, mode, firm.CgstRate, firm.SgstRate, firm.IgstRate);
    }

    public static decimal SmallestFont(FirmSettings bill, FirmSettings current)
    {
        ArgumentNullException.ThrowIfNull(bill);
        ArgumentNullException.ThrowIfNull(current);
        return bill.SmallestFontPt ?? current.SmallestFontPt ?? new PrintSettings().SmallestFontPt;
    }

    /// <summary>Why the lines do not fit on one printed bill, or null when they do.</summary>
    public static string? RowsProblem(IReadOnlyList<LineDto> lines, int rowsPerBill, string label = "")
    {
        ArgumentNullException.ThrowIfNull(lines);
        var rows = lines.Sum(l => Math.Max(1, l.Rows));
        if (rows <= rowsPerBill) return null;
        var tall = lines.Select((l, i) => (Line: l, Number: i + 1)).Where(x => x.Line.Rows > 1).Select(x => x.Number).ToList();
        var why = string.Empty;
        if (tall.Count == 1)
        {
            why = $" (line {tall[0]} has a long lot or D.N. list and takes 2 rows or more)";
        }
        else if (tall.Count > 1)
        {
            why = $" (lines {string.Join(", ", tall)} have a long lot or D.N. list and take 2 rows or more)";
        }
        return $"{label}needs {rows} printed rows{why}; a bill holds {rowsPerBill}. Remove or merge lines, or move some to another bill.";
    }

    /// <summary>Fills totals, words, printed rows and warnings on a draft or edited bill.</summary>
    public static InvoiceDoc Complete(InvoiceDoc doc, PartyDto? party, IReadOnlyList<EntryDto>? entries, FirmSettings firm, BillLineSizer sizer)
    {
        ArgumentNullException.ThrowIfNull(doc);
        ArgumentNullException.ThrowIfNull(firm);
        ArgumentNullException.ThrowIfNull(sizer);
        var bill = doc.Firm ?? firm;
        var smallest = SmallestFont(bill, firm);
        var totals = Totals(doc.Lines, doc.DiscountPct, doc.TaxMode, doc.CgstRate, doc.SgstRate, doc.IgstRate);
        var t = totals with { Lines = totals.Lines.Select(l => l with { Rows = sizer.RowsFor(l, smallest) }).ToList() };
        var warnings = new List<string>();
        foreach (var finish in t.Lines.Where(l => l.Kind == LineKind.Priced && l.Rate is null).Select(l => l.Finish).Distinct())
            warnings.Add($"No rate for {(finish!.Length > 0 ? finish : "a priced line")} — enter the rate.");
        if (t.Lines.Any(l => l.Kind == LineKind.Priced && string.IsNullOrWhiteSpace(l.Finish))) warnings.Add("A priced line has no FINISH.");
        if (doc.Gstin.Length == 0) warnings.Add("Party has no GSTIN.");
        else if (!Gstin.IsValid(doc.Gstin)) warnings.Add($"Party GSTIN {doc.Gstin} is not valid — fix it in Masters.");
        if (party is { Discount: null }) warnings.Add("Party has no discount set (0% used).");
        if (party is { Active: false }) warnings.Add("Party is marked inactive.");
        if (bill.InvoiceLimit > 0 && t.Total >= bill.InvoiceLimit)
            warnings.Add($"Bill total is {IndianNumbers.Rupees(t.Total)}, not below the {IndianNumbers.Rupees(bill.InvoiceLimit)} limit — split it.");
        if (RowsProblem(t.Lines, bill.RowsPerInvoice, "Bill ") is { } rowsProblem) warnings.Add(rowsProblem);
        if (doc.TaxMode == TaxMode.Inter) warnings.Add("Party is outside the home state — IGST applies.");
        if (entries is not null)
        {
            var ids = t.Lines.SelectMany(l => l.EntryIds ?? []).ToHashSet();
            var notSent = entries.Where(e => ids.Contains(e.Id) && e.Dispatched == 0).ToList();
            var partly = entries.Where(e => ids.Contains(e.Id) && e.Dispatched > 0 && e.Dispatched < e.Nag + e.TwoPart).ToList();
            if (notSent.Count > 0) warnings.Add($"{Entries(notSent.Count)} billed before dispatch (INW. NO. {string.Join(", ", notSent.Select(e => e.InwardNo))}).");
            if (partly.Count > 0) warnings.Add($"{Entries(partly.Count)} only partly dispatched (INW. NO. {string.Join(", ", partly.Select(e => e.InwardNo))}).");
            var billedQty = t.Lines.Where(l => l.EntryIds is { Count: > 0 }).Sum(l => l.Qty ?? 0);
            var entryQty = entries.Where(e => ids.Contains(e.Id)).Sum(e => e.NettThan);
            if (ids.Count > 0 && billedQty != entryQty)
                warnings.Add($"THAN on the bill ({IndianNumbers.Format(billedQty)}) differs from NETT THAN of its entries ({IndianNumbers.Format(entryQty)}) — fine if some THAN went back unfinished.");
        }
        return doc with
        {
            Lines = t.Lines,
            Gross = t.Gross,
            Discount = t.Discount,
            Taxable = t.Taxable,
            Cgst = t.Cgst,
            Sgst = t.Sgst,
            Igst = t.Igst,
            Total = t.Total,
            Than = t.Than,
            AmountInWords = RupeeWords.Format(t.Total),
            Warnings = warnings,
            Firm = bill,
        };
    }

    private static string Entries(int count) => count == 1 ? "1 entry is" : $"{count} entries are";
}
