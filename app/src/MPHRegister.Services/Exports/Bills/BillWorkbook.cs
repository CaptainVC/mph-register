using System.Globalization;
using System.Text.RegularExpressions;
using MPHRegister.Services.Imports;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Exports.Bills;

/// <summary>
/// The monthly bill workbook (MPH BILL--MMM.-YY-YY.xlsm) opened for writing bills into it: the Main sheet's 100 bill
/// places, their bill no. / date / period chains, the Details sheet, and what the bill formulas show.
/// </summary>
internal sealed partial class BillWorkbook
{
    private static readonly (int Row, int Column, string Label)[] LayoutLabels =
    [
        (BillSlot.HeaderRow, Col.A, "G.P.N."), (BillSlot.HeaderRow, Col.E, "THAN"), (BillSlot.HeaderRow, Col.G, "Amount(Rs.)"),
        (BillSlot.DiscountRow, Col.D, "Less/Discount"), (BillSlot.CgstRow, Col.D, "CGST"), (BillSlot.SgstRow, Col.D, "SGST"),
        (BillSlot.TotalRow, Col.E, "Invoice Total"),
    ];

    /// <summary>The first bill's formulas that every bill's amounts and totals must have (copied to each bill's place).</summary>
    private static readonly (int Row, string Formula)[] TotalFormulas =
    [
        (BillSlot.GrossRow, "SUBTOTAL(109,G13:G37)"), (BillSlot.TaxableRow, "IF(G39=\"\",0,G38-G39)"),
        (BillSlot.CgstRow, "ROUND(G40*F41,0)"), (BillSlot.SgstRow, "ROUND(G40*F42,0)"), (BillSlot.TotalRow, "SUM(G40:G42)"),
    ];

    private BillWorkbook(XlsxPackage package, string mainPart, SheetXml main, SharedStrings strings, DetailsSheet details)
    {
        Package = package;
        MainPart = mainPart;
        Main = main;
        Strings = strings;
        Details = details;
    }

    public XlsxPackage Package { get; }

    public string MainPart { get; }

    public SheetXml Main { get; }

    public SharedStrings Strings { get; }

    public DetailsSheet Details { get; }

    public WorkbookStyles? Styles { get; private init; }

    /// <summary>Opens the workbook; null when it has no Main sheet.</summary>
    public static BillWorkbook? Open(byte[] bytes)
    {
        var package = XlsxPackage.Open(bytes);
        var mainPart = package.SheetPart("Main");
        if (mainPart is null || !package.Has(mainPart)) return null;
        var stringsPart = package.WorkbookRelated("sharedStrings");
        var strings = new SharedStrings(stringsPart is not null && package.Has(stringsPart) ? package.Xml(stringsPart) : null);
        var detailsPart = package.SheetPart("Details");
        var details = DetailsSheet.From(detailsPart is not null && package.Has(detailsPart) ? new SheetXml(package.Xml(detailsPart), strings) : null);
        var stylesPart = package.WorkbookRelated("styles");
        return new BillWorkbook(package, mainPart, new SheetXml(package.Xml(mainPart), strings), strings, details)
        {
            Styles = stylesPart is not null && package.Has(stylesPart) ? new WorkbookStyles(package, stylesPart) : null,
        };
    }

    /// <summary>Why this does not look like the bill workbook (empty when every bill place has the bill layout).</summary>
    public List<string> LayoutProblems()
    {
        var problems = new List<string>();
        if (!Details.Exists) problems.Add("The workbook has no Details sheet.");
        if (Styles is null) problems.Add("The workbook has no cell styles.");
        foreach (var slot in BillSlot.All)
        {
            foreach (var (row, column, label) in LayoutLabels)
            {
                var text = Cell(slot, row, column).Text.Trim();
                if (!string.Equals(text, label, StringComparison.OrdinalIgnoreCase))
                {
                    problems.Add($"{slot.Ref(row, column)} should say \"{label}\" but says \"{text}\": this is not the bill workbook layout (100 bills of A1:G49).");
                    return problems;
                }
            }
        }
        return problems;
    }

    public CellContent Cell(BillSlot slot, int row, int column) => Main.Get(slot.Ref(row, column));

    /// <summary>A bill place with a party or anything in its line rows.</summary>
    public bool Filled(BillSlot slot)
    {
        if (!Cell(slot, BillSlot.PartyRow, Col.A).IsBlank) return true;
        for (var row = BillSlot.FirstLineRow; row <= BillSlot.LastLineRow; row++)
        {
            for (var column = Col.A; column <= Col.E; column++)
            {
                if (!Cell(slot, row, column).IsBlank) return true;
            }
        }
        return false;
    }

    /// <summary>The bill no. each place shows: typed in a place, or the previous place's number + 1 by formula.</summary>
    public string?[] Numbers()
    {
        var values = new string?[BillSlot.Count];
        foreach (var slot in BillSlot.All)
        {
            var cell = Cell(slot, BillSlot.NumberRow, Col.F);
            var previous = slot.Index == 0 ? null : values[slot.Index - 1];
            values[slot.Index] = cell.HasFormula && IsNumberLink(slot, cell.Formula!) ? Next(previous) : NullIfEmpty(cell.Text.Trim());
        }
        return values;
    }

    /// <summary>What each place's F8 (date) or F10 (period) shows: typed there, or copied from the place before by formula.</summary>
    public object?[] Copies(int row)
    {
        var values = new object?[BillSlot.Count];
        foreach (var slot in BillSlot.All)
        {
            var cell = Cell(slot, row, Col.F);
            var previous = slot.Index == 0 ? null : values[slot.Index - 1];
            values[slot.Index] = cell.HasFormula && IsCopyLink(slot, row, cell.Formula!) ? previous : cell.Value;
        }
        return values;
    }

    public bool IsLinked(BillSlot slot, int row)
    {
        var cell = Cell(slot, row, Col.F);
        if (!cell.HasFormula) return false;
        return row == BillSlot.NumberRow ? IsNumberLink(slot, cell.Formula!) : IsCopyLink(slot, row, cell.Formula!);
    }

    /// <summary>The bill-number formula: the previous place's number with 1 added after its second "\".</summary>
    private static bool IsNumberLink(BillSlot slot, string formula)
    {
        if (slot.Previous is not { } previous) return false;
        var refs = FormulaText.RelativeReferences(formula);
        return refs.Count == 1 && refs.Contains(previous.Ref(BillSlot.NumberRow, Col.F)) && FormulaText.Normalize(formula).Contains("+1", StringComparison.Ordinal);
    }

    private static bool IsCopyLink(BillSlot slot, int row, string formula) =>
        slot.Previous is { } previous && FormulaText.Normalize(formula) == previous.Ref(row, Col.F);

    /// <summary>As the bill-number formula: LEFT(no., up to the second "\") &amp; (the rest + 1).</summary>
    public static string? Next(string? previous)
    {
        if (previous is null) return null;
        var first = previous.IndexOf('\\', StringComparison.Ordinal);
        var second = first < 0 ? -1 : previous.IndexOf('\\', first + 1);
        if (second < 0) return null;
        return decimal.TryParse(previous[(second + 1)..].Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var n)
            ? previous[..(second + 1)] + (n + 1).ToString(CultureInfo.InvariantCulture)
            : null;
    }

    public static DateOnly? DateOf(object? value) => value switch
    {
        double d when d is > 1 and < 2958466 => DateOnly.FromDateTime(DateTime.FromOADate(d)),
        string s when ExcelCells.DotDate(s.Trim()) is { } iso => Dates.ParseIsoOrDefault(iso),
        _ => null,
    };

    public static (DateOnly? From, DateOnly? To) PeriodOf(object? value)
    {
        if (value is not string s) return (null, null);
        var parts = PeriodSplit().Split(s.Trim());
        return parts.Length == 2 ? (DateOf(parts[0]), DateOf(parts[1])) : (null, null);
    }

    public static string DotDate(DateOnly date) => date.ToString("dd.MM.yy", CultureInfo.InvariantCulture);

    public static string PeriodText(DateOnly from, DateOnly to) => $"{DotDate(from)} TO {DotDate(to)}";

    /// <summary>Text of a value copied into another cell by a formula (=F8 shows the same date text or number).</summary>
    public static object? Shown(object? value) => value is CellError ? null : value;

    // ---------- Formulas each bill place is expected to have ----------

    /// <summary>The amount and totals formulas of the place, or the first cell where they differ from the bill layout.</summary>
    public string? ChangedTotalsCell(BillSlot slot)
    {
        for (var row = BillSlot.FirstLineRow; row <= BillSlot.LastLineRow; row++)
        {
            var template = $"IF(F{row}=\"\",\"\",ROUND(F{row}*E{row},0))";
            if (!Matches(slot, row, Col.G, template)) return slot.Ref(row, Col.G);
        }
        foreach (var (row, formula) in TotalFormulas)
        {
            if (!Matches(slot, row, Col.G, formula)) return slot.Ref(row, Col.G);
        }
        return null;
    }

    private bool Matches(BillSlot slot, int row, int column, string firstBillFormula)
    {
        var cell = Cell(slot, row, column);
        return cell.HasFormula && FormulaText.Normalize(cell.Formula!) == FormulaText.Normalize(FormulaText.Shift(firstBillFormula, slot.RowOffset, slot.ColumnOffset, otherSheets: false));
    }

    /// <summary>
    /// The Details cells the bill formulas build their lookup ranges from: B1/B2 the first and last party row, E1/E2 the
    /// first and last rate column. A lookup pointing anywhere else is not the layout's, so its value is typed instead.
    /// </summary>
    private static readonly HashSet<string> DetailsMarkers = new(["B1", "B2", "E1", "E2"], StringComparer.Ordinal);

    /// <summary>The rate formula of a line row: the Details rate of this bill's party (A8) for the row's FINISH.</summary>
    public static bool IsRateFormula(BillSlot slot, int row, string? formula)
    {
        if (formula is null) return false;
        var text = FormulaText.Normalize(formula);
        var refs = FormulaText.RelativeReferences(formula);
        return text.Contains("INDEX(", StringComparison.Ordinal) && text.Contains("MATCH(", StringComparison.Ordinal) && text.Contains("DETAILS", StringComparison.Ordinal)
            && refs.SetEquals([slot.Ref(BillSlot.PartyRow, Col.A), slot.Ref(row, Col.D)]) && FormulaText.OtherSheetReferences(formula).IsSubsetOf(DetailsMarkers);
    }

    /// <summary>A Details lookup of this bill's party (A8): column 2 address, 3 state, 4 GSTIN (shown after "GSTIN: "), 5 discount %.</summary>
    public static bool IsLookupFormula(BillSlot slot, string? formula, int detailsColumn)
    {
        if (formula is null) return false;
        var text = FormulaText.Normalize(formula);
        var refs = FormulaText.RelativeReferences(formula);
        var party = slot.Ref(BillSlot.PartyRow, Col.A);
        if (!text.Contains("VLOOKUP(", StringComparison.Ordinal) || !LookupColumn().Matches(text).All(m => m.Groups[1].Value == detailsColumn.ToString(CultureInfo.InvariantCulture))
            || !LookupColumn().IsMatch(text) || !FormulaText.OtherSheetReferences(formula).IsSubsetOf(DetailsMarkers))
            return false;
        return detailsColumn switch
        {
            DetailsSheet.DiscountColumn => refs.SetEquals([party, slot.Ref(BillSlot.GrossRow, Col.G)]),
            DetailsSheet.GstinColumn => refs.SetEquals([party]) && text.Contains("\"GSTIN: \"", StringComparison.OrdinalIgnoreCase),
            _ => refs.SetEquals([party]),
        };
    }

    /// <summary>
    /// The formula this cell has in another bill place, moved here (its Details references unchanged) — for putting back a
    /// formula that was typed over. Null when no other place has a formula of that kind there.
    /// </summary>
    public string? FormulaFromAnotherPlace(BillSlot slot, int row, int column, Func<BillSlot, string?, bool> isKind)
    {
        foreach (var other in BillSlot.All.OrderBy(s => Math.Abs(s.Index - slot.Index)))
        {
            if (other.Index == slot.Index) continue;
            var formula = Cell(other, row, column).Formula;
            if (!isKind(other, formula)) continue;
            var copied = FormulaText.Shift(formula!, slot.RowOffset - other.RowOffset, slot.ColumnOffset - other.ColumnOffset, otherSheets: false);
            if (isKind(slot, copied)) return copied;
        }
        return null;
    }

    private static string? NullIfEmpty(string text) => text.Length == 0 ? null : text;

    [GeneratedRegex(@"\s+TO\s+", RegexOptions.IgnoreCase)]
    private static partial Regex PeriodSplit();

    [GeneratedRegex(@",(\d+),FALSE\)")]
    private static partial Regex LookupColumn();
}
