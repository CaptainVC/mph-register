using MPHRegister.Contracts.Imports;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Imports.Inward;

public sealed record InwardSheet(IReadOnlyList<InwardRow> Rows, IReadOnlyList<ImportIssue> Warnings, IReadOnlyList<ImportIssue> Errors);

/// <summary>
/// Reads the inward register's Main sheet. Handles what the April–November registers contain:
/// carryover rows after blank rows, blank INW. NO., stray zero cells without a party, empty dispatch placeholders
/// (JAWAK NAG 0 / gate pass 0 / time-only date), text or impossible dispatch dates, very wide sheets, all-zero
/// slips (THAN entered and billed in the earlier register; see AllZeroSlip), and repairs marked only by R in LOT N. or D.N.
/// (see RepairMark).
/// </summary>
public static class InwardSheetReader
{
    public const string SheetName = "Main";

    private static readonly string[] RequiredHeaders =
    [
        "INW. NO.", "DATE", "PARTY", "D.N.", "LOT N.", "REP.", "THAN", "TP", "NAG", "FINISH", "NETT THAN", "TWO PART",
        "JAWAK NAG 1", "GATE PASS NO 1", "DATE 1", "JAWAK NAG 2", "GATE PASS NO 2", "DATE 2",
        "JAWAK NAG 3", "GATE PASS NO 3", "DATE 3",
    ];

    private static readonly string[] StrayCheckHeaders = RequiredHeaders.Except(["INW. NO.", "REP.", "PARTY", "NAG", "NETT THAN", "DATE"]).ToArray();

    public static InwardSheet Read(string filePath)
    {
        var warnings = new List<ImportIssue>();
        var errors = new List<ImportIssue>();
        var grid = ExcelWorkbook.ReadSheet(filePath, SheetName, RequiredHeaders.Length);
        if (grid is null)
        {
            errors.Add(new ImportIssue(0, $"The workbook has no sheet named \"{SheetName}\"."));
            return new InwardSheet([], warnings, errors);
        }
        if (grid.Count == 0)
        {
            errors.Add(new ImportIssue(1, "The Main sheet is empty."));
            return new InwardSheet([], warnings, errors);
        }

        var headers = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var c = 0; c < grid[0].Length; c++)
        {
            var name = ExcelCells.Text(grid[0][c]).NormalizeName();
            if (name.Length > 0) headers.TryAdd(name, c);
        }
        var missing = RequiredHeaders.Where(h => !headers.ContainsKey(h)).ToList();
        if (missing.Count > 0)
        {
            errors.Add(new ImportIssue(1, $"Missing columns: {string.Join(", ", missing)}"));
            return new InwardSheet([], warnings, errors);
        }
        var shortColumn = headers.TryGetValue("SHORT THAN", out var sc) ? sc : (int?)null;

        var rows = new List<InwardRow>();
        var sawBlankAfterData = false;
        for (var r = 1; r < grid.Count; r++)
        {
            var cells = grid[r];
            var row = r + 1;
            object? Cell(string header) => headers[header] < cells.Length ? cells[headers[header]] : null;
            var party = ExcelCells.Text(Cell("PARTY")).NormalizeName();
            if (party.Length == 0)
            {
                if (rows.Count > 0) sawBlankAfterData = true;
                var stray = StrayCheckHeaders.Where(h => ExcelCells.Text(Cell(h)).Length > 0).ToList();
                if (stray.Count == 0) continue;
                if (stray.All(h => ExcelCells.IsZeroOrBlank(Cell(h))))
                    warnings.Add(new ImportIssue(row, $"Row skipped: it has only zero in {string.Join(", ", stray)} and no party."));
                else
                    errors.Add(new ImportIssue(row, $"Row has data ({string.Join(", ", stray)}) but no party."));
                continue;
            }
            var parsed = ReadRow(row, party, Cell, shortColumn is { } s && s < cells.Length ? cells[s] : null, sawBlankAfterData, warnings, errors);
            if (parsed is not null) rows.Add(parsed);
        }
        if (rows.Count == 0 && errors.Count == 0) errors.Add(new ImportIssue(0, "No entries with a party were found."));

        foreach (var group in rows.Where(e => !e.AfterBlankRows && e.InwardNo > 0).GroupBy(e => e.InwardNo).Where(g => g.Count() > 1))
            warnings.Add(new ImportIssue(group.First().Row, $"INW. NO. {group.Key} appears on rows {string.Join(", ", group.Select(e => e.Row))}."));
        return new InwardSheet(rows, warnings, errors);
    }

    private static InwardRow? ReadRow(int row, string party, Func<string, object?> cell, object? shortCell, bool afterBlank, List<ImportIssue> warnings, List<ImportIssue> errors)
    {
        var errorCount = errors.Count;
        int? Whole(object? value, string column)
        {
            var (number, error) = ExcelCells.WholeNumber(value, column);
            if (error is not null) errors.Add(new ImportIssue(row, error));
            return number;
        }

        var inward = Whole(cell("INW. NO."), "INW. NO.");
        if (inward is null && ExcelCells.Text(cell("INW. NO.")).Length == 0)
        {
            warnings.Add(new ImportIssue(row, "INW. NO. is blank; saved as 0. Give it a number in the Register."));
            inward = 0;
        }
        var date = ExcelCells.Date(cell("DATE"));
        if (date is null) errors.Add(new ImportIssue(row, $"DATE is not a valid date ({ExcelCells.Text(cell("DATE"))})."));
        var than = Whole(cell("THAN"), "THAN") ?? 0;
        var tp = Whole(cell("TP"), "TP") ?? 0;
        var twoPart = Whole(cell("TWO PART"), "TWO PART") ?? 0;
        var shortThan = Whole(shortCell, "SHORT THAN");
        if (shortThan is { } st && st > than) warnings.Add(new ImportIssue(row, $"SHORT THAN ({st}) is more than THAN ({than}); check it."));
        var repairText = ExcelCells.Text(cell("REP.")).ToUpperInvariant();
        if (repairText is not ("YES" or "NO" or "")) warnings.Add(new ImportIssue(row, $"REP. value \"{ExcelCells.Text(cell("REP."))}\" treated as No."));
        var repair = repairText == "YES";
        var designNo = ExcelCells.Text(cell("D.N."));
        var lotNo = ExcelCells.Text(cell("LOT N."));
        // Repairs are not charged; the R in LOT N. or D.N. says so even when REP. was left at No.
        var markedRepair = !repair && RepairMark.In(lotNo, designNo);
        if (markedRepair)
        {
            warnings.Add(new ImportIssue(row, "LOT N. or D.N. is marked R (repair) but REP. is No; saved as a repair (REP. Yes), which is not charged."));
            repair = true;
        }
        var finish = ExcelCells.Text(cell("FINISH")).NormalizeName();

        var sheetNag = Whole(cell("NAG"), "NAG");
        var sheetNett = Whole(cell("NETT THAN"), "NETT THAN");
        if (sheetNag is not null && sheetNag != than + tp) warnings.Add(new ImportIssue(row, $"Sheet NAG is {sheetNag} but THAN + TP is {than + tp}."));
        // NETT THAN is a formula (THAN, or 0 for a repair); a figure typed over it ("1 than bina finish": 23 of 24) is what is charged.
        var nettLess = 0;
        if (sheetNett is not null && !markedRepair && sheetNett != (repair ? 0 : than))
        {
            if (repair)
            {
                warnings.Add(new ImportIssue(row, $"Sheet NETT THAN is {sheetNett} but expected 0 for a repair."));
            }
            else
            {
                nettLess = than - sheetNett.Value;
                warnings.Add(new ImportIssue(row, $"Sheet NETT THAN is {sheetNett}, not THAN ({than}); saved as {sheetNett} charged."));
            }
        }
        // Added once the dispatches are read: an all-zero slip (billed in an earlier register) needs neither.
        var quantityWarningsAt = warnings.Count;

        var inwardDate = date is { } d ? Dates.Iso(d) : null;
        var dispatches = new List<InwardDispatch>();
        for (var i = 1; i <= 3; i++)
        {
            var qtyCell = cell($"JAWAK NAG {i}");
            var gateCell = cell($"GATE PASS NO {i}");
            var dateCell = cell($"DATE {i}");
            if (ExcelCells.Text(qtyCell).Length == 0 && ExcelCells.Text(gateCell).Length == 0 && ExcelCells.Text(dateCell).Length == 0) continue;
            if (ExcelCells.IsZeroOrBlank(qtyCell) && ExcelCells.IsZeroOrBlank(gateCell) && ExcelCells.Date(dateCell) is null)
            {
                warnings.Add(new ImportIssue(row, $"Dispatch {i} is an empty placeholder (JAWAK NAG 0); skipped."));
                continue;
            }
            var qty = Whole(qtyCell, $"JAWAK NAG {i}");
            if (qty is null && ExcelCells.Text(qtyCell).Length == 0) errors.Add(new ImportIssue(row, $"Dispatch {i} has a gate pass or date but no JAWAK NAG."));
            var gatePass = ExcelCells.Text(gateCell);
            var dispatchDate = ExcelCells.Date(dateCell) is { } dd ? Dates.Iso(dd) : null;
            string? dateText = null;
            if (dispatchDate is null && ExcelCells.Text(dateCell).Length > 0)
            {
                dateText = ExcelCells.IsImplausibleDate(dateCell) ? ExcelCells.Text(dateCell, "dd.MM.yyyy") : ExcelCells.Text(dateCell);
                warnings.Add(new ImportIssue(row, $"DATE {i} \"{dateText}\" is not a real date; kept as text. Fix it in the Register."));
            }
            else if (dispatchDate is null)
            {
                warnings.Add(new ImportIssue(row, $"Dispatch {i} has no date."));
            }
            else if (inwardDate is not null && string.CompareOrdinal(dispatchDate, inwardDate) < 0)
            {
                warnings.Add(new ImportIssue(row, $"DATE {i} ({dispatchDate}) is before the inward date ({inwardDate})."));
            }
            if (gatePass.Length == 0) warnings.Add(new ImportIssue(row, $"Dispatch {i} has no gate pass number."));
            dispatches.Add(new InwardDispatch(qty ?? 0, gatePass, dispatchDate, dateText));
        }

        if (!AllZeroSlip.Is(than, tp, twoPart, dispatches.Count))
        {
            var quantityWarnings = new List<ImportIssue>();
            // A repair is not charged, so it needs no finish to find a rate.
            if (finish.Length == 0 && !repair) quantityWarnings.Add(new ImportIssue(row, "FINISH is blank."));
            if (than + tp <= 0) quantityWarnings.Add(new ImportIssue(row, "THAN + TP is 0."));
            warnings.InsertRange(quantityWarningsAt, quantityWarnings);
        }

        var available = than + tp + twoPart;
        var dispatched = dispatches.Sum(x => x.Qty);
        if (dispatched > available) warnings.Add(new ImportIssue(row, $"Dispatched ({dispatched}) is more than NAG + TWO PART ({available})."));
        if (afterBlank) warnings.Add(new ImportIssue(row, $"Entry after blank rows treated as a carryover (INW. NO. {inward})."));
        if (errors.Count != errorCount) return null;
        return new InwardRow(row, inward!.Value, inwardDate!, party, designNo, lotNo, repair,
            than, tp, twoPart, finish, shortThan, afterBlank, dispatches) { RepairFromMark = markedRepair, NettLess = nettLess };
    }
}
