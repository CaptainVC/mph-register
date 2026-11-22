using MPHRegister.Contracts.Billing;
using MPHRegister.Services.Exports.Bills;
using MPHRegister.Services.Imports.Bills;
using MPHRegister.Shared.Enums;
using MPHRegister.UnitTests.TestSupport;

namespace MPHRegister.UnitTests.Exports;

/// <summary>Written bills keep the bill layout's row heights: long texts get a smaller font or more lines instead.</summary>
public sealed class BillTextFitTests
{
    private const string LongDn = "299  ( 1than bina finish)";
    private static readonly DetailsParty PartyA = new("EXP A");
    private static readonly HashSet<long> NoReplace = [];

    private static double DnWidth => TextFit.UsableWidth([BillWorkbookBuilder.ColumnWidths[Col.B]], 7);

    private static LineDto Line(string dn, string lot = "12205,12211") => new(LineKind.Priced, "210", dn, lot, "F1", 24, 100, null, false, []);

    private static InvoiceDoc Doc(string party, params LineDto[] lines) => BillExportTests.Doc(1, 101, party, 10, lines);

    private static byte[] Written(ExportResult result)
    {
        Assert.True(result.Preview.Problems.Count == 0, string.Join("\n", result.Preview.Problems));
        Assert.NotNull(result.Content);
        return result.Content;
    }

    private static byte[] Write(byte[] workbook, InvoiceDoc doc, IReadOnlySet<long>? replace = null) =>
        Written(BillExporter.Run(workbook, "bills.xlsm", [doc], replace ?? NoReplace));

    private static byte[] Layout() => BillWorkbookBuilder.Build([PartyA], realLayout: true);

    private static CellFont Font(BillWorkbook book, string reference) => book.Styles!.FontOf(book.Main, reference);

    [Fact]
    public void A_text_too_long_for_its_cell_gets_the_largest_font_that_fits_on_the_lines_its_row_holds()
    {
        Assert.Equal(new FitResult(10, 1), TextFit.Fit("229", "Calibri", 10, false, DnWidth, BillWorkbookBuilder.LineRowHeight));

        var squeezed = TextFit.Fit(LongDn, "Calibri", 10, false, DnWidth, BillWorkbookBuilder.LineRowHeight);
        Assert.InRange(squeezed.Size, TextFit.MinSize, 9.5);
        Assert.Equal(1, squeezed.Lines);
        Assert.True(TextFit.Width(LongDn, "Calibri", squeezed.Size) <= DnWidth, "the one line fits the column");

        var tall = TextFit.Fit(LongDn, "Calibri", 10, false, DnWidth, 30);
        Assert.Equal(new FitResult(10, 2), tall);
        Assert.Equal(2, TextFit.Lines(LongDn, "Calibri", 10, false, DnWidth));
    }

    [Fact]
    public void Every_printable_character_has_a_width_in_each_font()
    {
        var printable = new string([.. Enumerable.Range(' ', '~' - ' ' + 1).Select(c => (char)c)]);
        foreach (var font in new[] { "Calibri", "Arial", "Arial Narrow", "Times New Roman", null })
        {
            Assert.True(TextFit.Width(printable, font, 10) > 0);
            Assert.True(TextFit.Width("₹ हिंदी", font, 10) > 0);
        }
        Assert.Equal(7, TextFit.DigitPixels("Calibri", 11));
        Assert.True(TextFit.Width("WWW", "Arial Narrow", 10) < TextFit.Width("WWW", "Arial", 10));
    }

    [Fact]
    public void A_long_line_text_keeps_its_row_height_with_a_smaller_font()
    {
        var before = BillWorkbook.Open(Layout())!;
        var doc = Doc("EXP A", Line("229"), Line(LongDn));
        var bytes = Write(Layout(), doc);
        var book = BillWorkbook.Open(bytes)!;

        Assert.All(BillTextFit.WrittenRows, row => Assert.True(book.Main.HeightLocked(row), $"row {row} is kept at its height"));
        Assert.Equal(BillWorkbookBuilder.LineRowHeight, book.Main.RowHeight(14));
        Assert.Null(BillTextFit.ChangedRowHeight(before, book, [new BillSlot(0)]));
        Assert.False(book.Main.HeightLocked(BillSlot.FirstLineRow + BillSlot.Rows), "rows of bills not written stay as they were");

        var squeezed = Font(book, "B14");
        Assert.InRange(squeezed.Size, TextFit.MinSize, 9.5);
        Assert.Equal("Calibri", squeezed.Name);
        Assert.True(squeezed.Wrap);
        Assert.Equal(10, Font(book, "B13").Size);
        Assert.Equal(10, Font(book, "C14").Size);
        Assert.Equal(10, Font(book, "B63").Size);
        Assert.Null(new BillTextFit(book).Overflowing(new BillSlot(0)));

        Assert.Empty(SheetBillComparer.Differences(BillExporter.ReadBack(bytes)!.Bills.Single(), doc));
        Assert.Equal(BillExportStatus.Same, Assert.Single(BillExporter.Run(bytes, "bills.xlsm", [doc], NoReplace).Preview.Bills).Status);
    }

    [Fact]
    public void A_long_party_name_is_squeezed_into_its_merged_cell()
    {
        var doc = Doc("THOMAS WEAVING AND FINISHING MILLS PRIVATE LIMITED (UNIT 2)", Line("229"));
        var book = BillWorkbook.Open(Write(Layout(), doc))!;
        Assert.InRange(Font(book, "A8").Size, 9, 13.5);
        Assert.Equal("Arial Narrow", Font(book, "A8").Name);
        Assert.Equal(14, Font(book, "A9").Size);
        Assert.Equal(16, book.Main.RowHeight(BillSlot.PartyRow));
    }

    [Fact]
    public void Writing_a_bill_again_with_shorter_texts_brings_back_the_layout_font_size()
    {
        var bytes = Write(Layout(), Doc("EXP A", Line(LongDn)));
        Assert.True(Font(BillWorkbook.Open(bytes)!, "B13").Size < 10);
        var shorter = Doc("EXP A", Line("299"));
        var replaced = Write(bytes, shorter, new HashSet<long> { 1 });
        Assert.Equal(10, Font(BillWorkbook.Open(replaced)!, "B13").Size);
        Assert.Equal(BillExportStatus.Same, Assert.Single(BillExporter.Run(replaced, "bills.xlsm", [shorter], NoReplace).Preview.Bills).Status);
    }

    [Fact]
    public void A_bill_whose_text_would_grow_its_row_is_offered_for_replacement_and_squeezed()
    {
        var doc = Doc("EXP A", Line(LongDn));
        var book = BillWorkbook.Open(Write(Layout(), doc))!;
        book.Main.SetStyle("B13", 1);
        book.Package.MarkChanged(book.MainPart);
        var overflowing = book.Package.Save();

        var preview = BillExporter.Run(overflowing, "bills.xlsm", [doc], NoReplace);
        var bill = Assert.Single(preview.Preview.Bills);
        Assert.Equal(BillExportStatus.Different, bill.Status);
        Assert.Contains("The text in B13 needs a smaller font or more lines to keep the bill's row heights.", bill.Differences);

        var repaired = Write(overflowing, doc, new HashSet<long> { 1 });
        Assert.True(Font(BillWorkbook.Open(repaired)!, "B13").Size < 10);
        Assert.Equal(BillExportStatus.Same, Assert.Single(BillExporter.Run(repaired, "bills.xlsm", [doc], NoReplace).Preview.Bills).Status);
    }

    [Fact]
    public void A_text_already_squeezed_in_by_hand_keeps_its_size()
    {
        const string lots = "1215,1201,1216,1211,1206,1212,1217";
        var doc = Doc("EXP A", Line("229", lots));
        var book = BillWorkbook.Open(Write(Layout(), doc))!;
        book.Styles!.SetFit(book.Main, "C13", 9, false);
        book.Package.MarkChanged(book.MainPart);
        var byHand = book.Package.Save();
        Assert.Equal(BillExportStatus.Same, Assert.Single(BillExporter.Run(byHand, "bills.xlsm", [doc], NoReplace).Preview.Bills).Status);

        var other = Doc("EXP A", Line("230", lots));
        var replaced = BillWorkbook.Open(Write(byHand, other, new HashSet<long> { 1 }))!;
        Assert.Equal(9, Font(replaced, "C13").Size);
    }

    [Fact]
    public void A_text_just_too_wide_at_the_layout_size_is_still_squeezed()
    {
        const string dn = "299 (bina finish)";
        var ratio = TextFit.Width(dn, "Calibri", 10) / DnWidth;
        Assert.InRange(ratio, 1, 1.08);
        var doc = Doc("EXP A", Line(dn));
        var bytes = Write(Layout(), doc);
        Assert.True(Font(BillWorkbook.Open(bytes)!, "B13").Size < 10);

        var book = BillWorkbook.Open(bytes)!;
        book.Main.SetStyle("B13", 1);
        book.Package.MarkChanged(book.MainPart);
        Assert.Equal(BillExportStatus.Different, Assert.Single(BillExporter.Run(book.Package.Save(), "bills.xlsm", [doc], NoReplace).Preview.Bills).Status);
    }

    [Fact]
    public void Rows_left_free_to_grow_in_a_written_bill_are_reported()
    {
        var book = BillWorkbook.Open(Layout())!;
        Assert.Equal($"Row {BillSlot.NumberRow} is not kept at its height.", BillTextFit.ChangedRowHeight(book, book, [new BillSlot(0)]));
    }
}
