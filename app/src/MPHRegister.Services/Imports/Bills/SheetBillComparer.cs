using System.Globalization;
using MPHRegister.Contracts.Billing;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Imports.Bills;

/// <summary>
/// Compares a bill read from the bill workbook with a bill in the app: party, dates, address, lines and totals. Used to
/// tell whether the workbook already has the app's bill (export) and whether an imported bill is one the app already has.
/// </summary>
public static class SheetBillComparer
{
    private const int ShownLines = 3;

    /// <summary>What differs, in words ("Total: workbook ₹1,050, app ₹1,100"); empty when they are the same bill.</summary>
    public static List<string> Differences(SheetBill sheet, InvoiceDoc app)
    {
        ArgumentNullException.ThrowIfNull(sheet);
        ArgumentNullException.ThrowIfNull(app);
        var found = new List<string>();
        void Text(string what, string? workbook, string? inApp)
        {
            if (!string.Equals((workbook ?? string.Empty).NormalizeName(), (inApp ?? string.Empty).NormalizeName(), StringComparison.OrdinalIgnoreCase))
                found.Add($"{what}: workbook \"{workbook}\", app \"{inApp}\"");
        }
        void Money(string what, long workbook, long inApp)
        {
            if (workbook != inApp) found.Add($"{what}: workbook {IndianNumbers.Rupees(workbook)}, app {IndianNumbers.Rupees(inApp)}");
        }
        Text("Bill no.", sheet.InvoiceNo, app.InvoiceNo);
        Text("Party", sheet.PartyText, app.PartyName);
        Text("Bill date", Dot(sheet.BillDate), Dot(app.BillDate));
        Text("Period", $"{Dot(sheet.PeriodFrom)} TO {Dot(sheet.PeriodTo)}", $"{Dot(app.PeriodFrom)} TO {Dot(app.PeriodTo)}");
        Text("Address", sheet.Address, app.Address);
        Text("State", sheet.State, app.State);
        Text("GSTIN", sheet.Gstin, app.Gstin);
        found.AddRange(LineDifferences(sheet.Lines, app.Lines));
        Money("Gross", sheet.Gross, app.Gross);
        Money("Discount", sheet.Discount, app.Discount);
        Money("Taxable", sheet.Taxable, app.Taxable);
        Money("CGST", sheet.Cgst, app.Cgst);
        Money("SGST", sheet.Sgst, app.Sgst);
        Money("Total", sheet.Total, app.Total);
        if (Rate(sheet.CgstRate) != Rate(app.CgstRate) || Rate(sheet.SgstRate) != Rate(app.SgstRate))
            found.Add($"CGST / SGST rate: workbook {Percent(sheet.CgstRate)} / {Percent(sheet.SgstRate)}, app {Percent(app.CgstRate)} / {Percent(app.SgstRate)}");
        return found;
    }

    /// <summary>Lines without the blank ones at the end (the workbook has no way to show them).</summary>
    public static List<LineDto> Trimmed(IReadOnlyList<LineDto> lines)
    {
        ArgumentNullException.ThrowIfNull(lines);
        var list = lines.ToList();
        while (list.Count > 0 && list[^1].Kind == LineKind.Blank) list.RemoveAt(list.Count - 1);
        return list;
    }

    private static List<string> LineDifferences(IReadOnlyList<LineDto> sheetLines, IReadOnlyList<LineDto> appLines)
    {
        var sheet = BillLineLayout.Compact(sheetLines);
        var app = BillLineLayout.Compact(appLines);
        var found = new List<string>();
        if (sheet.Count != app.Count) found.Add($"Lines: workbook {sheet.Count}, app {app.Count}");
        var differing = Enumerable.Range(0, Math.Min(sheet.Count, app.Count)).Where(i => Key(sheet[i]) != Key(app[i])).ToList();
        found.AddRange(differing.Take(ShownLines).Select(i => $"Line {i + 1}: workbook {Shown(sheet[i])}, app {Shown(app[i])}"));
        if (differing.Count > ShownLines) found.Add($"…and {differing.Count - ShownLines} more lines differ");
        return found;
    }

    private static string Key(LineDto line) => line.Kind switch
    {
        LineKind.Blank => "blank",
        LineKind.Detail => $"detail|{Norm(line.Gpn)}|{Norm(line.Dn)}|{Norm(line.Lot)}|{line.Qty ?? 0}",
        _ => $"priced|{Norm(line.Gpn)}|{Norm(line.Dn)}|{Norm(line.Lot)}|{Norm(line.Finish)}|{line.Qty ?? 0}|{Rate(line.Rate)}",
    };

    private static string Shown(LineDto line)
    {
        if (line.Kind == LineKind.Blank) return "(blank row)";
        var parts = new[] { line.Gpn, line.Dn, line.Lot, line.Finish }.Select(p => (p ?? string.Empty).Trim()).Where(p => p.Length > 0).ToList();
        parts.Add($"{line.Qty ?? 0} THAN");
        if (line.Kind == LineKind.Priced) parts.Add(line.Rate is { } rate ? $"rate {rate.ToString("0.####", CultureInfo.InvariantCulture)}" : "no rate");
        return string.Join(" · ", parts);
    }

    private static string Norm(string? text) => (text ?? string.Empty).NormalizeName().ToUpperInvariant();

    private static string Rate(decimal? rate) => rate is { } r ? Math.Round(r, 6).ToString("0.######", CultureInfo.InvariantCulture) : "-";

    private static string Percent(decimal? rate) => rate is { } r ? $"{r.ToString("0.##", CultureInfo.InvariantCulture)}%" : "none";

    private static string Dot(string iso) => Dates.TryParseIso(iso, out var date) ? date.ToString("dd.MM.yy", CultureInfo.InvariantCulture) : iso;
}
