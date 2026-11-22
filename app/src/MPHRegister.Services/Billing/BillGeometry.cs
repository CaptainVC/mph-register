using System.Globalization;
using System.Text.Json;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Enums;

namespace MPHRegister.Services.Billing;

/// <summary>
/// The printed bill page, from the print template (bill-template.json): fixed header and footer rows, the line rows
/// between them, column widths and margins. Decides how many rows fit on the paper and how tall they are.
/// </summary>
public sealed class BillGeometry
{
    /// <summary>The print page draws text with CSS line-height 1.2.</summary>
    public const double LineHeightFactor = 1.2;

    /// <summary>Room for the cell's borders around one line of text.</summary>
    public const double RowPaddingPt = 1.5;

    /// <summary>Kept free at the bottom of the page so rounding never pushes a bill onto a second sheet.</summary>
    public const double SafetyPt = 1;

    /// <summary>Horizontal padding inside a printed cell (2px each side) plus its border.</summary>
    public const double CellPaddingPx = 5;

    public const int GpnColumn = 0;
    public const int DnColumn = 1;
    public const int LotColumn = 2;

    public BillGeometry(IReadOnlyList<double> columnsPx, IReadOnlyList<double> rowsPt, int firstLineRow, int lineRows, double lineFontPt, double topMarginIn, double bottomMarginIn)
    {
        ArgumentNullException.ThrowIfNull(columnsPx);
        ArgumentNullException.ThrowIfNull(rowsPt);
        if (firstLineRow < 0 || lineRows < 1 || firstLineRow + lineRows > rowsPt.Count) throw new ArgumentException("The line rows are outside the template.", nameof(lineRows));
        if (columnsPx.Count <= LotColumn) throw new ArgumentException("The template needs at least the G.P.N., D.N. and LOT NO. columns.", nameof(columnsPx));
        ColumnsPx = columnsPx.ToList();
        TemplateLineRows = lineRows;
        TemplateLineHeightPt = rowsPt.Skip(firstLineRow).Take(lineRows).Sum();
        FixedHeightPt = rowsPt.Sum() - TemplateLineHeightPt;
        LineFontPt = lineFontPt;
        TopMarginIn = topMarginIn;
        BottomMarginIn = bottomMarginIn;
    }

    public IReadOnlyList<double> ColumnsPx { get; }

    public int TemplateLineRows { get; }

    public double TemplateLineHeightPt { get; }

    public double FixedHeightPt { get; }

    /// <summary>Font size of the bill lines in the template (10pt).</summary>
    public double LineFontPt { get; }

    public double TopMarginIn { get; }

    public double BottomMarginIn { get; }

    public static double PaperHeightIn(PaperSize paper) => paper == PaperSize.A4 ? 297 / 25.4 : 11;

    public static double RowHeightFor(double fontPt) => (fontPt * LineHeightFactor) + RowPaddingPt;

    /// <summary>Height left for bill lines between the fixed header and footer on this paper.</summary>
    public double LineAreaPt(PaperSize paper) => ((PaperHeightIn(paper) - TopMarginIn - BottomMarginIn) * 72) - FixedHeightPt - SafetyPt;

    /// <summary>
    /// The most rows a bill can have on this paper: every row must still be tall enough for text in the smallest font.
    /// Never fewer than the template's own rows.
    /// </summary>
    public int MaxRowsPerBill(PaperSize paper, decimal smallestFontPt) =>
        Math.Clamp((int)Math.Floor(LineAreaPt(paper) / RowHeightFor((double)smallestFontPt)), TemplateLineRows, Limits.MaxBillRows);

    /// <summary>Row height (pt) when a bill has more rows than the template; the template's own heights are kept up to its row count.</summary>
    public double RowHeightPt(PaperSize paper, int rows) => rows <= TemplateLineRows ? TemplateLineHeightPt / TemplateLineRows : LineAreaPt(paper) / rows;

    /// <summary>The line font for that many rows: the template's size, made smaller only when the rows are too short for it.</summary>
    public double LineFontFor(PaperSize paper, int rows) =>
        rows <= TemplateLineRows ? LineFontPt : Math.Min(LineFontPt, Math.Floor((RowHeightPt(paper, rows) - RowPaddingPt) / LineHeightFactor * 4) / 4);

    public static BillGeometry FromTemplate(Stream json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var columns = root.GetProperty("columnsPx").EnumerateArray().Select(c => c.GetDouble()).ToList();
        var rows = root.GetProperty("rowsPt").EnumerateArray().Select(r => r.GetDouble()).ToList();
        var first = 12;
        var count = 25;
        if (root.TryGetProperty("lineRows", out var lines))
        {
            first = lines.GetProperty("first").GetInt32();
            count = lines.GetProperty("count").GetInt32();
        }
        var font = 10.0;
        foreach (var cell in root.GetProperty("cells").EnumerateArray()
            .Where(c => c.GetProperty("r").GetInt32() == first && c.GetProperty("c").GetInt32() == LotColumn))
        {
            font = cell.GetProperty("font").GetProperty("size").GetDouble();
        }
        var margins = root.GetProperty("page").GetProperty("marginsIn");
        return new BillGeometry(columns, rows, first, count, font, margins.GetProperty("top").GetDouble(), margins.GetProperty("bottom").GetDouble());
    }

    public override string ToString() => string.Create(CultureInfo.InvariantCulture,
        $"{TemplateLineRows} line rows ({TemplateLineHeightPt:0.##}pt) + fixed {FixedHeightPt:0.##}pt, line font {LineFontPt}pt");
}
