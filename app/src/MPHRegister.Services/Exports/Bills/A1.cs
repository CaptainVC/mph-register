using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace MPHRegister.Services.Exports.Bills;

/// <summary>A1-style cell references: column letters and 1-based rows; columns are 0-based indexes in code.</summary>
internal static partial class A1
{
    public static string Column(int index)
    {
        var name = new StringBuilder();
        for (var n = index + 1; n > 0; n = (n - 1) / 26) name.Insert(0, (char)('A' + ((n - 1) % 26)));
        return name.ToString();
    }

    public static int ColumnIndex(string letters)
    {
        var index = 0;
        foreach (var c in letters.ToUpperInvariant()) index = (index * 26) + (c - 'A' + 1);
        return index - 1;
    }

    public static string Ref(int row, int column) => Column(column) + row.ToString(CultureInfo.InvariantCulture);

    public static (int Row, int Column) Parse(string reference)
    {
        var match = CellPattern().Match(reference);
        if (!match.Success) throw new FormatException($"\"{reference}\" is not a cell reference.");
        return (int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture), ColumnIndex(match.Groups[1].Value));
    }

    [GeneratedRegex(@"^\$?([A-Za-z]{1,3})\$?(\d+)$")]
    private static partial Regex CellPattern();
}

/// <summary>Reads and copies formulas the way Excel does: relative references move, $-fixed ones and text in quotes do not.</summary>
internal static partial class FormulaText
{
    /// <summary>
    /// The formula moved <paramref name="rows"/> down and <paramref name="columns"/> right. Like Excel's copy, relative
    /// references move; with <paramref name="otherSheets"/> false, references to other sheets (Details!B1) stay as they are,
    /// as in the bill workbook, where every bill's lookups point at the same Details cells.
    /// </summary>
    public static string Shift(string formula, int rows, int columns, bool otherSheets = true) => MapReferences(formula, m =>
    {
        if (!otherSheets && m.Groups["sheet"].Length > 0) return m.Value;
        var row = int.Parse(m.Groups["row"].Value, CultureInfo.InvariantCulture);
        var column = A1.ColumnIndex(m.Groups["col"].Value);
        if (m.Groups["colFixed"].Length == 0) column += columns;
        if (m.Groups["rowFixed"].Length == 0) row += rows;
        return $"{m.Groups["sheet"].Value}{m.Groups["colFixed"].Value}{A1.Column(column)}{m.Groups["rowFixed"].Value}{row.ToString(CultureInfo.InvariantCulture)}";
    });

    /// <summary>References to this sheet without any $ (the ones that move when the cell is copied), upper case.</summary>
    public static HashSet<string> RelativeReferences(string formula)
    {
        var found = new HashSet<string>(StringComparer.Ordinal);
        MapReferences(formula, m =>
        {
            if (m.Groups["sheet"].Length == 0 && m.Groups["colFixed"].Length == 0 && m.Groups["rowFixed"].Length == 0)
                found.Add(m.Groups["col"].Value.ToUpperInvariant() + m.Groups["row"].Value);
            return m.Value;
        });
        return found;
    }

    /// <summary>References to other sheets (Details!$E$1 → E1), upper case without $.</summary>
    public static HashSet<string> OtherSheetReferences(string formula)
    {
        var found = new HashSet<string>(StringComparer.Ordinal);
        MapReferences(formula, m =>
        {
            if (m.Groups["sheet"].Length > 0) found.Add(m.Groups["col"].Value.ToUpperInvariant() + m.Groups["row"].Value);
            return m.Value;
        });
        return found;
    }

    /// <summary>Upper case without spaces outside quoted text, so formulas typed slightly differently still compare equal.</summary>
    public static string Normalize(string formula)
    {
        var output = new StringBuilder(formula.Length);
        var quoted = false;
        foreach (var c in formula.TrimStart('='))
        {
            if (c == '"') quoted = !quoted;
            if (quoted || c == '"') output.Append(c);
            else if (!char.IsWhiteSpace(c)) output.Append(char.ToUpperInvariant(c));
        }
        return output.ToString();
    }

    /// <summary>Replaces each cell reference outside quoted text ("..." strings are copied unchanged).</summary>
    private static string MapReferences(string formula, MatchEvaluator map)
    {
        var output = new StringBuilder(formula.Length);
        var start = 0;
        while (start < formula.Length)
        {
            var quote = formula.IndexOf('"', start);
            var end = quote < 0 ? formula.Length : quote;
            output.Append(Reference().Replace(formula[start..end], map));
            if (quote < 0) break;
            var close = quote + 1;
            while (close < formula.Length)
            {
                if (formula[close] == '"' && close + 1 < formula.Length && formula[close + 1] == '"') close += 2;
                else if (formula[close] == '"') break;
                else close++;
            }
            close = Math.Min(close + 1, formula.Length);
            output.Append(formula, quote, close - quote);
            start = close;
        }
        return output.ToString();
    }

    [GeneratedRegex(@"(?<sheet>!?)(?<![A-Za-z0-9_.$])(?<colFixed>\$?)(?<col>[A-Za-z]{1,3})(?<rowFixed>\$?)(?<row>\d{1,7})(?![A-Za-z0-9_(.!])")]
    private static partial Regex Reference();
}
