namespace MPHRegister.Services.Exports.Bills;

/// <summary>
/// The bill workbook's hidden Details sheet as the Main sheet's formulas see it: party rows between Details!B1 and B2
/// (columns A–E: FirmName, Address, State, GSTIN, Dis.), finish rates in the columns named by E1 and E2 under the row-6
/// headers. Lookups match like Excel's MATCH / VLOOKUP(…, FALSE): the exact text, ignoring case.
/// </summary>
internal sealed class DetailsSheet
{
    public const int AddressColumn = 2;
    public const int StateColumn = 3;
    public const int GstinColumn = 4;
    public const int DiscountColumn = 5;
    private const int HeaderRow = 6;

    private readonly SheetXml? sheet;
    private readonly int firstRow;
    private readonly int lastRow;
    private readonly int firstRateColumn;
    private readonly int lastRateColumn;
    private readonly int colorColumn;

    private DetailsSheet(SheetXml? sheet, int firstRow, int lastRow, int firstRateColumn, int lastRateColumn, int colorColumn)
    {
        this.sheet = sheet;
        this.firstRow = firstRow;
        this.lastRow = lastRow;
        this.firstRateColumn = firstRateColumn;
        this.lastRateColumn = lastRateColumn;
        this.colorColumn = colorColumn;
    }

    public bool Exists => sheet is not null;

    public static DetailsSheet From(SheetXml? sheet)
    {
        if (sheet is null) return new DetailsSheet(null, 0, -1, 0, -1, -1);
        var lastUsedRow = sheet.References.Select(r => A1.Parse(r).Row).DefaultIfEmpty(0).Max();
        var first = Whole(sheet.Get("B1").Value) ?? HeaderRow + 1;
        var last = Whole(sheet.Get("B2").Value) ?? lastUsedRow;
        var headers = sheet.References.Select(A1.Parse).Where(p => p.Row == HeaderRow).Select(p => p.Column).DefaultIfEmpty(-1).ToList();
        int? Letter(string reference) => sheet.Get(reference).Value is string s && s.Trim().Length is > 0 and <= 3 && s.Trim().All(char.IsLetter)
            ? A1.ColumnIndex(s.Trim())
            : null;
        var colorColumn = headers.FirstOrDefault(c => c >= 0 && string.Equals(sheet.Get(HeaderRow, c).Text.Trim(), "Color", StringComparison.OrdinalIgnoreCase), -1);
        var firstRate = Letter("E1") ?? (colorColumn >= 0 ? colorColumn + 1 : int.MaxValue);
        var lastRate = Letter("E2") ?? headers.Max();
        return new DetailsSheet(sheet, first, last, firstRate, lastRate, colorColumn);
    }

    /// <summary>The party's row, or null when it is not there or when Excel's match cannot be told (wildcards in the name).</summary>
    public int? PartyRow(string name)
    {
        if (sheet is null || name.Length == 0 || name.IndexOfAny(['*', '?', '~']) >= 0) return null;
        for (var row = firstRow; row <= lastRow; row++)
        {
            if (sheet.Get(row, 0).Value is string s && string.Equals(s, name, StringComparison.OrdinalIgnoreCase)) return row;
        }
        return null;
    }

    /// <summary>The finish's rate column, or null when the row-6 headers do not have it.</summary>
    public int? FinishColumn(string finish)
    {
        if (sheet is null || finish.Length == 0 || finish.IndexOfAny(['*', '?', '~']) >= 0) return null;
        for (var column = firstRateColumn; column <= lastRateColumn; column++)
        {
            if (sheet.Get(HeaderRow, column).Value is string s && string.Equals(s, finish, StringComparison.OrdinalIgnoreCase)) return column;
        }
        return null;
    }

    /// <summary>VLOOKUP column n (1 = FirmName) of a party row.</summary>
    public CellContent Lookup(int row, int column) => sheet!.Get(row, column - 1);

    public CellContent Rate(int row, int column) => sheet!.Get(row, column);

    /// <summary>The text a lookup formula shows: an empty Details cell shows 0, so it never stands for "".</summary>
    public string? LookupText(string party, int column)
    {
        if (PartyRow(party) is not { } row) return null;
        var value = Lookup(row, column);
        return value.Value is string s && s.Length > 0 ? s : null;
    }

    /// <summary>The finish rate the rate formula shows for this party, or null when it would not show exactly a number.</summary>
    public decimal? RateOf(string party, string finish)
    {
        if (PartyRow(party) is not { } row || FinishColumn(finish) is not { } column) return null;
        return Rate(row, column).Value is double d ? (decimal)d : null;
    }

    /// <summary>True when the rate formula shows "" (party or finish not on the sheet), so the bill line has no amount.</summary>
    public bool RateBlank(string party, string finish) =>
        PartyRow(party) is null || finish.Length == 0 || (FinishColumn(finish) is null && finish.IndexOfAny(['*', '?', '~']) < 0);

    public decimal? DiscountOf(string party) =>
        PartyRow(party) is { } row && Lookup(row, DiscountColumn).Value is double d ? (decimal)d : null;

    public string? ColorOf(string party) => colorColumn >= 0 && PartyRow(party) is { } row ? sheet!.Get(row, colorColumn).Text : null;

    private static int? Whole(object? value) => value is double d && double.IsInteger(d) && d is > 0 and < 1_048_577 ? (int)d : null;
}
