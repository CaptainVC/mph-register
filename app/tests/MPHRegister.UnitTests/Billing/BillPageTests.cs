using MPHRegister.Contracts.Billing;
using MPHRegister.Services.Billing;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Enums;
using MPHRegister.UnitTests.TestSupport;

namespace MPHRegister.UnitTests.Billing;

/// <summary>Page maths of the print template shipped with the app (rows per bill and their upper bound).</summary>
public sealed class BillGeometryTests
{
    private static readonly BillGeometry Page = Make.Geometry;

    [Fact]
    public void Template_has_25_line_rows_between_a_fixed_header_and_footer()
    {
        Assert.Equal(25, Page.TemplateLineRows);
        Assert.True(Page.FixedHeightPt > 0);
        Assert.True(Page.LineAreaPt(PaperSize.Letter) >= Page.TemplateLineHeightPt, "the template's own 25 rows fit on Letter");
    }

    [Theory]
    [InlineData(PaperSize.Letter)]
    [InlineData(PaperSize.A4)]
    public void Max_rows_is_the_line_area_divided_by_the_row_height_the_smallest_font_needs(PaperSize paper)
    {
        foreach (var smallest in new[] { 6m, 7.5m, 9m })
        {
            var expected = (int)Math.Floor(Page.LineAreaPt(paper) / BillGeometry.RowHeightFor((double)smallest));
            Assert.Equal(Math.Clamp(expected, Page.TemplateLineRows, Limits.MaxBillRows), Page.MaxRowsPerBill(paper, smallest));
        }
    }

    [Fact]
    public void A4_and_smaller_fonts_allow_more_rows_and_never_fewer_than_the_template()
    {
        Assert.True(Page.MaxRowsPerBill(PaperSize.A4, 7.5m) > Page.MaxRowsPerBill(PaperSize.Letter, 7.5m));
        Assert.True(Page.MaxRowsPerBill(PaperSize.Letter, 6m) >= Page.MaxRowsPerBill(PaperSize.Letter, 7.5m));
        Assert.Equal(Page.TemplateLineRows, Page.MaxRowsPerBill(PaperSize.Letter, Limits.MaxSmallestFontPt));
        Assert.True(Page.MaxRowsPerBill(PaperSize.Letter, Limits.MinSmallestFontPt) <= Limits.MaxBillRows);
    }

    [Fact]
    public void Up_to_the_template_rows_the_template_heights_and_font_are_kept()
    {
        Assert.Equal(Page.LineFontPt, Page.LineFontFor(PaperSize.Letter, 25));
        Assert.Equal(Page.TemplateLineHeightPt / 25, Page.RowHeightPt(PaperSize.Letter, 20), 6);
    }

    [Theory]
    [InlineData(30)]
    [InlineData(35)]
    public void More_rows_share_the_same_area_and_the_font_shrinks_only_as_needed(int rows)
    {
        var height = Page.RowHeightPt(PaperSize.Letter, rows);
        Assert.Equal(Page.LineAreaPt(PaperSize.Letter), height * rows, 6);
        var font = Page.LineFontFor(PaperSize.Letter, rows);
        Assert.True(font <= Page.LineFontPt);
        Assert.True(BillGeometry.RowHeightFor(font) <= height + 1e-9, "the font fits its row");
        Assert.True(font >= 7.5, "at the bound the font is still at least the smallest font");
    }

    [Fact]
    public void Rows_at_the_upper_bound_are_tall_enough_for_the_smallest_font()
    {
        foreach (var paper in new[] { PaperSize.Letter, PaperSize.A4 })
        {
            var max = Page.MaxRowsPerBill(paper, 7.5m);
            Assert.True(Page.RowHeightPt(paper, max) >= BillGeometry.RowHeightFor(7.5));
            Assert.True(Page.RowHeightPt(paper, max + 1) < BillGeometry.RowHeightFor(7.5));
        }
    }
}

public sealed class BillLineSizerTests
{
    private static readonly BillLineSizer Sizer = Make.Sizer;

    [Fact]
    public void Blank_and_short_lines_take_one_row()
    {
        Assert.Equal(1, Sizer.RowsFor(BillPacker.Blank(), 7.5m));
        Assert.Equal(1, Sizer.RowsFor(Make.Detail(5, dn: "12409", lot: "1188"), 7.5m));
        Assert.Equal(1, Sizer.RowsFor(Make.Detail(5, dn: "", lot: ""), 7.5m));
    }

    [Fact]
    public void A_list_that_fits_once_shrunk_stays_on_one_row()
    {
        // Too wide at the 10pt line font, fits at the smallest font.
        Assert.True(Sizer.WrappedLines("1240,1241,1242", BillGeometry.DnColumn, 10) > 1);
        Assert.Equal(1, Sizer.RowsFor(Make.Detail(1, dn: "1240,1241,1242"), 7.5m));
    }

    [Fact]
    public void Four_five_digit_design_numbers_need_two_rows_in_the_DN_column_but_one_in_LOT()
    {
        const string List = "13481,13482,13483,13484";
        Assert.Equal(2, Sizer.RowsFor(Make.Detail(1, dn: List), 7.5m));
        Assert.Equal(1, Sizer.RowsFor(Make.Detail(1, dn: "", lot: List), 7.5m));
    }

    [Fact]
    public void Very_long_lists_are_capped_at_three_rows()
    {
        var list = string.Join(",", Enumerable.Range(10000, 40));
        Assert.Equal(BillLineSizer.MaxRowsPerLine, Sizer.RowsFor(Make.Detail(1, gpn: list), 7.5m));
    }

    [Fact]
    public void A_bigger_smallest_font_needs_more_rows()
    {
        const string List = "1215,1201,1216,1211,1206,1212,1217,1218,1219";
        Assert.True(Sizer.RowsFor(Make.Detail(1, lot: List), 10m) >= Sizer.RowsFor(Make.Detail(1, lot: List), 6m));
    }

    [Fact]
    public void Wrapping_breaks_after_commas_and_counts_every_line()
    {
        Assert.Equal(1, Sizer.WrappedLines("", BillGeometry.LotColumn, 10));
        Assert.True(Sizer.WrappedLines(string.Join(",", Enumerable.Range(100, 30)), BillGeometry.LotColumn, 10) >= 3);
        Assert.True(Sizer.WrappedLines(new string('9', 60), BillGeometry.GpnColumn, 10) >= 2, "a long run without commas breaks anywhere");
    }

    [Fact]
    public void Total_rows_adds_up_every_line()
    {
        var lines = new List<LineDto> { Make.Detail(1, dn: "13481,13482,13483,13484"), BillPacker.Blank(), Make.Priced(1, 1m) };
        Assert.Equal(4, Sizer.TotalRows(lines, 7.5m));
    }
}
