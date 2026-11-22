using System.Globalization;
using MPHRegister.Contracts.Billing;
using MPHRegister.Services.Imports.Bills;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Exports.Bills;

/// <summary>A bill written (or found already there) in the workbook.</summary>
internal sealed record ExportedBill(long InvoiceId, string InvoiceNo, string Cell);

/// <summary>The preview, and the filled workbook when at least one bill was written and every check passed.</summary>
internal sealed record ExportResult(BillExportPreview Preview, byte[]? Content, IReadOnlyList<ExportedBill> InWorkbook);

/// <summary>
/// Writes saved bills into their places in the bill workbook, the way they would be typed by hand: party, lines, THAN and
/// merged-row =SUM. Each workbook formula (address, rate, discount, dates) is kept when it already shows the app's value and
/// replaced by the typed value when it would not. Nothing outside the written bills changes, except a first bill no. for an
/// empty workbook and a later bill's date or period that would otherwise follow a typed one.
/// </summary>
internal static class BillExporter
{
    private const int MaxLines = BillSheetReader.LineRows;

    public static ExportResult Run(byte[] bytes, string fileName, IReadOnlyList<InvoiceDoc> docs, IReadOnlySet<long> replace)
    {
        ArgumentNullException.ThrowIfNull(bytes);
        ArgumentNullException.ThrowIfNull(docs);
        ArgumentNullException.ThrowIfNull(replace);
        BillWorkbook? book;
        try
        {
            book = BillWorkbook.Open(bytes);
        }
        catch (Exception ex) when (ex is InvalidDataException or System.Xml.XmlException or FormatException or IOException)
        {
            return Failed(fileName, docs, $"Could not read the workbook: {ex.Message}");
        }
        if (book is null) return Failed(fileName, docs, "The workbook has no sheet named \"Main\".");
        if (book.LayoutProblems() is { Count: > 0 } layout) return Failed(fileName, docs, [.. layout]);
        var original = ReadBills(bytes);
        if (original is null) return Failed(fileName, docs, "Could not read the bills already in the workbook.");

        var filled = BillSlot.All.Where(book.Filled).Select(s => s.Index).ToHashSet();
        var notes = new List<string>();
        var ordered = docs.OrderBy(d => SerialOf(d.InvoiceNo)).ThenBy(d => d.InvoiceNo, StringComparer.Ordinal).ToList();
        StartEmptyWorkbook(book, filled, ordered, notes);
        var numbers = book.Numbers();

        var plans = ordered.Select(doc => Plan(book, doc, numbers, filled, original, replace)).ToList();
        var writing = plans.Where(p => p.Status is BillExportStatus.Write or BillExportStatus.Replace).OrderBy(p => p.Slot!.Value.Index).ToList();
        byte[]? content = null;
        var problems = new List<string>();
        if (writing.Count > 0)
        {
            var originalBook = BillWorkbook.Open(bytes)!;
            var changedOutside = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (notes.Count > 0) changedOutside.Add(new BillSlot(0).Ref(BillSlot.NumberRow, Col.F));
            foreach (var plan in writing) WriteBill(book, plan);
            var written = writing.Select(p => p.Slot!.Value.Index).ToHashSet();
            foreach (var plan in writing)
            {
                SetCopied(book, plan, BillSlot.DateRow, BillWorkbook.DotDate(Dates.ParseIsoOrDefault(plan.Doc.BillDate)), "bill date", written, filled, numbers, notes, changedOutside);
                SetCopied(book, plan, BillSlot.PeriodRow, BillWorkbook.PeriodText(Dates.ParseIsoOrDefault(plan.Doc.PeriodFrom), Dates.ParseIsoOrDefault(plan.Doc.PeriodTo)),
                    "period", written, filled, numbers, notes, changedOutside);
            }
            UpdateChainResults(book);
            book.Strings.UpdateCounts();
            book.Package.MarkChanged(book.MainPart);
            if (book.Package.WorkbookRelated("sharedStrings") is { } strings && book.Package.Has(strings)) book.Package.MarkChanged(strings);
            book.Package.RemoveCalcChain();
            book.Package.RecalculateOnOpen();
            var saved = book.Package.Save();
            problems.AddRange(ExportVerifier.Check(originalBook, original, saved, writing.Select(p => (p.Slot!.Value, p.Doc)).ToList(), changedOutside));
            if (problems.Count == 0) content = saved;
            else problems.Insert(0, "The filled workbook did not pass the checks, so it is not offered (please report this):");
        }

        var firstNumbers = book.Numbers();
        var rows = plans.Select(p => new BillExportRow(p.Doc.Id ?? 0, p.Doc.InvoiceNo ?? string.Empty, p.Doc.PartyName, p.Doc.BillDate, p.Doc.Total, p.Status,
            p.Slot?.Place, p.Typed, p.Differences, p.Problems)).ToList();
        var preview = new BillExportPreview(fileName, firstNumbers[0], firstNumbers[^1], filled.Count, BillSlot.Count, rows, notes, problems,
            content is null ? 0 : writing.Count);
        var inWorkbook = content is null ? [] : plans.Where(p => p.Status is BillExportStatus.Write or BillExportStatus.Replace or BillExportStatus.Same)
            .Select(p => new ExportedBill(p.Doc.Id ?? 0, p.Doc.InvoiceNo ?? string.Empty, p.Slot!.Value.Name)).ToList();
        return new ExportResult(preview, content, inWorkbook);
    }

    private sealed class SlotPlan(InvoiceDoc doc)
    {
        public InvoiceDoc Doc { get; } = doc;

        public BillSlot? Slot { get; set; }

        public BillExportStatus Status { get; set; } = BillExportStatus.Blocked;

        public List<string> Typed { get; } = [];

        public List<string> Differences { get; } = [];

        public List<string> Problems { get; } = [];
    }

    private static SlotPlan Plan(BillWorkbook book, InvoiceDoc doc, string?[] numbers, HashSet<int> filled, BillSheet original, IReadOnlySet<long> replace)
    {
        var plan = new SlotPlan(doc);
        plan.Problems.AddRange(BillProblems(doc));
        var index = Array.FindIndex(numbers, n => string.Equals(n?.Trim(), doc.InvoiceNo?.Trim(), StringComparison.OrdinalIgnoreCase));
        if (index < 0)
        {
            var range = numbers[0] is null ? "it has no bill numbers" : $"its places are {numbers[0]} to {numbers.LastOrDefault(n => n is not null)}";
            plan.Problems.Add($"Bill no. {doc.InvoiceNo} is not in this workbook ({range}).");
            return plan;
        }
        var slot = new BillSlot(index);
        plan.Slot = slot;
        if (plan.Problems.Count > 0) return plan;
        if (filled.Contains(index))
        {
            var there = original.Bills.FirstOrDefault(b => string.Equals(b.Cell, slot.Name, StringComparison.OrdinalIgnoreCase));
            if (there is null)
            {
                plan.Problems.Add($"Its place ({slot.Place}) already has something in it that is not a complete bill. Clear it in Excel first.");
                return plan;
            }
            if (!string.Equals(there.PartyText.NormalizeName(), doc.PartyName.NormalizeName(), StringComparison.OrdinalIgnoreCase))
            {
                plan.Problems.Add($"Its place ({slot.Place}) already has a bill for {there.PartyText}.");
                return plan;
            }
            plan.Differences.AddRange(SheetBillComparer.Differences(there, doc));
            if (plan.Differences.Count == 0)
            {
                plan.Status = BillExportStatus.Same;
                return plan;
            }
            if (!replace.Contains(doc.Id ?? 0))
            {
                plan.Status = BillExportStatus.Different;
                return plan;
            }
        }
        if (book.ChangedTotalsCell(slot) is { } cell)
        {
            plan.Problems.Add($"The amount or total formula in {cell} is not the bill layout's, so the bill cannot be written there. Write it by hand.");
            return plan;
        }
        plan.Status = filled.Contains(index) ? BillExportStatus.Replace : BillExportStatus.Write;
        return plan;
    }

    /// <summary>Why a bill cannot go into the workbook at all, whatever its place.</summary>
    private static List<string> BillProblems(InvoiceDoc doc)
    {
        var problems = new List<string>();
        if (doc.Status != InvoiceStatus.Saved) problems.Add("Only saved bills can be written to Excel; this one is cancelled.");
        if (doc.TaxMode == TaxMode.Inter || doc.Igst != 0) problems.Add("It has IGST, and the bill workbook has only CGST and SGST rows.");
        var lines = SheetBillComparer.Trimmed(doc.Lines);
        if (lines.Count > MaxLines) problems.Add($"It has {lines.Count} lines; a bill in the workbook holds {MaxLines}. Split it in the app first.");
        var noFinish = lines.Select((l, i) => (Line: l, Number: i + 1)).Where(x => x.Line.Kind == LineKind.Priced && string.IsNullOrWhiteSpace(x.Line.Finish)).Select(x => x.Number).ToList();
        if (noFinish.Count > 0) problems.Add($"Line {string.Join(", ", noFinish)} has an amount but no FINISH; the workbook needs the FINISH on priced lines.");
        if (!Dates.TryParseIso(doc.BillDate, out _) || !Dates.TryParseIso(doc.PeriodFrom, out _) || !Dates.TryParseIso(doc.PeriodTo, out _))
            problems.Add("Its bill date or period is not a date.");
        return problems;
    }

    /// <summary>An empty workbook starts at the lowest bill being written when its first number would not reach the bills.</summary>
    private static void StartEmptyWorkbook(BillWorkbook book, HashSet<int> filled, List<InvoiceDoc> ordered, List<string> notes)
    {
        if (filled.Count > 0) return;
        var lowest = ordered.FirstOrDefault(d => BillProblems(d).Count == 0);
        if (lowest?.InvoiceNo is not { } number) return;
        var numbers = book.Numbers();
        if (numbers.Any(n => string.Equals(n?.Trim(), number.Trim(), StringComparison.OrdinalIgnoreCase))) return;
        var first = new BillSlot(0);
        if (book.Cell(first, BillSlot.NumberRow, Col.F).HasFormula) return;
        var was = book.Cell(first, BillSlot.NumberRow, Col.F).Text;
        book.Main.SetText(first.Ref(BillSlot.NumberRow, Col.F), number.Trim());
        notes.Add($"The workbook had no bills, so its first bill no. (F7) is now {number.Trim()}{(was.Length > 0 ? $" (it was {was})" : string.Empty)}.");
    }

    // ---------- Writing one bill ----------

    private static void WriteBill(BillWorkbook book, SlotPlan plan)
    {
        var slot = plan.Slot!.Value;
        var doc = plan.Doc;
        var main = book.Main;
        var details = book.Details;
        var party = doc.PartyName.Trim();
        main.SetText(slot.Ref(BillSlot.PartyRow, Col.A), party);
        var inDetails = details.PartyRow(party) is not null;
        if (!inDetails) plan.Typed.Add("The party is not on the Details sheet, so its address, state, GSTIN, rates and discount are typed into the bill.");

        WriteLookup(book, plan, BillSlot.AddressRow, DetailsSheet.AddressColumn, doc.Address.Trim(), "Address", inDetails);
        WriteLookup(book, plan, BillSlot.StateRow, DetailsSheet.StateColumn, doc.State.Trim(), "State", inDetails);
        WriteLookup(book, plan, BillSlot.GstinRow, DetailsSheet.GstinColumn, doc.Gstin.Trim().Length == 0 ? string.Empty : $"GSTIN: {doc.Gstin.Trim()}", "GSTIN", inDetails);
        WriteLines(book, plan, party, inDetails);

        main.SetResult(slot.Ref(BillSlot.GrossRow, Col.G), doc.Gross);
        WriteDiscount(book, plan, party, inDetails);
        main.SetResult(slot.Ref(BillSlot.TaxableRow, Col.G), doc.Taxable);
        WriteTaxRate(book, plan, BillSlot.CgstRow, doc.CgstRate, "CGST");
        WriteTaxRate(book, plan, BillSlot.SgstRow, doc.SgstRate, "SGST");
        main.SetResult(slot.Ref(BillSlot.CgstRow, Col.G), doc.Cgst);
        main.SetResult(slot.Ref(BillSlot.SgstRow, Col.G), doc.Sgst);
        main.SetResult(slot.Ref(BillSlot.TotalRow, Col.G), doc.Total);
    }

    private static void WriteLookup(BillWorkbook book, SlotPlan plan, int row, int detailsColumn, string wanted, string label, bool inDetails)
    {
        var slot = plan.Slot!.Value;
        var reference = slot.Ref(row, Col.A);
        var cell = book.Cell(slot, row, Col.A);
        var lookedUp = book.Details.LookupText(plan.Doc.PartyName.Trim(), detailsColumn);
        var shown = lookedUp;
        if (lookedUp is not null && detailsColumn == DetailsSheet.GstinColumn) shown = $"GSTIN: {lookedUp}";
        if (wanted.Length > 0 && string.Equals(shown, wanted, StringComparison.Ordinal)
            && KeepFormula(book, slot, row, Col.A, cell, (s, f) => BillWorkbook.IsLookupFormula(s, f, detailsColumn), wanted))
            return;
        book.Main.SetText(reference, wanted);
        if (inDetails && cell.HasFormula)
        {
            var has = shown is null ? "nothing" : $"\"{shown}\"";
            plan.Typed.Add(wanted.Length == 0 ? $"{label} left empty (the Details sheet has {has})." : $"{label} typed in: \"{wanted}\" (the Details sheet has {has}).");
        }
    }

    private static void WriteLines(BillWorkbook book, SlotPlan plan, string party, bool inDetails)
    {
        var slot = plan.Slot!.Value;
        var main = book.Main;
        var lines = SheetBillComparer.Trimmed(plan.Doc.Lines);
        var typedRates = new Dictionary<(string Finish, decimal? Rate), List<int>>();
        var detailsRates = new Dictionary<string, decimal?>(StringComparer.OrdinalIgnoreCase);
        var runStart = -1;
        for (var i = 0; i < BillSheetReader.LineRows; i++)
        {
            var row = BillSlot.FirstLineRow + i;
            var line = i < lines.Count ? lines[i] : null;
            var kind = line?.Kind ?? LineKind.Blank;
            var text = kind == LineKind.Blank;
            main.SetText(slot.Ref(row, Col.A), text ? string.Empty : (line!.Gpn ?? string.Empty).Trim());
            main.SetText(slot.Ref(row, Col.B), text ? string.Empty : (line!.Dn ?? string.Empty).Trim());
            main.SetText(slot.Ref(row, Col.C), text ? string.Empty : (line!.Lot ?? string.Empty).Trim());
            var finish = kind == LineKind.Priced ? (line!.Finish ?? string.Empty).Trim() : string.Empty;
            main.SetText(slot.Ref(row, Col.D), finish);

            var qtyRef = slot.Ref(row, Col.E);
            if (kind == LineKind.Blank) main.Clear(qtyRef);
            else if (kind == LineKind.Priced && line!.AutoSum && runStart > 0)
                main.SetFormula(qtyRef, $"SUM({slot.Ref(runStart, Col.E)}:{slot.Ref(row - 1, Col.E)})", line.Qty ?? 0);
            else if (line!.Qty is { } qty) main.SetNumber(qtyRef, qty);
            else main.Clear(qtyRef);
            if (kind != LineKind.Detail) runStart = -1;
            else if (runStart < 0) runStart = row;

            var rate = kind == LineKind.Priced ? line!.Rate : null;
            var rateRef = slot.Ref(row, Col.F);
            var rateCell = book.Cell(slot, row, Col.F);
            var formulaShows = rate is null
                ? book.Details.RateBlank(party, finish)
                : book.Details.RateOf(party, finish) == rate;
            if (!(formulaShows && KeepFormula(book, slot, row, Col.F, rateCell, (s, f) => BillWorkbook.IsRateFormula(s, row, f), rate)))
            {
                if (rate is { } r) main.SetNumber(rateRef, r);
                else main.Clear(rateRef);
                if (inDetails && kind == LineKind.Priced)
                {
                    detailsRates[finish] = book.Details.RateOf(party, finish);
                    if (!typedRates.TryGetValue((finish, rate), out var at)) typedRates[(finish, rate)] = at = [];
                    at.Add(i + 1);
                }
            }
            var amount = kind == LineKind.Priced && rate is { } priced ? line!.Amount ?? Money.RoundRupee(priced * (line.Qty ?? 0)) : (long?)null;
            main.SetResult(slot.Ref(row, Col.G), amount);
        }
        foreach (var ((finish, rate), at) in typedRates)
        {
            var has = detailsRates[finish] is { } d ? $"has {Number(d)}" : "has no rate for it";
            var where = at.Count == 1 ? $"line {at[0]}" : $"lines {string.Join(", ", at)}";
            plan.Typed.Add(rate is { } r
                ? $"Rate for {finish} on {where}: {Number(r)} typed in (the Details sheet {has})."
                : $"Rate for {finish} on {where} left empty, as on the app's bill (the Details sheet {has}).");
        }
    }

    private static void WriteDiscount(BillWorkbook book, SlotPlan plan, string party, bool inDetails)
    {
        var slot = plan.Slot!.Value;
        var doc = plan.Doc;
        var cell = book.Cell(slot, BillSlot.DiscountRow, Col.G);
        var percent = book.Details.DiscountOf(party);
        var formulaShows = percent == doc.DiscountPct && Money.RoundRupee(doc.Gross * percent.Value / 100m) == doc.Discount;
        if (formulaShows && KeepFormula(book, slot, BillSlot.DiscountRow, Col.G, cell, (s, f) => BillWorkbook.IsLookupFormula(s, f, DetailsSheet.DiscountColumn), doc.Discount))
            return;
        book.Main.SetNumber(slot.Ref(BillSlot.DiscountRow, Col.G), doc.Discount);
        if (inDetails && cell.HasFormula)
        {
            plan.Typed.Add($"Discount {IndianNumbers.Rupees(doc.Discount)} typed in ({Number(doc.DiscountPct)}% of the gross; the Details sheet has "
                + $"{(percent is { } p ? $"{Number(p)}%" : "no discount")}).");
        }
    }

    private static void WriteTaxRate(BillWorkbook book, SlotPlan plan, int row, decimal percent, string label)
    {
        var slot = plan.Slot!.Value;
        var cell = book.Cell(slot, row, Col.F);
        var fraction = percent / 100m;
        if (cell.Value is double d && (decimal)d == fraction) return;
        book.Main.SetNumber(slot.Ref(row, Col.F), fraction);
        plan.Typed.Add($"{label} rate typed in: {Number(percent)}% (the workbook had {(cell.Value is double old ? $"{Number((decimal)old * 100m)}%" : "none")}).");
    }

    /// <summary>
    /// Keeps the cell's formula (or puts back the one the same cell has in other bills, when it was typed over) and saves
    /// the value it shows. False when there is no such formula, so the value has to be typed.
    /// </summary>
    private static bool KeepFormula(BillWorkbook book, BillSlot slot, int row, int column, CellContent cell, Func<BillSlot, string?, bool> isKind, object? shows)
    {
        var reference = slot.Ref(row, column);
        if (isKind(slot, cell.Formula))
        {
            book.Main.SetResult(reference, shows);
            return true;
        }
        if (book.FormulaFromAnotherPlace(slot, row, column, isKind) is not { } formula) return false;
        book.Main.SetFormula(reference, formula, shows);
        return true;
    }

    // ---------- Bill date and period: each place copies the one before by formula ----------

    /// <summary>
    /// Types the bill's date (or period) when its place would show another one, and keeps every later bill already in the
    /// workbook as it was by typing its old value in when it was copying the changed one.
    /// </summary>
    private static void SetCopied(BillWorkbook book, SlotPlan plan, int row, string wanted, string what, HashSet<int> written, HashSet<int> filled,
        string?[] numbers, List<string> notes, HashSet<string> changedOutside)
    {
        var slot = plan.Slot!.Value;
        var before = book.Copies(row);
        if (Same(row, before[slot.Index], wanted)) return;
        var wasLinked = book.IsLinked(slot, row);
        book.Main.SetText(slot.Ref(row, Col.F), wanted);
        if (wasLinked) plan.Typed.Add($"{(row == BillSlot.DateRow ? "Bill date" : "Period")} typed in: {wanted} (the bill before it has {TextOf(row, before[slot.Index]) ?? "none"}).");
        var after = book.Copies(row);
        for (var j = slot.Index + 1; j < BillSlot.Count; j++)
        {
            if (!filled.Contains(j) || written.Contains(j) || !book.IsLinked(new BillSlot(j), row) || Same(row, after[j], before[j])) continue;
            var keep = TextOf(row, before[j]) ?? string.Empty;
            var reference = new BillSlot(j).Ref(row, Col.F);
            book.Main.SetText(reference, keep);
            changedOutside.Add(reference);
            notes.Add($"Bill {numbers[j]} ({reference}) copied its {what} from the bill before it; its {what} {keep} is now typed in so it stays the same.");
            after = book.Copies(row);
        }
    }

    private static bool Same(int row, object? value, object? other)
    {
        if (row == BillSlot.DateRow) return BillWorkbook.DateOf(value) is { } a && BillWorkbook.DateOf(other) == a;
        var (af, at) = BillWorkbook.PeriodOf(value);
        var (bf, bt) = BillWorkbook.PeriodOf(other);
        return af is not null && at is not null && af == bf && at == bt;
    }

    private static string? TextOf(int row, object? value)
    {
        if (row == BillSlot.DateRow && value is double && BillWorkbook.DateOf(value) is { } date) return BillWorkbook.DotDate(date);
        return value switch
        {
            string s => s,
            double d => d.ToString(CultureInfo.InvariantCulture),
            _ => null,
        };
    }

    /// <summary>Saves what every linked bill no., date and period formula now shows.</summary>
    private static void UpdateChainResults(BillWorkbook book)
    {
        var numbers = book.Numbers();
        var dates = book.Copies(BillSlot.DateRow);
        var periods = book.Copies(BillSlot.PeriodRow);
        foreach (var slot in BillSlot.All)
        {
            Update(slot, BillSlot.NumberRow, numbers[slot.Index]);
            Update(slot, BillSlot.DateRow, BillWorkbook.Shown(dates[slot.Index]));
            Update(slot, BillSlot.PeriodRow, BillWorkbook.Shown(periods[slot.Index]));
        }

        void Update(BillSlot slot, int row, object? value)
        {
            if (!book.IsLinked(slot, row)) return;
            var cell = book.Cell(slot, row, Col.F);
            if (Equals(cell.Value, value) || (cell.Value is string s && s.Length == 0 && value is null)) return;
            book.Main.SetResult(slot.Ref(row, Col.F), value);
        }
    }

    private static BillSheet? ReadBills(byte[] bytes)
    {
        var temp = Path.Combine(Path.GetTempPath(), $"mph-bill-export-{Guid.NewGuid():N}.xlsx");
        try
        {
            File.WriteAllBytes(temp, bytes);
            return BillSheetReader.Read(temp);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            return null;
        }
        finally
        {
            File.Delete(temp);
        }
    }

    internal static BillSheet? ReadBack(byte[] bytes) => ReadBills(bytes);

    private static int SerialOf(string? invoiceNo)
    {
        var digits = new string((invoiceNo ?? string.Empty).Reverse().TakeWhile(char.IsDigit).Reverse().ToArray());
        return int.TryParse(digits, NumberStyles.Integer, CultureInfo.InvariantCulture, out var serial) ? serial : int.MaxValue;
    }

    private static string Number(decimal value) => value.ToString("0.####", CultureInfo.InvariantCulture);

    private static ExportResult Failed(string fileName, IReadOnlyList<InvoiceDoc> docs, params string[] problems) =>
        new(new BillExportPreview(fileName, null, null, 0, BillSlot.Count,
            docs.Select(d => new BillExportRow(d.Id ?? 0, d.InvoiceNo ?? string.Empty, d.PartyName, d.BillDate, d.Total, BillExportStatus.Blocked, null, [], [], [])).ToList(),
            [], problems, 0), null, []);
}
