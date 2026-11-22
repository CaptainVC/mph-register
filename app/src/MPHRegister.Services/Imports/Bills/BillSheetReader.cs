using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using MPHRegister.Contracts.Billing;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Imports.Bills;

/// <summary>
/// Reads the bill workbook: Main holds 4 columns × 25 bills, each a 49-row block (A1:G49, H1:N49 …) with lines in rows 13–37
/// and totals in G38–G43; Details holds the party master with rates.
/// </summary>
public static partial class BillSheetReader
{
    public const int BlockRows = 49;
    public const int BlockColumns = 7;
    public const int Panels = 4;
    public const int BlocksPerPanel = 25;
    public const int LineRows = 25;
    private const int FirstLineRow = 12;
    private const int DetailsHeaderRow = 5;

    public static BillSheet? Read(string filePath)
    {
        var grid = ExcelWorkbook.ReadSheet(filePath, "Main", Panels * BlockColumns, Panels * BlockColumns + 4);
        if (grid is null) return null;
        var details = ExcelWorkbook.ReadSheet(filePath, "Details", 8) ?? [];
        var errors = new List<string>();
        var bills = new List<SheetBill>();
        for (var panel = 0; panel < Panels; panel++)
        {
            for (var block = 0; block < BlocksPerPanel; block++)
            {
                var bill = ReadBlock(grid, block * BlockRows, panel * BlockColumns, errors);
                if (bill is not null) bills.Add(bill);
            }
        }
        return new BillSheet(bills, ReadDetails(details), errors);
    }

    private static SheetBill? ReadBlock(List<object?[]> grid, int r0, int c0, List<string> errors)
    {
        object? Cell(int dr, int dc) => r0 + dr < grid.Count && c0 + dc < grid[r0 + dr].Length ? grid[r0 + dr][c0 + dc] : null;
        string T(int dr, int dc) => ExcelCells.Text(Cell(dr, dc), "dd.MM.yy");
        var partyText = T(7, 0).NormalizeName();
        if (partyText.Length == 0) return null;
        var cellName = $"{ColumnName(c0)}{r0 + 1}";
        var number = T(6, 5);
        var serialMatch = SerialPattern().Match(number);
        var billDate = ExcelCells.DotDate(Cell(7, 5));
        var period = PeriodSplit().Split(T(9, 5));
        var from = period.Length == 2 ? ExcelCells.DotDate(period[0].Trim()) : null;
        var to = period.Length == 2 ? ExcelCells.DotDate(period[1].Trim()) : null;
        if (!serialMatch.Success)
        {
            errors.Add($"{cellName}: bill number \"{number}\" has no serial number.");
            return null;
        }
        if (billDate is null)
        {
            errors.Add($"{cellName} ({number}): bill date \"{T(7, 5)}\" is not a date.");
            return null;
        }
        var date = Dates.ParseIsoOrDefault(billDate);
        var fyMatch = FyPattern().Match(number);

        var lines = new List<LineDto>();
        for (var i = 0; i < LineRows; i++)
        {
            var dr = FirstLineRow + i;
            var gpn = T(dr, 0);
            var dn = T(dr, 1);
            var lot = T(dr, 2);
            var finish = T(dr, 3).NormalizeName();
            var qty = ExcelCells.Rounded(Cell(dr, 4));
            var rate = ExcelCells.Number(Cell(dr, 5));
            if (finish.Length > 0) lines.Add(new LineDto(LineKind.Priced, gpn, dn, lot, finish, qty ?? 0, rate, null, false, []));
            else if (gpn.Length + dn.Length + lot.Length > 0 || qty is not null) lines.Add(new LineDto(LineKind.Detail, gpn, dn, lot, string.Empty, qty ?? 0, null, null, false, []));
            else lines.Add(new LineDto(LineKind.Blank, string.Empty, string.Empty, string.Empty, string.Empty, null, null, null, false, []));
        }
        while (lines.Count > 0 && lines[^1].Kind == LineKind.Blank) lines.RemoveAt(lines.Count - 1);
        MarkAutoSums(lines);

        return new SheetBill(cellName, number, fyMatch.Success ? fyMatch.Groups[1].Value : FinancialYear.Of(date),
            int.Parse(serialMatch.Groups[1].Value, CultureInfo.InvariantCulture), partyText, T(8, 0).NormalizeName(), T(9, 0).NormalizeName(),
            GstinPrefix().Replace(T(10, 0), string.Empty).Trim(), billDate, from ?? billDate, to ?? billDate, lines,
            ExcelCells.Rounded(Cell(37, 6)) ?? 0, ExcelCells.Rounded(Cell(38, 6)) ?? 0, ExcelCells.Rounded(Cell(39, 6)) ?? 0,
            ExcelCells.Rounded(Cell(40, 6)) ?? 0, ExcelCells.Rounded(Cell(41, 6)) ?? 0, ExcelCells.Rounded(Cell(42, 6)) ?? 0,
            ExcelCells.Number(Cell(40, 5)) * 100m, ExcelCells.Number(Cell(41, 5)) * 100m);
    }

    /// <summary>A priced row with no reference whose THAN equals the detail rows above it is the Excel =SUM row.</summary>
    private static void MarkAutoSums(List<LineDto> lines)
    {
        var run = 0;
        var details = 0;
        for (var i = 0; i < lines.Count; i++)
        {
            var line = lines[i];
            if (line.Kind == LineKind.Detail)
            {
                run += line.Qty ?? 0;
                details++;
                continue;
            }
            if (line.Kind == LineKind.Priced && details > 0 && run == line.Qty && line.Gpn!.Length + line.Dn!.Length + line.Lot!.Length == 0)
                lines[i] = line with { AutoSum = true };
            run = 0;
            details = 0;
        }
    }

    private static Dictionary<string, SheetParty> ReadDetails(List<object?[]> rows)
    {
        var parties = new Dictionary<string, SheetParty>(StringComparer.OrdinalIgnoreCase);
        if (rows.Count <= DetailsHeaderRow) return parties;
        var header = rows[DetailsHeaderRow].Select(v => ExcelCells.Text(v).NormalizeName()).ToList();
        int Col(string name) => header.FindIndex(h => string.Equals(h, name, StringComparison.OrdinalIgnoreCase));
        var nameCol = Col("FirmName");
        if (nameCol < 0) return parties;
        var addressCol = Col("Address");
        var stateCol = Col("State");
        var gstinCol = Col("GSTIN");
        var discountCol = Col("Dis.");
        var activeCol = Col("Active");
        var colorCol = Col("Color");
        var firstRateCol = colorCol >= 0 ? colorCol + 1 : header.Count;
        for (var r = DetailsHeaderRow + 1; r < rows.Count; r++)
        {
            var row = rows[r];
            string Text(int c) => c >= 0 && c < row.Length ? ExcelCells.Text(row[c]).NormalizeName() : string.Empty;
            var name = Text(nameCol);
            if (name.Length == 0 || parties.ContainsKey(name)) continue;
            var rates = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
            for (var c = firstRateCol; c < header.Count && c < row.Length; c++)
            {
                if (header[c].Length > 0 && ExcelCells.Number(row[c]) is { } rate && rate > 0) rates[header[c]] = rate;
            }
            var color = Text(colorCol).ToLowerInvariant();
            parties[name] = new SheetParty(name, Text(addressCol), Text(stateCol), Gstin.Clean(Text(gstinCol)),
                discountCol >= 0 && discountCol < row.Length ? ExcelCells.Number(row[discountCol]) : null,
                !string.Equals(Text(activeCol), "No", StringComparison.OrdinalIgnoreCase),
                color.Length == 0 ? BlankColor : color, rates);
        }
        return parties;
    }

    /// <summary>The bill workbook paints a party without a colour red.</summary>
    private const string BlankColor = "red";

    private static string ColumnName(int index)
    {
        var name = new StringBuilder();
        for (var n = index + 1; n > 0; n = (n - 1) / 26) name.Insert(0, (char)('A' + ((n - 1) % 26)));
        return name.ToString();
    }

    [GeneratedRegex(@"(\d+)\s*$")]
    private static partial Regex SerialPattern();

    [GeneratedRegex(@"(\d{2}-\d{2})")]
    private static partial Regex FyPattern();

    [GeneratedRegex(@"\s+TO\s+", RegexOptions.IgnoreCase)]
    private static partial Regex PeriodSplit();

    [GeneratedRegex(@"^GSTIN:\s*", RegexOptions.IgnoreCase)]
    private static partial Regex GstinPrefix();
}
