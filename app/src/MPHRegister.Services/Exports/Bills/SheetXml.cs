using System.Globalization;
using System.Xml.Linq;

namespace MPHRegister.Services.Exports.Bills;

/// <summary>A formula result Excel saved as an error (#N/A, #NAME? …).</summary>
internal sealed record CellError(string Code);

/// <summary>
/// A cell as saved: its own formula (a shared formula's copies get the master's formula moved to them), and its value
/// (string, double, bool, <see cref="CellError"/>, or null when there is none).
/// </summary>
internal sealed record CellContent(string? Formula, object? Value)
{
    public bool HasFormula => Formula is not null;

    /// <summary>The value as text, the way the bill reader reads it ("" when empty).</summary>
    public string Text => Value switch
    {
        null => string.Empty,
        string s => s,
        double d => d.ToString(CultureInfo.InvariantCulture),
        bool b => b ? "TRUE" : "FALSE",
        CellError e => e.Code,
        _ => string.Empty,
    };

    public bool IsBlank => Formula is null && (Value is null || (Value is string s && s.Length == 0));
}

/// <summary>The workbook's shared text list (cells hold an index into it).</summary>
internal sealed class SharedStrings
{
    private readonly XDocument? doc;
    private readonly List<string> items = [];
    private readonly Dictionary<string, int> index = new(StringComparer.Ordinal);
    private int added;

    public SharedStrings(XDocument? doc)
    {
        this.doc = doc;
        if (doc?.Root is null) return;
        foreach (var si in doc.Root.Elements(X("si")))
        {
            var text = string.Concat(si.Descendants(X("t")).Where(t => t.Parent?.Name != X("rPh") && t.Parent?.Parent?.Name != X("rPh")).Select(t => t.Value));
            index.TryAdd(text, items.Count);
            items.Add(text);
        }
    }

    public bool Available => doc?.Root is not null;

    public int Count => items.Count;

    public string Get(int i) => i >= 0 && i < items.Count ? items[i] : string.Empty;

    /// <summary>The index of the text, appending it when the list does not have it yet.</summary>
    public int Add(string text)
    {
        added++;
        if (index.TryGetValue(text, out var found)) return found;
        var t = new XElement(X("t"), text);
        if (text.Length > 0 && (char.IsWhiteSpace(text[0]) || char.IsWhiteSpace(text[^1]))) t.SetAttributeValue(XNamespace.Xml + "space", "preserve");
        doc!.Root!.Add(new XElement(X("si"), t));
        index[text] = items.Count;
        items.Add(text);
        return items.Count - 1;
    }

    /// <summary>Keeps the counts in the part's header right after texts were added.</summary>
    public void UpdateCounts()
    {
        if (doc?.Root is null || added == 0) return;
        var count = (int?)doc.Root.Attribute("count") ?? 0;
        doc.Root.SetAttributeValue("count", count + added);
        doc.Root.SetAttributeValue("uniqueCount", items.Count);
    }

    private static XName X(string name) => XName.Get(name, XlsxPackage.MainNs);
}

/// <summary>One worksheet's cells, read and changed in place (styles and every other part of the sheet are kept).</summary>
internal sealed class SheetXml
{
    /// <summary>Excel's height for rows that do not give one (points).</summary>
    public const double StandardRowHeight = 15;

    private readonly XElement root;
    private readonly XElement sheetData;
    private readonly SharedStrings strings;
    private readonly List<(int Row, int Column, int LastRow, int LastColumn)> merges = [];
    private readonly SortedDictionary<int, XElement> rows = [];
    private readonly Dictionary<string, XElement> cells = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, (int Row, int Column, string Formula)> sharedMasters = new(StringComparer.Ordinal);

    public SheetXml(XDocument doc, SharedStrings strings)
    {
        ArgumentNullException.ThrowIfNull(doc);
        this.strings = strings;
        root = doc.Root ?? throw new InvalidDataException("The sheet is empty.");
        sheetData = root.Element(X("sheetData")) ?? throw new InvalidDataException("The sheet has no cells.");
        foreach (var merge in root.Element(X("mergeCells"))?.Elements(X("mergeCell")) ?? [])
        {
            var range = ((string?)merge.Attribute("ref") ?? string.Empty).Split(':');
            if (range.Length != 2) continue;
            var (top, left) = A1.Parse(range[0]);
            var (bottom, right) = A1.Parse(range[1]);
            merges.Add((top, left, bottom, right));
        }
        var lastRow = 0;
        foreach (var row in sheetData.Elements(X("row")))
        {
            var r = (int?)row.Attribute("r") ?? lastRow + 1;
            lastRow = r;
            row.SetAttributeValue("r", r);
            rows[r] = row;
            var lastColumn = -1;
            foreach (var cell in row.Elements(X("c")))
            {
                var reference = (string?)cell.Attribute("r");
                var column = reference is null ? lastColumn + 1 : A1.Parse(reference).Column;
                lastColumn = column;
                reference = A1.Ref(r, column);
                cell.SetAttributeValue("r", reference);
                cells[reference] = cell;
                if (cell.Element(X("f")) is { } f && (string?)f.Attribute("t") == "shared" && f.Attribute("ref") is not null && f.Value.Length > 0)
                    sharedMasters[(string?)f.Attribute("si") ?? string.Empty] = (r, column, f.Value);
            }
        }
    }

    public IEnumerable<string> References => cells.Keys;

    public CellContent Get(string reference) => cells.TryGetValue(reference, out var cell) ? Read(cell) : new CellContent(null, null);

    public CellContent Get(int row, int column) => Get(A1.Ref(row, column));

    public bool Has(string reference) => cells.ContainsKey(reference);

    public int Style(string reference) => cells.TryGetValue(reference, out var cell) ? (int?)cell.Attribute("s") ?? 0 : 0;

    public void SetStyle(string reference, int style) => Cell(reference).SetAttributeValue("s", style);

    /// <summary>Typed text; an empty text clears the cell.</summary>
    public void SetText(string reference, string text)
    {
        if (text.Length == 0)
        {
            Clear(reference);
            return;
        }
        var cell = Prepare(reference);
        if (strings.Available)
        {
            cell.SetAttributeValue("t", "s");
            cell.Add(new XElement(X("v"), strings.Add(text).ToString(CultureInfo.InvariantCulture)));
        }
        else
        {
            cell.SetAttributeValue("t", "inlineStr");
            cell.Add(new XElement(X("is"), new XElement(X("t"), new XAttribute(XNamespace.Xml + "space", "preserve"), text)));
        }
    }

    public void SetNumber(string reference, decimal value)
    {
        var cell = Prepare(reference);
        cell.Add(new XElement(X("v"), Number(value)));
    }

    /// <summary>A formula with its result saved, so programs that do not recalculate still see the right value.</summary>
    public void SetFormula(string reference, string formula, object? result)
    {
        var cell = Prepare(reference);
        cell.Add(new XElement(X("f"), formula));
        AddResult(cell, result);
    }

    /// <summary>Changes only the saved result of the cell's formula.</summary>
    public void SetResult(string reference, object? result)
    {
        if (!cells.TryGetValue(reference, out var cell) || cell.Element(X("f")) is null) return;
        cell.Elements(X("v")).Remove();
        cell.Elements(X("is")).Remove();
        cell.Attribute("t")?.Remove();
        AddResult(cell, result);
    }

    public void Clear(string reference)
    {
        if (!cells.ContainsKey(reference)) return;
        Prepare(reference);
    }

    /// <summary>Empties the cell (keeping its style); a shared formula it was the master of moves to the next cell.</summary>
    private XElement Prepare(string reference)
    {
        var cell = Cell(reference);
        if (cell.Element(X("f")) is { } f && (string?)f.Attribute("t") == "shared" && f.Attribute("ref") is not null && f.Value.Length > 0)
            MoveSharedMaster(cell, f);
        cell.Elements().Remove();
        cell.Attribute("t")?.Remove();
        return cell;
    }

    private void MoveSharedMaster(XElement master, XElement f)
    {
        var si = (string?)f.Attribute("si") ?? string.Empty;
        var (row, column) = A1.Parse((string)master.Attribute("r")!);
        var range = ((string?)f.Attribute("ref") ?? string.Empty).Split(':');
        var end = range.Length == 2 ? range[1] : range[0];
        var next = sheetData.Descendants(X("c")).FirstOrDefault(c => c != master && c.Element(X("f")) is { } cf
            && (string?)cf.Attribute("t") == "shared" && (string?)cf.Attribute("si") == si && cf.Value.Length == 0);
        sharedMasters.Remove(si);
        if (next is null) return;
        var (nextRow, nextColumn) = A1.Parse((string)next.Attribute("r")!);
        var moved = FormulaText.Shift(f.Value, nextRow - row, nextColumn - column);
        var nf = next.Element(X("f"))!;
        nf.Value = moved;
        nf.SetAttributeValue("ref", $"{(string)next.Attribute("r")!}:{end}");
        sharedMasters[si] = (nextRow, nextColumn, moved);
    }

    // ---------- Layout: row heights, column widths and merged cells ----------

    /// <summary>The row's height in points, as Excel shows it (the sheet's default when the row gives none).</summary>
    public double RowHeight(int row) =>
        rows.TryGetValue(row, out var element) && (string?)element.Attribute("ht") is { } ht
            && double.TryParse(ht, NumberStyles.Float, CultureInfo.InvariantCulture, out var points) ? points : DefaultRowHeight;

    /// <summary>True when Excel keeps the row's height whatever its cells hold (it does not grow it for wrapped text).</summary>
    public bool HeightLocked(int row) => rows.TryGetValue(row, out var element) && (string?)element.Attribute("customHeight") is "1" or "true";

    /// <summary>Keeps the row at the height it shows now, so wrapped or bigger text can never make Excel grow it.</summary>
    public void LockHeight(int row)
    {
        if (HeightLocked(row)) return;
        var height = RowHeight(row);
        var element = Row(row);
        element.SetAttributeValue("ht", height.ToString("0.##########", CultureInfo.InvariantCulture));
        element.SetAttributeValue("customHeight", "1");
    }

    /// <summary>The column's width in Excel's character units (the sheet's default when no column entry gives one).</summary>
    public double ColumnWidth(int column)
    {
        var number = column + 1;
        foreach (var col in root.Element(X("cols"))?.Elements(X("col")) ?? [])
        {
            if ((int?)col.Attribute("min") > number || (int?)col.Attribute("max") < number) continue;
            if ((string?)col.Attribute("hidden") is "1" or "true") return 0;
            if (double.TryParse((string?)col.Attribute("width"), NumberStyles.Float, CultureInfo.InvariantCulture, out var width)) return width;
        }
        return DefaultColumnWidth;
    }

    /// <summary>The cells the text of this cell is shown across: its merged range, or just the cell.</summary>
    public (int Row, int Column, int LastRow, int LastColumn) Area(string reference)
    {
        var (row, column) = A1.Parse(reference);
        foreach (var merge in merges)
        {
            if (merge.Row <= row && row <= merge.LastRow && merge.Column <= column && column <= merge.LastColumn) return merge;
        }
        return (row, column, row, column);
    }

    private double DefaultRowHeight =>
        double.TryParse((string?)root.Element(X("sheetFormatPr"))?.Attribute("defaultRowHeight"), NumberStyles.Float, CultureInfo.InvariantCulture, out var height)
            ? height : StandardRowHeight;

    private double DefaultColumnWidth
    {
        get
        {
            var format = root.Element(X("sheetFormatPr"));
            if (double.TryParse((string?)format?.Attribute("defaultColWidth"), NumberStyles.Float, CultureInfo.InvariantCulture, out var width)) return width;
            // Excel's default: 8 characters (or the sheet's base width) plus 5 pixels of padding at 7 pixels a character.
            var characters = double.TryParse((string?)format?.Attribute("baseColWidth"), NumberStyles.Float, CultureInfo.InvariantCulture, out var b) ? b : 8;
            return Math.Truncate((characters * 7 + 5) / 7 * 256) / 256;
        }
    }

    private XElement Row(int r)
    {
        if (rows.TryGetValue(r, out var row)) return row;
        row = new XElement(X("row"), new XAttribute("r", r));
        var after = rows.Keys.Where(k => k < r).DefaultIfEmpty(0).Max();
        if (after == 0) sheetData.AddFirst(row);
        else rows[after].AddAfterSelf(row);
        rows[r] = row;
        return row;
    }

    private XElement Cell(string reference)
    {
        if (cells.TryGetValue(reference, out var existing)) return existing;
        var (r, column) = A1.Parse(reference);
        var row = Row(r);
        var cell = new XElement(X("c"), new XAttribute("r", A1.Ref(r, column)));
        var before = row.Elements(X("c")).FirstOrDefault(c => A1.Parse((string)c.Attribute("r")!).Column > column);
        if (before is null) row.Add(cell);
        else before.AddBeforeSelf(cell);
        cells[A1.Ref(r, column)] = cell;
        return cell;
    }

    private CellContent Read(XElement cell)
    {
        var type = (string?)cell.Attribute("t");
        string? formula = null;
        if (cell.Element(X("f")) is { } f)
        {
            formula = f.Value;
            if (formula.Length == 0 && (string?)f.Attribute("t") == "shared" && sharedMasters.TryGetValue((string?)f.Attribute("si") ?? string.Empty, out var master))
            {
                var (row, column) = A1.Parse((string)cell.Attribute("r")!);
                formula = FormulaText.Shift(master.Formula, row - master.Row, column - master.Column);
            }
        }
        var v = cell.Element(X("v"))?.Value;
        object? value = type switch
        {
            "s" => v is null ? null : strings.Get(int.Parse(v, CultureInfo.InvariantCulture)),
            "str" => v ?? string.Empty,
            "inlineStr" => string.Concat(cell.Element(X("is"))?.Descendants(X("t")).Select(t => t.Value) ?? []),
            "b" => v == "1",
            "e" => new CellError(v ?? string.Empty),
            _ => v is null || v.Length == 0 ? null : double.Parse(v, NumberStyles.Float, CultureInfo.InvariantCulture),
        };
        return new CellContent(formula, value);
    }

    private static void AddResult(XElement cell, object? result)
    {
        switch (result)
        {
            case null:
                cell.SetAttributeValue("t", "str");
                cell.Add(new XElement(X("v"), string.Empty));
                break;
            case string s:
                cell.SetAttributeValue("t", "str");
                cell.Add(new XElement(X("v"), s));
                break;
            case decimal d:
                cell.Add(new XElement(X("v"), Number(d)));
                break;
            case long l:
                cell.Add(new XElement(X("v"), l.ToString(CultureInfo.InvariantCulture)));
                break;
            case int i:
                cell.Add(new XElement(X("v"), i.ToString(CultureInfo.InvariantCulture)));
                break;
            case double dbl:
                cell.Add(new XElement(X("v"), dbl.ToString("R", CultureInfo.InvariantCulture)));
                break;
            case CellError e:
                cell.SetAttributeValue("t", "e");
                cell.Add(new XElement(X("v"), e.Code));
                break;
            default:
                throw new ArgumentException($"Cannot save a {result.GetType().Name} as a cell value.", nameof(result));
        }
    }

    private static string Number(decimal value) => value.ToString("0.############################", CultureInfo.InvariantCulture);

    private static XName X(string name) => XName.Get(name, XlsxPackage.MainNs);
}
