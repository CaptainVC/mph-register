using MPHRegister.Contracts.Billing;
using MPHRegister.Shared.Enums;

namespace MPHRegister.Services.Billing;

/// <summary>
/// How many printed rows a bill line needs. A G.P.N., D.N. or LOT NO. text that does not fit its column even in the
/// smallest font wraps, and the line then takes 2 (at most 3) rows, so bills are packed with room for it.
/// The print page measures the real text and shrinks the font first; this estimate uses Calibri's character widths.
/// </summary>
public sealed class BillLineSizer(BillGeometry geometry)
{
    public const int MaxRowsPerLine = 3;

    private static readonly int[] ReferenceColumns = [BillGeometry.GpnColumn, BillGeometry.DnColumn, BillGeometry.LotColumn];

    public BillGeometry Geometry => geometry;

    public int RowsFor(LineDto line, decimal smallestFontPt)
    {
        ArgumentNullException.ThrowIfNull(line);
        if (line.Kind == LineKind.Blank) return 1;
        string?[] texts = [line.Gpn, line.Dn, line.Lot];
        var rows = 1;
        for (var i = 0; i < ReferenceColumns.Length; i++) rows = Math.Max(rows, RowsFor(texts[i], ReferenceColumns[i], (double)smallestFontPt));
        return rows;
    }

    public int TotalRows(IEnumerable<LineDto> lines, decimal smallestFontPt) => lines.Sum(l => RowsFor(l, smallestFontPt));

    /// <summary>Text lines needed to show the text in the column at the given font, breaking after commas, spaces and plus signs.</summary>
    public int WrappedLines(string? text, int column, double fontPt)
    {
        var value = (text ?? string.Empty).Trim();
        if (value.Length == 0) return 1;
        var inner = geometry.ColumnsPx[column] - BillGeometry.CellPaddingPx;
        var px = fontPt * 96 / 72;
        if (TextWidth.Em(value) * px <= inner) return 1;
        var lines = 1;
        var used = 0.0;
        foreach (var token in Tokens(value))
        {
            var width = TextWidth.Em(token) * px;
            if (used + width <= inner)
            {
                used += width;
                continue;
            }
            var trimmed = TextWidth.Em(token.TrimStart()) * px;
            if (trimmed <= inner)
            {
                lines++;
                used = trimmed;
                continue;
            }
            foreach (var c in token)
            {
                var w = TextWidth.Em(c) * px;
                if (used + w > inner && used > 0)
                {
                    lines++;
                    used = 0;
                }
                used += w;
            }
        }
        return lines;
    }

    private int RowsFor(string? text, int column, double smallestFontPt) => Math.Min(MaxRowsPerLine, WrappedLines(text, column, smallestFontPt));

    private static IEnumerable<string> Tokens(string text)
    {
        var start = 0;
        for (var i = 0; i < text.Length; i++)
        {
            if (text[i] is ',' or ' ' or '+' or '/' or '-' && i + 1 < text.Length)
            {
                yield return text[start..(i + 1)];
                start = i + 1;
            }
        }
        if (start < text.Length) yield return text[start..];
    }
}

/// <summary>Advance widths of Calibri, in em, for estimating printed text width.</summary>
internal static class TextWidth
{
    private static readonly double[] Upper =
        [0.579, 0.544, 0.533, 0.615, 0.488, 0.459, 0.631, 0.623, 0.252, 0.319, 0.520, 0.420, 0.855, 0.646, 0.662, 0.517, 0.673, 0.543, 0.459, 0.487, 0.642, 0.567, 0.890, 0.519, 0.487, 0.468];

    private static readonly double[] Lower =
        [0.479, 0.525, 0.423, 0.525, 0.498, 0.305, 0.471, 0.525, 0.229, 0.239, 0.455, 0.229, 0.799, 0.525, 0.527, 0.525, 0.525, 0.349, 0.391, 0.335, 0.525, 0.452, 0.715, 0.433, 0.453, 0.395];

    public static double Em(string text)
    {
        var total = 0.0;
        foreach (var c in text) total += Em(c);
        return total;
    }

    public static double Em(char c) => c switch
    {
        >= '0' and <= '9' => 0.507,
        ' ' => 0.226,
        ',' => 0.250,
        '.' => 0.252,
        '-' => 0.306,
        '(' or ')' => 0.303,
        '+' => 0.498,
        '/' => 0.386,
        ':' or ';' => 0.268,
        '&' => 0.682,
        >= 'A' and <= 'Z' => Upper[c - 'A'],
        >= 'a' and <= 'z' => Lower[c - 'a'],
        _ => 0.55,
    };
}
