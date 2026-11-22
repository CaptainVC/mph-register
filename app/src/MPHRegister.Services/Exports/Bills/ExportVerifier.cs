using MPHRegister.Contracts.Billing;
using MPHRegister.Services.Imports.Bills;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Exports.Bills;

/// <summary>
/// Checks a filled workbook before it is offered: the bills read back as the app's bills, Excel's formulas will work out
/// the app's figures, and nothing else in the workbook changed.
/// </summary>
internal static class ExportVerifier
{
    private const int MaxReported = 8;

    public static List<string> Check(BillWorkbook before, BillSheet beforeBills, byte[] saved, IReadOnlyList<(BillSlot Slot, InvoiceDoc Doc)> written, HashSet<string> changedOutside)
    {
        var problems = new List<string>();
        var after = BillWorkbook.Open(saved);
        if (after is null) return ["The filled workbook has no Main sheet."];

        var read = BillExporter.ReadBack(saved);
        if (read is null)
        {
            problems.Add("The filled workbook could not be read back.");
        }
        else
        {
            foreach (var (slot, doc) in written)
            {
                var bill = read.Bills.FirstOrDefault(b => string.Equals(b.Cell, slot.Name, StringComparison.OrdinalIgnoreCase));
                if (bill is null) problems.Add($"{doc.InvoiceNo} is not at {slot.Name} when the workbook is read back.");
                else problems.AddRange(SheetBillComparer.Differences(bill, doc).Select(d => $"{doc.InvoiceNo} read back — {d}"));
            }
            var writtenCells = written.Select(w => w.Slot.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var old in beforeBills.Bills.Where(b => !writtenCells.Contains(b.Cell)))
            {
                var now = read.Bills.FirstOrDefault(b => string.Equals(b.Cell, old.Cell, StringComparison.OrdinalIgnoreCase));
                if (now is null || now.InvoiceNo != old.InvoiceNo || now.PartyText != old.PartyText || now.Total != old.Total
                    || now.BillDate != old.BillDate || now.PeriodFrom != old.PeriodFrom || now.PeriodTo != old.PeriodTo)
                    problems.Add($"The bill already at {old.Cell} ({old.InvoiceNo}) would change.");
            }
        }

        foreach (var (slot, doc) in written) problems.AddRange(ExcelView(after, slot, doc).Select(d => $"{doc.InvoiceNo} as Excel will work it out — {d}"));
        problems.AddRange(OtherCells(before, after, written.Select(w => w.Slot).ToList(), changedOutside));
        problems.AddRange(OtherParts(before, after));
        return problems.Take(MaxReported * 3).ToList();
    }

    /// <summary>Works the bill out from the written cells the way Excel's formulas do, and compares it with the app's bill.</summary>
    internal static List<string> ExcelView(BillWorkbook book, BillSlot slot, InvoiceDoc doc)
    {
        var found = new List<string>();
        var details = book.Details;
        void Expect<T>(string what, T shows, T wanted)
        {
            if (!EqualityComparer<T>.Default.Equals(shows, wanted)) found.Add($"{what} shows {shows?.ToString() ?? "nothing"}, the bill has {wanted?.ToString() ?? "nothing"}");
        }
        var party = book.Cell(slot, BillSlot.PartyRow, Col.A).Text;
        Expect("Party", party, doc.PartyName.Trim());
        string? Lookup(int row, int column)
        {
            var cell = book.Cell(slot, row, Col.A);
            if (!cell.HasFormula) return cell.Text;
            if (!BillWorkbook.IsLookupFormula(slot, cell.Formula, column)) return "(a formula that cannot be checked)";
            if (details.PartyRow(party) is null) return string.Empty;
            if (details.LookupText(party, column) is not { } text) return "(an empty Details cell)";
            return column == DetailsSheet.GstinColumn ? $"GSTIN: {text}" : text;
        }
        Expect("Address", Lookup(BillSlot.AddressRow, DetailsSheet.AddressColumn), doc.Address.Trim());
        Expect("State", Lookup(BillSlot.StateRow, DetailsSheet.StateColumn), doc.State.Trim());
        Expect("GSTIN", Lookup(BillSlot.GstinRow, DetailsSheet.GstinColumn), doc.Gstin.Trim().Length == 0 ? string.Empty : $"GSTIN: {doc.Gstin.Trim()}");
        Expect("Bill no.", book.Numbers()[slot.Index], doc.InvoiceNo);
        Expect("Bill date", BillWorkbook.DateOf(book.Copies(BillSlot.DateRow)[slot.Index]), (DateOnly?)Dates.ParseIsoOrDefault(doc.BillDate));
        Expect("Period", BillWorkbook.PeriodOf(book.Copies(BillSlot.PeriodRow)[slot.Index]),
            ((DateOnly?)Dates.ParseIsoOrDefault(doc.PeriodFrom), (DateOnly?)Dates.ParseIsoOrDefault(doc.PeriodTo)));

        var lines = SheetBillComparer.Trimmed(doc.Lines);
        var qty = new Dictionary<int, decimal?>();
        long gross = 0;
        for (var i = 0; i < BillSheetReader.LineRows; i++)
        {
            var row = BillSlot.FirstLineRow + i;
            var line = i < lines.Count ? lines[i] : null;
            var kind = line?.Kind ?? LineKind.Blank;
            var label = $"Line {i + 1}";
            Expect($"{label} G.P.N.", book.Cell(slot, row, Col.A).Text, kind == LineKind.Blank ? string.Empty : (line!.Gpn ?? string.Empty).Trim());
            Expect($"{label} D.N.", book.Cell(slot, row, Col.B).Text, kind == LineKind.Blank ? string.Empty : (line!.Dn ?? string.Empty).Trim());
            Expect($"{label} LOT NO.", book.Cell(slot, row, Col.C).Text, kind == LineKind.Blank ? string.Empty : (line!.Lot ?? string.Empty).Trim());
            var finish = book.Cell(slot, row, Col.D).Text;
            Expect($"{label} FINISH", finish, kind == LineKind.Priced ? (line!.Finish ?? string.Empty).Trim() : string.Empty);

            qty[row] = Quantity(book, slot, row, qty, found, label);
            Expect($"{label} THAN", qty[row], kind == LineKind.Blank ? null : (decimal?)line!.Qty);

            var rate = Rate(book, slot, row, party, finish, found, label);
            Expect($"{label} rate", rate, kind == LineKind.Priced ? line!.Rate : null);
            var amount = rate is { } r ? Money.RoundRupee(r * (qty[row] ?? 0)) : (long?)null;
            Expect($"{label} amount", amount, kind == LineKind.Priced && line!.Rate is { } wantedRate ? line.Amount ?? Money.RoundRupee(wantedRate * (line.Qty ?? 0)) : null);
            gross += amount ?? 0;
        }
        Expect("Gross", gross, doc.Gross);

        var discountCell = book.Cell(slot, BillSlot.DiscountRow, Col.G);
        long? discount = null;
        if (!discountCell.HasFormula) discount = discountCell.Value is double d ? (long)Math.Round(d) : null;
        else if (!BillWorkbook.IsLookupFormula(slot, discountCell.Formula, DetailsSheet.DiscountColumn)) found.Add("the discount formula cannot be checked");
        else if (details.PartyRow(party) is not null)
        {
            if (details.DiscountOf(party) is { } pct) discount = Money.RoundRupee(gross * pct / 100m);
            else found.Add("the discount comes from an empty Details cell");
        }
        var taxable = discount is { } dis ? gross - dis : 0;
        Expect("Discount", discount ?? 0, doc.Discount);
        Expect("Taxable", taxable, doc.Taxable);
        var cgstRate = book.Cell(slot, BillSlot.CgstRow, Col.F).Value is double c ? (decimal)c : 0m;
        var sgstRate = book.Cell(slot, BillSlot.SgstRow, Col.F).Value is double s ? (decimal)s : 0m;
        var cgst = Money.RoundRupee(taxable * cgstRate);
        var sgst = Money.RoundRupee(taxable * sgstRate);
        Expect("CGST", cgst, doc.Cgst);
        Expect("SGST", sgst, doc.Sgst);
        Expect("Total", taxable + cgst + sgst, doc.Total);
        return found.Take(MaxReported).ToList();
    }

    private static decimal? Quantity(BillWorkbook book, BillSlot slot, int row, Dictionary<int, decimal?> above, List<string> found, string label)
    {
        var cell = book.Cell(slot, row, Col.E);
        if (!cell.HasFormula) return cell.Value is double d ? (decimal)d : null;
        var refs = FormulaText.RelativeReferences(cell.Formula!);
        var text = FormulaText.Normalize(cell.Formula!);
        var first = slot.Ref(BillSlot.FirstLineRow, Col.E);
        var rows = above.Keys.Where(r => text == $"SUM({slot.Ref(r, Col.E)}:{slot.Ref(row - 1, Col.E)})").ToList();
        if (refs.Count == 2 && rows.Count == 1) return above.Where(a => a.Key >= rows[0] && a.Key < row).Sum(a => a.Value ?? 0);
        found.Add($"{label} THAN has a formula that cannot be checked ({cell.Formula}; first line is {first})");
        return null;
    }

    private static decimal? Rate(BillWorkbook book, BillSlot slot, int row, string party, string finish, List<string> found, string label)
    {
        var cell = book.Cell(slot, row, Col.F);
        if (!cell.HasFormula) return cell.Value is double d ? (decimal)d : null;
        if (!BillWorkbook.IsRateFormula(slot, row, cell.Formula))
        {
            found.Add($"{label} rate has a formula that cannot be checked");
            return null;
        }
        if (book.Details.RateBlank(party, finish)) return null;
        if (book.Details.RateOf(party, finish) is { } rate) return rate;
        found.Add($"{label} rate comes from a Details cell that is empty or not a number");
        return null;
    }

    /// <summary>Every cell outside the written bills is as it was (linked bill no., date and period formulas may show new values).</summary>
    private static List<string> OtherCells(BillWorkbook before, BillWorkbook after, List<BillSlot> written, HashSet<string> changedOutside)
    {
        var problems = new List<string>();
        foreach (var reference in before.Main.References.Union(after.Main.References, StringComparer.OrdinalIgnoreCase))
        {
            var (row, column) = A1.Parse(reference);
            if (written.Any(s => s.Contains(row, column)) || changedOutside.Contains(reference)) continue;
            var was = before.Main.Get(reference);
            var now = after.Main.Get(reference);
            var rowInBill = ((row - 1) % BillSlot.Rows) + 1;
            var linkCell = column % BillSheetReader.BlockColumns == Col.F && rowInBill is BillSlot.NumberRow or BillSlot.DateRow or BillSlot.PeriodRow;
            if (linkCell && was.HasFormula && now.Formula == was.Formula) continue;
            if (was.Formula != now.Formula || was.Text != now.Text)
            {
                problems.Add($"Cell {reference} would change although no bill is written there.");
                if (problems.Count >= MaxReported) break;
            }
        }
        return problems;
    }

    /// <summary>Only the Main sheet, the shared texts and the calculation settings change; every other part is copied as it was.</summary>
    private static List<string> OtherParts(BillWorkbook before, BillWorkbook after)
    {
        var problems = new List<string>();
        var package = before.Package;
        var workbook = package.WorkbookPart();
        var folder = workbook.Contains('/', StringComparison.Ordinal) ? workbook[..(workbook.LastIndexOf('/') + 1)] : string.Empty;
        var mayChange = new HashSet<string>(StringComparer.Ordinal)
        {
            before.MainPart, workbook, $"{folder}_rels/{workbook[(workbook.LastIndexOf('/') + 1)..]}.rels", "[Content_Types].xml",
        };
        if (package.WorkbookRelated("sharedStrings") is { } strings) mayChange.Add(strings);
        var calcChain = package.WorkbookRelated("calcChain");
        foreach (var name in package.Names)
        {
            if (!after.Package.Has(name))
            {
                if (name != calcChain) problems.Add($"Part {name} would be lost.");
            }
            else if (!mayChange.Contains(name) && !package.Bytes(name).AsSpan().SequenceEqual(after.Package.Bytes(name)))
            {
                problems.Add($"Part {name} would change.");
            }
        }
        problems.AddRange(after.Package.Names.Where(n => !package.Has(n)).Select(n => $"Part {n} would be added."));
        for (var i = 0; i < before.Strings.Count; i++)
        {
            if (before.Strings.Get(i) == after.Strings.Get(i)) continue;
            problems.Add("The workbook's shared texts would change.");
            break;
        }
        return problems;
    }
}
