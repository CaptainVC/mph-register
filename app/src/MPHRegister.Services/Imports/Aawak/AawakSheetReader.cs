using MPHRegister.Contracts.Imports;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Imports.Aawak;

/// <summary>One AAWAK row as the workbook has it. <c>Date</c> is ISO; <c>InwardNo</c> is column INW NO (0 when blank).</summary>
public sealed record AawakRow(int Row, int Number, string Suffix, int InwardNo, string Date, string Party, int Nag, string Transporter, string Comments)
{
    public string Key => AawakNumber.Format(Number, Suffix);
}

/// <summary>The Details sheet's lists: parties (active, party group) and lorry walas (active).</summary>
public sealed record AawakDetails(IReadOnlyDictionary<string, (bool Active, string Group)> Parties, IReadOnlyDictionary<string, bool> Transporters)
{
    public static readonly AawakDetails Empty = new(new Dictionary<string, (bool, string)>(), new Dictionary<string, bool>());
}

public sealed record AawakSheet(IReadOnlyList<AawakRow> Rows, AawakDetails Details, IReadOnlyList<ImportIssue> Warnings, IReadOnlyList<ImportIssue> Errors);

/// <summary>
/// Reads an AAWAK workbook: the Main sheet (AAWAK NO, INW NO, DATE, PARTY, NAG, LORRY WALA, COMMENTS; other columns such as
/// Party Group or a stray "Column1" are not needed) and, when present, the hidden Details sheet's party and lorry-wala lists.
/// Rows without a party are skipped (the month's last row often holds only the next number and date).
/// </summary>
public static class AawakSheetReader
{
    public const string SheetName = "Main";
    public const string DetailsSheet = "Details";

    private static readonly string[] RequiredHeaders = ["AAWAK NO", "INW NO", "DATE", "PARTY", "NAG", "LORRY WALA"];

    public static AawakSheet Read(string filePath)
    {
        var warnings = new List<ImportIssue>();
        var errors = new List<ImportIssue>();
        var grid = ExcelWorkbook.ReadSheet(filePath, SheetName, RequiredHeaders.Length + 1);
        if (grid is null)
        {
            errors.Add(new ImportIssue(0, $"The workbook has no sheet named \"{SheetName}\"."));
            return new AawakSheet([], AawakDetails.Empty, warnings, errors);
        }
        if (grid.Count == 0)
        {
            errors.Add(new ImportIssue(1, "The Main sheet is empty."));
            return new AawakSheet([], AawakDetails.Empty, warnings, errors);
        }

        var headers = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var c = 0; c < grid[0].Length; c++)
        {
            var name = ExcelCells.Text(grid[0][c]).NormalizeName().TrimEnd('.');
            if (name.Length > 0) headers.TryAdd(name, c);
        }
        var missing = RequiredHeaders.Where(h => !headers.ContainsKey(h)).ToList();
        if (missing.Count > 0)
        {
            errors.Add(new ImportIssue(1, $"Missing columns: {string.Join(", ", missing)}. Is this an AAWAK workbook?"));
            return new AawakSheet([], AawakDetails.Empty, warnings, errors);
        }

        var rows = new List<AawakRow>();
        for (var r = 1; r < grid.Count; r++)
        {
            var cells = grid[r];
            object? Cell(string header) => headers.TryGetValue(header, out var c) && c < cells.Length ? cells[c] : null;
            var parsed = ReadRow(r + 1, Cell, warnings, errors);
            if (parsed is not null) rows.Add(parsed);
        }
        foreach (var group in rows.GroupBy(x => x.Key, StringComparer.OrdinalIgnoreCase).Where(g => g.Count() > 1))
            errors.Add(new ImportIssue(group.First().Row, $"AAWAK NO {group.Key} is on rows {string.Join(", ", group.Select(x => x.Row))}."));
        if (rows.Count == 0 && errors.Count == 0) errors.Add(new ImportIssue(0, "No AAWAK rows with a party were found."));
        return new AawakSheet(rows, ReadDetails(filePath), warnings, errors);
    }

    private static AawakRow? ReadRow(int row, Func<string, object?> cell, List<ImportIssue> warnings, List<ImportIssue> errors)
    {
        var party = ExcelCells.Text(cell("PARTY")).NormalizeName();
        var nagCell = cell("NAG");
        var transporter = ExcelCells.Text(cell("LORRY WALA")).NormalizeName();
        var comments = ExcelCells.Text(cell("COMMENTS")).NormalizeName();
        if (party.Length == 0)
        {
            if (!ExcelCells.IsZeroOrBlank(nagCell) || transporter.Length > 0 || comments.Length > 0)
                warnings.Add(new ImportIssue(row, "Row skipped: it has NAG, LORRY WALA or COMMENTS but no party."));
            return null;
        }

        var errorCount = errors.Count;
        var numberText = ExcelCells.Text(cell("AAWAK NO"));
        if (!AawakNumber.TryParse(numberText, out var number, out var suffix))
            errors.Add(new ImportIssue(row, numberText.Length == 0 ? "AAWAK NO is blank." : $"AAWAK NO \"{numberText}\" is not a number (with at most one letter, like 217A)."));
        var (inward, inwardError) = ExcelCells.WholeNumber(cell("INW NO"), "INW NO");
        if (inwardError is not null) warnings.Add(new ImportIssue(row, $"{inwardError} It is left out; COMMENTS are still read."));
        var date = ExcelCells.Date(cell("DATE"));
        if (date is null) errors.Add(new ImportIssue(row, $"DATE is not a valid date ({ExcelCells.Text(cell("DATE"))})."));
        var (nag, nagError) = ExcelCells.WholeNumber(nagCell, "NAG");
        if (nagError is not null) errors.Add(new ImportIssue(row, nagError));
        else if (nag is null or < 1) errors.Add(new ImportIssue(row, "NAG must be 1 or more."));
        if (transporter.Length == 0) errors.Add(new ImportIssue(row, "LORRY WALA is blank."));
        if (errors.Count != errorCount) return null;
        return new AawakRow(row, number, suffix, Math.Max(inward ?? 0, 0), Dates.Iso(date!.Value), party, nag!.Value, transporter, comments);
    }

    /// <summary>The Details sheet's tables, found by their headers; empty when the sheet is missing or laid out differently.</summary>
    private static AawakDetails ReadDetails(string filePath)
    {
        List<object?[]>? grid;
        try
        {
            grid = ExcelWorkbook.ReadSheet(filePath, DetailsSheet, 1);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            return AawakDetails.Empty;
        }
        if (grid is null) return AawakDetails.Empty;
        string Text(int r, int c) => c < grid[r].Length ? ExcelCells.Text(grid[r][c]).NormalizeName() : string.Empty;
        bool Yes(int r, int c) => !string.Equals(Text(r, c), "No", StringComparison.OrdinalIgnoreCase);

        var parties = new Dictionary<string, (bool, string)>(StringComparer.OrdinalIgnoreCase);
        var transporters = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        for (var r = 0; r < grid.Count; r++)
        {
            for (var c = 0; c + 1 < grid[r].Length; c++)
            {
                var header = Text(r, c);
                if (!string.Equals(Text(r, c + 1), "Active", StringComparison.OrdinalIgnoreCase)) continue;
                var isParty = string.Equals(header, "Party", StringComparison.OrdinalIgnoreCase) && string.Equals(Text(r, c + 2), "Party Group", StringComparison.OrdinalIgnoreCase);
                var isTransporter = string.Equals(header, "Lorry Wala", StringComparison.OrdinalIgnoreCase);
                if (!isParty && !isTransporter) continue;
                for (var below = r + 1; below < grid.Count && Text(below, c).Length > 0; below++)
                {
                    if (isParty) parties.TryAdd(Text(below, c), (Yes(below, c + 1), Text(below, c + 2)));
                    else transporters.TryAdd(Text(below, c), Yes(below, c + 1));
                }
            }
        }
        return new AawakDetails(parties, transporters);
    }
}
