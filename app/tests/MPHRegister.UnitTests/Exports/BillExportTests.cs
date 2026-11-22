using System.IO.Compression;
using System.Text;
using System.Xml.Linq;
using MPHRegister.Contracts.Billing;
using MPHRegister.Services.Billing;
using MPHRegister.Services.Exports.Bills;
using MPHRegister.Services.Imports.Bills;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Helpers;
using MPHRegister.UnitTests.TestSupport;

namespace MPHRegister.UnitTests.Exports;

/// <summary>Writing saved bills into a made-up bill workbook with the real layout and formulas.</summary>
public sealed class BillExportTests
{
    private static readonly DetailsParty PartyA = new("EXP A");
    private static readonly HashSet<long> NoReplace = [];

    private static LineDto Priced(string finish, int qty, decimal? rate, string dn = "D1") => new(LineKind.Priced, "G1", dn, "L1", finish, qty, rate, null, false, []);

    private static LineDto Detail(int qty, string dn) => new(LineKind.Detail, "G1", dn, "L1", string.Empty, qty, null, null, false, []);

    internal static InvoiceDoc Doc(long id, int serial, string party, decimal discountPct, params LineDto[] lines) =>
        Doc(id, serial, party, discountPct, "2026-11-30", lines);

    internal static InvoiceDoc Doc(long id, int serial, string party, decimal discountPct, string billDate, params LineDto[] lines)
    {
        var totals = BillCalculator.Totals(lines, discountPct, TaxMode.Intra, 2.5m, 2.5m, 5m);
        var month = billDate[..7];
        var to = billDate;
        return new InvoiceDoc(id, $"26-27\\JOB\\{serial}", party, party, "ADDR", "(HOME STATE)", "08TESTF9001J1ZJ", billDate, $"{month}-01", to, discountPct,
            TaxMode.Intra, 2.5m, 2.5m, 5m, totals.Gross, totals.Discount, totals.Taxable, totals.Cgst, totals.Sgst, 0, totals.Total, totals.Than,
            InvoiceStatus.Saved, InvoiceSource.App, string.Empty, string.Empty, totals.Lines, [], null, null, null);
    }

    private static ExportResult Run(byte[] workbook, IReadOnlySet<long>? replace = null, params InvoiceDoc[] docs) =>
        BillExporter.Run(workbook, "bills.xlsm", docs, replace ?? NoReplace);

    private static byte[] Written(ExportResult result)
    {
        Assert.True(result.Preview.Problems.Count == 0, string.Join("\n", result.Preview.Problems));
        Assert.NotNull(result.Content);
        return result.Content;
    }

    private static SheetBill ReadBack(byte[] bytes, string invoiceNo) => BillExporter.ReadBack(bytes)!.Bills.Single(b => b.InvoiceNo == invoiceNo);

    private static CellContent Cell(byte[] bytes, int slot, int row, int column) => BillWorkbook.Open(bytes)!.Cell(new BillSlot(slot), row, column);

    [Fact]
    public void An_empty_workbook_starts_at_the_first_bill_and_the_bills_read_back_the_same()
    {
        var first = Doc(1, 279, "EXP A", 10, Priced("F1", 10, 100));
        var second = Doc(2, 280, "EXP A", 10, Priced("F1", 5, 100), Priced("F2", 4, 50));
        var result = Run(BillWorkbookBuilder.Build([PartyA]), null, first, second);
        var bytes = Written(result);

        Assert.Contains(result.Preview.Notes, n => n.Contains("first bill no. (F7) is now 26-27\\JOB\\279", StringComparison.Ordinal));
        Assert.Equal([BillExportStatus.Write, BillExportStatus.Write], result.Preview.Bills.Select(b => b.Status));
        Assert.Equal("column 1, bill 1 (A1:G49)", result.Preview.Bills[0].Place);
        Assert.Equal("column 1, bill 2 (A50:G98)", result.Preview.Bills[1].Place);
        Assert.Equal(2, result.Preview.ToWrite);
        Assert.Empty(SheetBillComparer.Differences(ReadBack(bytes, first.InvoiceNo!), first));
        Assert.Empty(SheetBillComparer.Differences(ReadBack(bytes, second.InvoiceNo!), second));
        Assert.Equal("A50", ReadBack(bytes, second.InvoiceNo!).Cell);
        Assert.Equal([1, 2], result.InWorkbook.Select(b => b.InvoiceId));
    }

    [Fact]
    public void Formulas_stay_where_Details_shows_the_bill_and_values_are_typed_where_it_does_not()
    {
        var doc = Doc(1, 101, "EXP A", 10, Priced("F1", 10, 100), Priced("F2", 4, 60));
        var result = Run(BillWorkbookBuilder.Build([PartyA]), null, doc);
        var bytes = Written(result);

        Assert.True(Cell(bytes, 0, BillSlot.AddressRow, Col.A).HasFormula);
        Assert.True(Cell(bytes, 0, BillSlot.GstinRow, Col.A).HasFormula);
        Assert.Equal("GSTIN: 08TESTF9001J1ZJ", Cell(bytes, 0, BillSlot.GstinRow, Col.A).Text);
        Assert.True(Cell(bytes, 0, 13, Col.F).HasFormula);
        Assert.Equal(100d, Cell(bytes, 0, 13, Col.F).Value);
        Assert.False(Cell(bytes, 0, 14, Col.F).HasFormula);
        Assert.Equal(60d, Cell(bytes, 0, 14, Col.F).Value);
        Assert.True(Cell(bytes, 0, 15, Col.F).HasFormula, "an unused row keeps its rate formula");
        Assert.True(Cell(bytes, 0, BillSlot.DiscountRow, Col.G).HasFormula);
        Assert.Equal((double)doc.Discount, Cell(bytes, 0, BillSlot.DiscountRow, Col.G).Value);
        Assert.Equal(["Rate for F2 on line 2: 60 typed in (the Details sheet has 50)."], result.Preview.Bills[0].Typed);
        Assert.Empty(result.Preview.Notes);
    }

    [Fact]
    public void A_lookup_typed_over_by_hand_gets_its_formula_back_with_the_same_Details_references()
    {
        var bytes = BillWorkbookBuilder.Build([PartyA], change: cells =>
        {
            cells["A58"] = new BillWorkbookBuilder.Cell("OLD ADDRESS");
            cells["G88"] = new BillWorkbookBuilder.Cell(1m);
        });
        var doc = Doc(1, 102, "EXP A", 10, Priced("F1", 10, 100));
        var filled = Written(Run(bytes, null, doc));

        var address = Cell(filled, 1, BillSlot.AddressRow, Col.A).Formula!;
        Assert.Equal(Cell(filled, 2, BillSlot.AddressRow, Col.A).Formula!.Replace("A106", "A57", StringComparison.Ordinal), address);
        Assert.Contains("&Details!B1&", address, StringComparison.Ordinal);
        Assert.Contains("&Details!B2)", address, StringComparison.Ordinal);
        Assert.Contains("&Details!B2)", Cell(filled, 1, BillSlot.DiscountRow, Col.G).Formula!, StringComparison.Ordinal);
        Assert.Empty(SheetBillComparer.Differences(ReadBack(filled, doc.InvoiceNo!), doc));
    }

    [Fact]
    public void A_lookup_pointing_at_other_Details_cells_is_not_trusted()
    {
        const string shifted = "IFERROR(VLOOKUP(A57,INDIRECT(\"Details!A\"&Details!B1&\":E\"&Details!B2),2,FALSE),\"\")";
        Assert.True(BillWorkbook.IsLookupFormula(new BillSlot(1), shifted, DetailsSheet.AddressColumn));
        Assert.False(BillWorkbook.IsLookupFormula(new BillSlot(1), shifted.Replace("Details!B1", "Details!B50", StringComparison.Ordinal), DetailsSheet.AddressColumn));
        Assert.Equal("Details!B1&A2", FormulaText.Shift("Details!B1&A1", 1, 0, otherSheets: false));
    }

    [Fact]
    public void A_party_missing_from_Details_gets_its_address_rates_and_discount_typed_in()
    {
        var doc = Doc(1, 101, "NEW PARTY", 10, Priced("F1", 10, 100));
        var result = Run(BillWorkbookBuilder.Build([PartyA]), null, doc);
        var bytes = Written(result);

        Assert.False(Cell(bytes, 0, BillSlot.AddressRow, Col.A).HasFormula);
        Assert.Equal("ADDR", Cell(bytes, 0, BillSlot.AddressRow, Col.A).Text);
        Assert.Equal("GSTIN: 08TESTF9001J1ZJ", Cell(bytes, 0, BillSlot.GstinRow, Col.A).Text);
        Assert.False(Cell(bytes, 0, 13, Col.F).HasFormula);
        Assert.False(Cell(bytes, 0, BillSlot.DiscountRow, Col.G).HasFormula);
        Assert.Equal((double)doc.Discount, Cell(bytes, 0, BillSlot.DiscountRow, Col.G).Value);
        Assert.Single(result.Preview.Bills[0].Typed, t => t.StartsWith("The party is not on the Details sheet", StringComparison.Ordinal));
        Assert.Empty(SheetBillComparer.Differences(ReadBack(bytes, doc.InvoiceNo!), doc));
    }

    [Fact]
    public void A_bill_without_discount_gets_0_typed_so_its_taxable_amount_is_not_0()
    {
        var doc = Doc(1, 101, "EXP Z", 0, Priced("F1", 10, 100));
        var result = Run(BillWorkbookBuilder.Build([PartyA with { Name = "EXP Z", Discount = null }]), null, doc);
        var bytes = Written(result);

        Assert.Equal(0d, Cell(bytes, 0, BillSlot.DiscountRow, Col.G).Value);
        Assert.False(Cell(bytes, 0, BillSlot.DiscountRow, Col.G).HasFormula);
        var bill = ReadBack(bytes, doc.InvoiceNo!);
        Assert.Equal(1000, bill.Taxable);
        Assert.Equal(1050, bill.Total);
    }

    [Fact]
    public void Writing_again_finds_the_bills_already_there()
    {
        var doc = Doc(1, 101, "EXP A", 10, Priced("F1", 10, 100));
        var bytes = Written(Run(BillWorkbookBuilder.Build([PartyA]), null, doc));

        var again = Run(bytes, null, doc);
        Assert.Equal(BillExportStatus.Same, Assert.Single(again.Preview.Bills).Status);
        Assert.Null(again.Content);
        Assert.Equal(0, again.Preview.ToWrite);
        Assert.Equal(1, again.Preview.FilledPlaces);
    }

    [Fact]
    public void A_changed_bill_is_only_written_over_when_asked_and_its_rate_formula_comes_back()
    {
        var typed = Doc(1, 101, "EXP A", 10, Priced("F1", 10, 90));
        var bytes = Written(Run(BillWorkbookBuilder.Build([PartyA]), null, typed));
        Assert.False(Cell(bytes, 0, 13, Col.F).HasFormula);

        var edited = Doc(1, 101, "EXP A", 10, Priced("F1", 12, 100));
        var asked = Run(bytes, null, edited);
        var row = Assert.Single(asked.Preview.Bills);
        Assert.Equal(BillExportStatus.Different, row.Status);
        Assert.Contains(row.Differences, d => d.StartsWith("Line 1: workbook G1 · D1 · L1 · F1 · 10 THAN · rate 90", StringComparison.Ordinal));
        Assert.Null(asked.Content);

        var replaced = Written(Run(bytes, new HashSet<long> { 1 }, edited));
        Assert.True(Cell(replaced, 0, 13, Col.F).HasFormula);
        Assert.Empty(SheetBillComparer.Differences(ReadBack(replaced, edited.InvoiceNo!), edited));
    }

    [Fact]
    public void A_place_with_another_party_or_a_number_not_in_the_workbook_is_refused()
    {
        var bytes = Written(Run(BillWorkbookBuilder.Build([PartyA]), null, Doc(1, 101, "EXP A", 10, Priced("F1", 10, 100))));
        var result = Run(bytes, null, Doc(2, 101, "EXP B", 10, Priced("F1", 1, 100)), Doc(3, 500, "EXP A", 10, Priced("F1", 1, 100)));

        Assert.All(result.Preview.Bills, b => Assert.Equal(BillExportStatus.Blocked, b.Status));
        Assert.Contains("already has a bill for EXP A", result.Preview.Bills[0].Problems[0], StringComparison.Ordinal);
        Assert.Equal("Bill no. 26-27\\JOB\\500 is not in this workbook (its places are 26-27\\JOB\\101 to 26-27\\JOB\\200).", result.Preview.Bills[1].Problems[0]);
        Assert.Null(result.Content);
    }

    [Fact]
    public void Bills_with_IGST_too_many_lines_or_cancelled_are_refused()
    {
        var igst = Doc(1, 101, "EXP A", 10, Priced("F1", 1, 100)) with { TaxMode = TaxMode.Inter };
        var longBill = Doc(2, 102, "EXP A", 10, Enumerable.Range(1, 26).Select(i => Priced("F1", 1, 100, $"D{i}")).ToArray());
        var cancelled = Doc(3, 103, "EXP A", 10, Priced("F1", 1, 100)) with { Status = InvoiceStatus.Cancelled };
        var result = Run(BillWorkbookBuilder.Build([PartyA]), null, igst, longBill, cancelled);

        Assert.All(result.Preview.Bills, b => Assert.Equal(BillExportStatus.Blocked, b.Status));
        Assert.Contains("IGST", result.Preview.Bills[0].Problems[0], StringComparison.Ordinal);
        Assert.Equal("It has 26 lines; a bill in the workbook holds 25. Split it in the app first.", result.Preview.Bills[1].Problems[0]);
        Assert.Contains("cancelled", result.Preview.Bills[2].Problems[0], StringComparison.Ordinal);
        Assert.Null(result.Content);
    }

    [Fact]
    public void A_later_bill_keeps_its_date_when_the_one_before_it_gets_another_date()
    {
        var october = Doc(1, 101, "EXP A", 10, "2026-10-31", Priced("F1", 1, 100));
        var third = Doc(3, 103, "EXP A", 10, "2026-10-31", Priced("F1", 3, 100));
        var bytes = Written(Run(BillWorkbookBuilder.Build([PartyA]), null, october, third));
        Assert.True(Cell(bytes, 2, BillSlot.DateRow, Col.F).HasFormula, "the same date stays a copy of the bill before");

        var november = Doc(2, 102, "EXP A", 10, "2026-11-30", Priced("F1", 2, 100));
        var result = Run(bytes, null, november);
        var filled = Written(result);
        Assert.Contains(result.Preview.Bills[0].Typed, t => t.StartsWith("Bill date typed in: 30.11.26", StringComparison.Ordinal));
        Assert.Contains(result.Preview.Notes, n => n.StartsWith("Bill 26-27\\JOB\\103 (F106) copied its bill date", StringComparison.Ordinal));
        Assert.Equal("2026-10-31", ReadBack(filled, third.InvoiceNo!).BillDate);
        Assert.Equal("2026-10-01", ReadBack(filled, third.InvoiceNo!).PeriodFrom);
        Assert.Equal("2026-11-30", ReadBack(filled, november.InvoiceNo!).BillDate);
    }

    [Fact]
    public void A_merged_line_gets_a_sum_of_the_rows_above_it()
    {
        var doc = Doc(1, 101, "EXP A", 10, Detail(10, "D1"), Detail(20, "D2"), Priced("F1", 0, 100, dn: string.Empty) with { Gpn = string.Empty, Lot = string.Empty, AutoSum = true });
        var bytes = Written(Run(BillWorkbookBuilder.Build([PartyA]), null, doc));

        Assert.Equal("SUM(E13:E36)", Cell(bytes, 0, 37, Col.E).Formula);
        var bill = ReadBack(bytes, doc.InvoiceNo!);
        Assert.Equal(30, bill.Lines[2].Qty);
        Assert.True(bill.Lines[2].AutoSum);
        Assert.Equal(3000, bill.Gross);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(30)]
    [InlineData(55)]
    [InlineData(80)]
    public void Final_summary_is_at_the_bottom_in_every_panel_without_changing_the_saved_lines(int slot)
    {
        var summary = Priced("F1", 0, 100, dn: "") with { Gpn = "", Lot = "", AutoSum = true };
        var doc = Doc(1, 101 + slot, "EXP A", 10, Detail(10, "D1"), Detail(20, "D2"), summary);
        var bytes = Written(Run(BillWorkbookBuilder.Build([PartyA]), null, doc));
        var place = new BillSlot(slot);
        Assert.Equal($"SUM({place.Ref(13, Col.E)}:{place.Ref(36, Col.E)})", Cell(bytes, slot, 37, Col.E).Formula);
        Assert.Equal("F1", Cell(bytes, slot, 37, Col.D).Text);
        Assert.Equal(30d, Cell(bytes, slot, 37, Col.E).Value);
        Assert.Equal(3000d, Cell(bytes, slot, 37, Col.G).Value);
        for (var row = 15; row < 37; row++)
        {
            Assert.Equal("", Cell(bytes, slot, row, Col.D).Text);
            Assert.Null(Cell(bytes, slot, row, Col.E).Value);
            Assert.Empty(Cell(bytes, slot, row, Col.G).Text);
        }
        Assert.Equal(3, doc.Lines.Count);
        Assert.Empty(SheetBillComparer.Differences(ReadBack(bytes, doc.InvoiceNo!), doc));
        Assert.Equal(doc.Gross, BillCalculator.Totals(ReadBack(bytes, doc.InvoiceNo!).Lines, doc.DiscountPct, doc.TaxMode,
            doc.CgstRate, doc.SgstRate, doc.IgstRate).Gross);
        Assert.Equal(BillExportStatus.Same, Assert.Single(Run(bytes, null, doc).Preview.Bills).Status);
        Assert.Equal(RupeeWords.Format(doc.Total), Cell(bytes, slot, BillSlot.TotalRow, Col.A).Text);
    }

    [Fact]
    public void Multiple_finish_groups_keep_their_own_sums_and_only_the_final_summary_moves()
    {
        var summary = Priced("F1", 0, 100, dn: "") with { Gpn = "", Lot = "", AutoSum = true };
        var doc = Doc(1, 101, "EXP A", 10, Detail(10, "D1"), summary, Detail(20, "D2"),
            summary with { Finish = "F2", Rate = 50 });
        var bytes = Written(Run(BillWorkbookBuilder.Build([PartyA]), null, doc));
        Assert.Equal("SUM(E13:E13)", Cell(bytes, 0, 14, Col.E).Formula);
        Assert.Equal("SUM(E15:E36)", Cell(bytes, 0, 37, Col.E).Formula);
        Assert.Equal(20d, Cell(bytes, 0, 37, Col.E).Value);
        Assert.Empty(SheetBillComparer.Differences(ReadBack(bytes, doc.InvoiceNo!), doc));
    }

    [Fact]
    public void A_full_bill_and_ordinary_priced_lines_keep_their_positions()
    {
        var summary = Priced("F1", 0, 100, dn: "") with { Gpn = "", Lot = "", AutoSum = true };
        var full = Doc(1, 101, "EXP A", 10, [.. Enumerable.Range(1, 24).Select(i => Detail(1, $"D{i}")), summary]);
        var ordinary = Doc(2, 102, "EXP A", 10, Priced("F1", 10, 100), Priced("F2", 5, 50));
        var bytes = Written(Run(BillWorkbookBuilder.Build([PartyA]), null, full, ordinary));
        Assert.Equal("SUM(E13:E36)", Cell(bytes, 0, 37, Col.E).Formula);
        Assert.Equal("F1", Cell(bytes, 1, 13, Col.D).Text);
        Assert.Equal("F2", Cell(bytes, 1, 14, Col.D).Text);
        Assert.Empty(Cell(bytes, 1, 37, Col.D).Text);
    }

    [Theory]
    [InlineData("black", "FF000000")]
    [InlineData("blue", "FF0000FF")]
    [InlineData("", "FFFF0000")]
    [InlineData("unrecognised", "FF000000")]
    [InlineData("#1256ab", "FF1256AB")]
    public void Party_colour_comes_from_Details_not_the_empty_slots_red_font(string color, string rgb)
    {
        var doc = Doc(1, 101, "EXP A", 10, Priced("F1", 10, 100));
        var bytes = Written(Run(BillWorkbookBuilder.Build([PartyA with { Color = color }]), null, doc));
        var book = BillWorkbook.Open(bytes)!;
        foreach (var row in new[] { 8, 9, 10, 11 })
        {
            Assert.True(book.Styles!.HasColor(book.Main, $"A{row}", rgb));
            Assert.True(book.Styles.HasColor(book.Main, $"H{row}", "FFFF0000"), "unwritten party styles stay red");
        }
        Assert.True(book.Styles!.HasOutline(book.Main, "E13"));
        Assert.False(book.Styles.HasOutline(book.Main, "E14"));
    }

    [Fact]
    public void Configured_colour_names_are_used_for_workbook_party_fonts()
    {
        var doc = Doc(1, 101, "EXP A", 10, Priced("F1", 10, 100));
        var bytes = Written(BillExporter.Run(BillWorkbookBuilder.Build([PartyA with { Color = "custom" }]), "bills.xlsm",
            [doc], NoReplace, [new NamedColor { Name = "custom", Hex = "#123456" }]));
        var book = BillWorkbook.Open(bytes)!;
        Assert.True(book.Styles!.HasColor(book.Main, "A8", "FF123456"));
    }

    [Fact]
    public void Replacing_a_shorter_bill_removes_the_old_THAN_outline_and_unused_values()
    {
        var first = Doc(1, 101, "EXP A", 10, Priced("F1", 10, 100), Priced("F2", 5, 50));
        var bytes = Written(Run(BillWorkbookBuilder.Build([PartyA]), null, first));
        var shorter = Doc(1, 101, "EXP A", 10, Priced("F1", 10, 100));
        var replaced = Written(Run(bytes, new HashSet<long> { 1 }, shorter));
        var book = BillWorkbook.Open(replaced)!;
        Assert.False(book.Styles!.HasOutline(book.Main, "E14"));
        Assert.Empty(Cell(replaced, 0, 14, Col.D).Text);
        Assert.Null(Cell(replaced, 0, 14, Col.E).Value);
        Assert.Empty(Cell(replaced, 0, 14, Col.G).Text);
        Assert.Empty(SheetBillComparer.Differences(ReadBack(replaced, shorter.InvoiceNo!), shorter));
    }

    [Fact]
    public void Old_exports_with_the_same_figures_can_be_explicitly_replaced_to_fix_their_formatting()
    {
        var doc = Doc(1, 101, "EXP A", 10, Priced("F1", 10, 100));
        var book = BillWorkbook.Open(Written(Run(BillWorkbookBuilder.Build([PartyA]), null, doc)))!;
        book.Main.SetStyle("A8", 0);
        book.Main.SetStyle("E13", 0);
        book.Package.MarkChanged(book.MainPart);
        var oldExport = book.Package.Save();
        var preview = Run(oldExport, null, doc);
        Assert.Equal(BillExportStatus.Different, Assert.Single(preview.Preview.Bills).Status);
        Assert.Contains("Party font colour does not match the Details sheet.", preview.Preview.Bills[0].Differences);
        Assert.Null(preview.Content);
        var fixedExport = Written(Run(oldExport, new HashSet<long> { 1 }, doc));
        Assert.Empty(SheetBillComparer.Differences(ReadBack(fixedExport, doc.InvoiceNo!), doc));
        Assert.Equal(BillExportStatus.Same, Assert.Single(Run(fixedExport, null, doc).Preview.Bills).Status);
    }

    [Fact]
    public void Legacy_imported_bottom_summaries_compare_and_export_without_migrating_saved_lines()
    {
        var blank = new LineDto(LineKind.Blank, "", "", "", "", null, null, null, false, []);
        var summary = Priced("F1", 30, 100, dn: "") with { Gpn = "", Lot = "", AutoSum = false };
        var doc = Doc(1, 101, "EXP A", 10, [Detail(10, "D1"), Detail(20, "D2"), .. Enumerable.Repeat(blank, 22), summary])
            with { Source = InvoiceSource.Excel };
        var bytes = Written(Run(BillWorkbookBuilder.Build([PartyA]), null, doc));
        Assert.Equal(25, doc.Lines.Count);
        Assert.False(doc.Lines[^1].AutoSum);
        var read = ReadBack(bytes, doc.InvoiceNo!);
        Assert.Equal(3, read.Lines.Count);
        Assert.True(read.Lines[^1].AutoSum);
        Assert.Empty(SheetBillComparer.Differences(read, doc));
        Assert.Equal("SUM(E13:E36)", Cell(bytes, 0, 37, Col.E).Formula);
        Assert.Equal(BillExportStatus.Same, Assert.Single(Run(bytes, null, doc).Preview.Bills).Status);
    }

    [Fact]
    public void A_manual_quantity_different_from_the_detail_sum_is_not_inferred_as_AutoSum()
    {
        var blank = new LineDto(LineKind.Blank, "", "", "", "", null, null, null, false, []);
        var summary = Priced("F1", 25, 100, dn: "") with { Gpn = "", Lot = "", AutoSum = false };
        var doc = Doc(1, 101, "EXP A", 10, [Detail(10, "D1"), Detail(20, "D2"), .. Enumerable.Repeat(blank, 22), summary]);
        var bytes = Written(Run(BillWorkbookBuilder.Build([PartyA]), null, doc));
        Assert.False(Cell(bytes, 0, 37, Col.E).HasFormula);
        Assert.Equal(25d, Cell(bytes, 0, 37, Col.E).Value);
        Assert.Empty(SheetBillComparer.Differences(ReadBack(bytes, doc.InvoiceNo!), doc));
    }

    [Fact]
    public void Replacing_a_custom_formatted_THAN_cell_preserves_its_alignment_while_removing_its_box()
    {
        var doc = Doc(1, 101, "EXP A", 10, Priced("F1", 10, 100), Priced("F2", 5, 50));
        var book = BillWorkbook.Open(Written(Run(BillWorkbookBuilder.Build([PartyA]), null, doc)))!;
        var part = book.Package.WorkbookRelated("styles")!;
        XNamespace ns = XlsxPackage.MainNs;
        var formats = book.Package.Xml(part).Root!.Element(ns + "cellXfs")!;
        var index = formats.Elements().Count();
        var custom = new XElement(formats.Elements().ElementAt(book.Main.Style("E14")));
        custom.Add(new XElement(ns + "alignment", new XAttribute("horizontal", "center")));
        formats.Add(custom);
        formats.SetAttributeValue("count", index + 1);
        book.Package.MarkChanged(part);
        book.Main.SetStyle("E14", index);
        book.Package.MarkChanged(book.MainPart);
        var shorter = Doc(1, 101, "EXP A", 10, Priced("F1", 10, 100));
        var replaced = Written(Run(book.Package.Save(), new HashSet<long> { 1 }, shorter));
        var after = BillWorkbook.Open(replaced)!;
        Assert.False(after.Styles!.HasOutline(after.Main, "E14"));
        var style = after.Package.Xml(part).Root!.Element(ns + "cellXfs")!.Elements().ElementAt(after.Main.Style("E14"));
        Assert.Equal("center", (string?)style.Element(ns + "alignment")?.Attribute("horizontal"));
    }

    [Fact]
    public void Stale_amount_words_alone_are_offered_for_replacement_and_repaired()
    {
        var doc = Doc(1, 101, "EXP A", 10, Priced("F1", 10, 100));
        var book = BillWorkbook.Open(Written(Run(BillWorkbookBuilder.Build([PartyA]), null, doc)))!;
        book.Main.SetResult("A43", "OLD AMOUNT WORDS");
        book.Package.MarkChanged(book.MainPart);
        var stale = book.Package.Save();
        var preview = Run(stale, null, doc);
        Assert.Equal(BillExportStatus.Different, Assert.Single(preview.Preview.Bills).Status);
        Assert.Equal(["The saved amount in words does not match the invoice total."], preview.Preview.Bills[0].Differences);
        var bytes = Written(Run(stale, new HashSet<long> { 1 }, doc));
        Assert.Equal(RupeeWords.Format(doc.Total), Cell(bytes, 0, 43, Col.A).Text);
        Assert.True(Cell(bytes, 0, 43, Col.A).HasFormula);
    }

    [Fact]
    public void Nothing_else_in_the_workbook_changes_and_Excel_recalculates_on_open()
    {
        var original = BillWorkbookBuilder.Build([PartyA]);
        var bytes = Written(Run(original, null, Doc(1, 101, "EXP A", 10, Priced("F1", 10, 100))));

        using var before = new ZipArchive(new MemoryStream(original));
        using var after = new ZipArchive(new MemoryStream(bytes));
        static byte[] Part(ZipArchive zip, string name)
        {
            using var stream = zip.GetEntry(name)!.Open();
            using var copy = new MemoryStream();
            stream.CopyTo(copy);
            return copy.ToArray();
        }
        Assert.Equal(BillWorkbookBuilder.VbaProject, Part(after, "xl/vbaProject.bin"));
        Assert.Equal(Part(before, "xl/worksheets/sheet2.xml"), Part(after, "xl/worksheets/sheet2.xml"));
        Assert.True(WorkbookStyles.PreservesOriginal(XDocument.Parse(Encoding.UTF8.GetString(Part(before, "xl/styles.xml"))),
            XDocument.Parse(Encoding.UTF8.GetString(Part(after, "xl/styles.xml")))));
        Assert.Null(after.GetEntry("xl/calcChain.xml"));
        var workbook = Encoding.UTF8.GetString(Part(after, "xl/workbook.xml"));
        Assert.Contains("fullCalcOnLoad=\"1\"", workbook, StringComparison.Ordinal);
        Assert.Contains("<definedName name=\"finishes\">", workbook, StringComparison.Ordinal);
        Assert.DoesNotContain("calcChain", Encoding.UTF8.GetString(Part(after, "xl/_rels/workbook.xml.rels")), StringComparison.Ordinal);
        Assert.DoesNotContain("calcChain", Encoding.UTF8.GetString(Part(after, "[Content_Types].xml")), StringComparison.Ordinal);
        Assert.Equal(before.Entries.Select(e => e.FullName).Where(n => n != "xl/calcChain.xml"), after.Entries.Select(e => e.FullName));
    }

    [Fact]
    public void A_workbook_without_the_bill_layout_is_refused()
    {
        var bytes = BillWorkbookBuilder.Build([PartyA], change: cells => cells["A61"] = new BillWorkbookBuilder.Cell("SOMETHING ELSE"));
        var result = Run(bytes, null, Doc(1, 101, "EXP A", 10, Priced("F1", 1, 100)));
        Assert.Contains("A61 should say \"G.P.N.\"", Assert.Single(result.Preview.Problems), StringComparison.Ordinal);
        Assert.Null(result.Content);
    }

    [Fact]
    public void A_place_whose_total_formula_was_changed_by_hand_is_refused()
    {
        var bytes = BillWorkbookBuilder.Build([PartyA], change: cells => cells["G41"] = new BillWorkbookBuilder.Cell(0m, "ROUND(G40*3%,0)"));
        var result = Run(bytes, null, Doc(1, 101, "EXP A", 10, Priced("F1", 1, 100)), Doc(2, 102, "EXP A", 10, Priced("F1", 1, 100)));
        Assert.Equal(BillExportStatus.Blocked, result.Preview.Bills[0].Status);
        Assert.Contains("G41", result.Preview.Bills[0].Problems[0], StringComparison.Ordinal);
        Assert.Equal(BillExportStatus.Write, result.Preview.Bills[1].Status);
    }

    [Fact]
    public void Formulas_copy_like_Excel_copies_them()
    {
        Assert.Equal("SUM(B3:$B$2)&\"A1\"&Details!D5&Details!$E$1", FormulaText.Shift("SUM(A1:$B$2)&\"A1\"&Details!C3&Details!$E$1", 2, 1));
        Assert.Equal("LOG10(C3)", FormulaText.Shift("LOG10(B2)", 1, 1));
        Assert.Equal(["A8", "D13"], FormulaText.RelativeReferences("MATCH(A8,X)&D13&$A$1&Details!B1&\"C4\"").Order());
        Assert.Equal("IF(F13=\"a b\",\"\",1)", FormulaText.Normalize("=if( F13 = \"a b\" , \"\" , 1 )"));
    }

    [Fact]
    public void Overwriting_a_shared_formula_master_moves_the_formula_to_the_next_cell()
    {
        const string ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        var doc = XDocument.Parse($"<worksheet xmlns=\"{ns}\"><sheetData>"
            + "<row r=\"1\"><c r=\"A1\"><f t=\"shared\" ref=\"A1:A3\" si=\"0\">B1*2</f><v>2</v></c></row>"
            + "<row r=\"2\"><c r=\"A2\"><f t=\"shared\" si=\"0\"/><v>4</v></c></row>"
            + "<row r=\"3\"><c r=\"A3\"><f t=\"shared\" si=\"0\"/><v>6</v></c></row></sheetData></worksheet>");
        var sheet = new SheetXml(doc, new SharedStrings(null));
        Assert.Equal("B3*2", sheet.Get("A3").Formula);
        sheet.SetNumber("A1", 7);
        Assert.Null(sheet.Get("A1").Formula);
        Assert.Equal("B2*2", sheet.Get("A2").Formula);
        Assert.Equal("B3*2", sheet.Get("A3").Formula);
        var moved = doc.Descendants(XName.Get("f", ns)).First();
        Assert.Equal("A2:A3", (string?)moved.Attribute("ref"));
    }
}
