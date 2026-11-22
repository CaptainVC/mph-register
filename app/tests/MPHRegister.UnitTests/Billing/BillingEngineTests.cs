using MPHRegister.Contracts.Billing;
using MPHRegister.Services.Billing;
using MPHRegister.Shared.Enums;
using MPHRegister.UnitTests.TestSupport;

namespace MPHRegister.UnitTests.Billing;

public sealed class BillCalculatorTests
{
    [Fact]
    public void Works_out_an_Excel_style_bill_with_auto_summed_priced_row()
    {
        int[] than = [5, 28, 26, 28, 28, 28, 28, 28, 28, 28, 29];
        var lines = than.Select(t => Make.Detail(t)).Append(Make.Priced(0, 77m, autoSum: true)).ToList();
        var t = BillCalculator.Totals(lines, 13.5m, TaxMode.Intra, Make.Firm());
        Assert.Equal(284, t.Than);
        Assert.Equal(21868, t.Gross);
        Assert.Equal(2952, t.Discount);
        Assert.Equal(18916, t.Taxable);
        Assert.Equal((473L, 473L, 0L), (t.Cgst, t.Sgst, t.Igst));
        Assert.Equal(19862, t.Total);
    }

    [Fact]
    public void Inter_state_uses_igst_only()
    {
        var t = BillCalculator.Totals([Make.Priced(100, 50m)], 0, TaxMode.Inter, Make.Firm());
        Assert.Equal((0L, 0L, 250L, 5250L), (t.Cgst, t.Sgst, t.Igst, t.Total));
    }

    [Fact]
    public void Each_amount_discount_and_tax_is_rounded_half_away_from_zero_on_its_own()
    {
        // 3 × 10.50 = 31.5 → 32; discount 10% of 32 = 3.2 → 3; taxable 29; 2.5% of 29 = 0.725 → 1 each.
        var t = BillCalculator.Totals([Make.Priced(3, 10.5m)], 10m, TaxMode.Intra, Make.Firm());
        Assert.Equal((32L, 3L, 29L, 1L, 1L, 31L), (t.Gross, t.Discount, t.Taxable, t.Cgst, t.Sgst, t.Total));
    }

    [Fact]
    public void Blank_row_resets_the_running_sum()
    {
        var t = BillCalculator.Totals([Make.Detail(10), BillPacker.Blank(), Make.Detail(3), Make.Priced(0, 1m, autoSum: true)], 0, TaxMode.Intra, Make.Firm());
        Assert.Equal(3, t.Lines[^1].Qty);
    }

    [Fact]
    public void Auto_sum_without_detail_rows_keeps_the_typed_quantity()
    {
        var t = BillCalculator.Totals([Make.Priced(7, 10m, autoSum: true)], 0, TaxMode.Intra, Make.Firm());
        Assert.Equal(7, t.Lines[0].Qty);
        Assert.False(t.Lines[0].AutoSum);
        Assert.Equal(70, t.Gross);
    }

    [Fact]
    public void Priced_row_without_rate_has_no_amount_and_warns()
    {
        var done = BillCalculator.Complete(Make.Doc([Make.Priced(5, null, finish: "F9")]), null, null, Make.Firm(), Make.Sizer);
        Assert.Null(done.Lines[0].Amount);
        Assert.Equal(0, done.Total);
        Assert.Contains(done.Warnings, w => w.StartsWith("No rate for F9", StringComparison.Ordinal));
    }

    [Fact]
    public void Warns_when_billed_than_differs_from_the_entries()
    {
        var entry = Make.Entry(18, 150);
        var done = BillCalculator.Complete(Make.Doc([Make.Priced(148, 63m) with { EntryIds = [18] }]), null, [entry], Make.Firm(), Make.Sizer);
        Assert.Contains(done.Warnings, w => w.Contains("(148) differs from NETT THAN of its entries (150)", StringComparison.Ordinal));
    }

    [Fact]
    public void Warns_about_undispatched_and_partly_dispatched_entries()
    {
        var notSent = Make.Entry(1, 10, inward: 11, dispatched: 0);
        var partly = Make.Entry(2, 10, inward: 12, dispatched: 4);
        var done = BillCalculator.Complete(Make.Doc([Make.Priced(20, 5m) with { EntryIds = [1, 2] }]), null, [notSent, partly], Make.Firm(), Make.Sizer);
        Assert.Contains(done.Warnings, w => w.Contains("billed before dispatch (INW. NO. 11)", StringComparison.Ordinal));
        Assert.Contains(done.Warnings, w => w.Contains("only partly dispatched (INW. NO. 12)", StringComparison.Ordinal));
    }

    [Fact]
    public void Warns_in_indian_digits_when_the_total_reaches_the_limit()
    {
        var done = BillCalculator.Complete(Make.Doc([Make.Priced(1000, 200m)]), null, null, Make.Firm(limit: 200000), Make.Sizer);
        Assert.Contains(done.Warnings, w => w.Contains("₹2,10,000", StringComparison.Ordinal) && w.Contains("₹2,00,000", StringComparison.Ordinal));
    }

    [Fact]
    public void Missing_or_invalid_gstin_is_a_warning_not_an_error()
    {
        var none = BillCalculator.Complete(Make.Doc([Make.Priced(1, 1m)], gstin: ""), null, null, Make.Firm(), Make.Sizer);
        var bad = BillCalculator.Complete(Make.Doc([Make.Priced(1, 1m)], gstin: "08ABCDE1234F1ZX"), null, null, Make.Firm(), Make.Sizer);
        Assert.Contains("Party has no GSTIN.", none.Warnings);
        Assert.Contains(bad.Warnings, w => w.Contains("is not valid", StringComparison.Ordinal));
    }

    [Fact]
    public void Long_reference_lists_count_as_two_printed_rows()
    {
        var lines = new List<LineDto> { Make.Priced(4, 1m, dn: "13481,13482,13483,13484") };
        var done = BillCalculator.Complete(Make.Doc(lines), null, null, Make.Firm(), Make.Sizer);
        Assert.Equal(2, done.Lines[0].Rows);
    }

    [Fact]
    public void Rows_problem_names_the_tall_lines_and_is_null_when_they_fit()
    {
        var lines = Enumerable.Range(0, 24).Select(_ => Make.Detail(1) with { Rows = 1 }).Append(Make.Priced(24, 1m) with { Rows = 2 }).ToList();
        var problem = BillCalculator.RowsProblem(lines, 25, "Bill ");
        Assert.NotNull(problem);
        Assert.StartsWith("Bill needs 26 printed rows (line 25 has a long lot or D.N. list", problem, StringComparison.Ordinal);
        Assert.Null(BillCalculator.RowsProblem(lines, 26));
    }

    [Fact]
    public void Saved_bills_keep_their_own_rules_for_limits_and_rows()
    {
        var bill = Make.Firm(rows: 30, limit: 0);
        var doc = Make.Doc(Enumerable.Range(0, 27).Select(i => Make.Priced(1, 1m)).ToList(), firm: bill);
        var done = BillCalculator.Complete(doc, null, null, Make.Firm(rows: 25, limit: 10), Make.Sizer);
        Assert.DoesNotContain(done.Warnings, w => w.Contains("printed rows", StringComparison.Ordinal));
        Assert.DoesNotContain(done.Warnings, w => w.Contains("limit", StringComparison.Ordinal));
        Assert.Same(bill, done.Firm);
    }
}

public sealed class TaxModeTests
{
    [Theory]
    [InlineData("08TESTF9001J1ZJ", "", TaxMode.Intra)]
    [InlineData("24TESTF9001J1ZP", "", TaxMode.Inter)]
    [InlineData("", "", TaxMode.Intra)]
    [InlineData("", "(HOME STATE)", TaxMode.Intra)]
    [InlineData("", "AHMEDABAD-(GUJ.)", TaxMode.Inter)]
    public void Gstin_state_code_decides_else_the_state_name(string gstin, string state, TaxMode expected) =>
        Assert.Equal(expected, TaxModes.Resolve(Make.Firm(homeCode: "08"), gstin, state));
}

public sealed class FinishResolverTests
{
    private static readonly Dictionary<string, IReadOnlyList<string>> Fallbacks = new(StringComparer.OrdinalIgnoreCase)
    {
        ["F-GOTKA"] = ["F2"],
        ["F1"] = ["F1J", "F1B"],
    };

    [Fact]
    public void Party_bill_as_wins_over_everything() =>
        Assert.Equal("F1B", Make.Resolver(new Dictionary<string, string> { ["F1"] = "F1B" }, [("F1", 1), ("F1J", 1), ("F1B", 1)], Fallbacks).Resolve("f1"));

    [Fact]
    public void Own_rate_is_used_before_a_fallback() => Assert.Equal("F1", Make.Resolver(new Dictionary<string, string>(), [("F1", 1), ("F1J", 1)], Fallbacks).Resolve("F1"));

    [Fact]
    public void Fallback_applies_when_the_party_has_no_rate_for_the_inward_finish() =>
        Assert.Equal("F2", Make.Resolver(new Dictionary<string, string>(), [("F2", 1)], Fallbacks).Resolve("F-GOTKA"));

    [Fact]
    public void First_fallback_with_a_rate_is_chosen() => Assert.Equal("F1B", Make.Resolver(new Dictionary<string, string>(), [("F1B", 1)], Fallbacks).Resolve("F1"));

    [Fact]
    public void No_rate_anywhere_keeps_the_finish() => Assert.Equal("F1", Make.Resolver(new Dictionary<string, string>(), [("F2", 1)], Fallbacks).Resolve("F1"));

    [Fact]
    public void Rates_are_found_ignoring_case()
    {
        var resolver = Make.Rates(("F1", 12.5m));
        Assert.Equal(12.5m, resolver.Rate("f1"));
        Assert.Null(resolver.Rate("F2"));
        Assert.Null(resolver.Rate(null));
    }
}

public sealed class BillItemBuilderTests
{
    private static readonly FinishResolver Rate = Make.Rates(("F1", 10), ("F2", 20));

    [Theory]
    [InlineData(ColumnContent.Blank, "")]
    [InlineData(ColumnContent.GatePass, "G7")]
    [InlineData(ColumnContent.DesignNo, "D7")]
    [InlineData(ColumnContent.LotNo, "L7")]
    public void Each_column_shows_what_the_style_says(ColumnContent content, string expected)
    {
        var entry = Make.Entry(1, 10, dn: "D7", lot: "L7", gatePass: "G7");
        var asGpn = BillItemBuilder.Build([entry], Make.Style(gpn: content, dn: ColumnContent.Blank, lot: ColumnContent.LotNo), Make.Firm(), Rate).Single();
        var asDn = BillItemBuilder.Build([entry], Make.Style(gpn: ColumnContent.Blank, dn: content, lot: ColumnContent.LotNo), Make.Firm(), Rate).Single();
        var asLot = BillItemBuilder.Build([entry], Make.Style(gpn: ColumnContent.GatePass, dn: ColumnContent.Blank, lot: content), Make.Firm(), Rate).Single();
        Assert.Equal(expected, asGpn.Gpn);
        Assert.Equal(expected, asDn.Dn);
        Assert.Equal(expected, asLot.Lot);
    }

    [Fact]
    public void Same_lot_lines_treat_L_624_and_624_as_one_lot_but_keep_finishes_apart()
    {
        var style = Make.Style(lines: LineGrouping.SameLot, combine: false);
        var items = BillItemBuilder.Build(
            [Make.Entry(1, 10, lot: "L   624"), Make.Entry(2, 12, lot: "624"), Make.Entry(3, 9, lot: "624", finish: "F2"), Make.Entry(4, 8, lot: "625")],
            style, Make.Firm(), Rate);
        Assert.Equal(3, items.Count);
        Assert.Equal(22, items[0].Qty);
        Assert.Equal("624", items[0].Lot);
    }

    [Fact]
    public void Same_gate_pass_lines_combine_entries_sent_together()
    {
        var style = Make.Style(gpn: ColumnContent.GatePass, lines: LineGrouping.SameGatePass, combine: false);
        var items = BillItemBuilder.Build(
            [Make.Entry(1, 10, gatePass: "4306"), Make.Entry(2, 12, gatePass: "4306"), Make.Entry(3, 9, gatePass: "4311")], style, Make.Firm(), Rate);
        Assert.Equal([22, 9], items.Select(i => i.Qty));
        Assert.Equal("4306", items[0].Gpn);
    }

    [Fact]
    public void One_line_per_entry_keeps_every_entry_apart()
    {
        var items = BillItemBuilder.Build([Make.Entry(1, 10, lot: "5"), Make.Entry(2, 12, lot: "5")], Make.Style(combine: false), Make.Firm(), Rate);
        Assert.Equal(2, items.Count);
    }

    [Fact]
    public void Breakdown_goes_into_the_blank_column_or_after_the_lot()
    {
        var entries = new[] { Make.Entry(1, 15, lot: "9", dn: "A"), Make.Entry(2, 28, lot: "9", dn: "B") };
        var dnBlank = BillItemBuilder.Build(entries, Make.Style(dn: ColumnContent.Blank, lines: LineGrouping.SameLot, breakdown: true, combine: false), Make.Firm(), Rate).Single();
        var lotBlank = BillItemBuilder.Build(entries, Make.Style(lot: ColumnContent.Blank, lines: LineGrouping.SameLot, breakdown: true, combine: false), Make.Firm(), Rate).Single();
        var both = BillItemBuilder.Build(entries, Make.Style(lines: LineGrouping.SameLot, breakdown: true, combine: false), Make.Firm(), Rate).Single();
        Assert.Equal("(15+28)", dnBlank.Dn);
        Assert.Equal("(15+28)", lotBlank.Lot);
        Assert.Equal("A,B", both.Dn);
        Assert.Equal("9 (15+28)", both.Lot);
    }

    [Fact]
    public void No_breakdown_for_a_single_entry() =>
        Assert.Equal("9", BillItemBuilder.Build([Make.Entry(1, 15, lot: "9")], Make.Style(breakdown: true), Make.Firm(), Rate).Single().Lot);

    [Fact]
    public void Inward_order_puts_older_months_and_carryovers_first()
    {
        var items = BillItemBuilder.Build(
            [Make.Entry(1, 10, inward: 5, month: "2026-10"), Make.Entry(2, 10, inward: 900, month: "2026-10", carried: true), Make.Entry(3, 10, inward: 1, month: "2026-11"), Make.Entry(4, 10, inward: 2, month: "2026-10")],
            Make.Style(combine: false), Make.Firm(), Rate);
        Assert.Equal([2L, 4, 1, 3], items.Select(i => i.Entries[0].Id));
    }

    [Fact]
    public void Reference_order_sorts_by_the_number_shown_naturally()
    {
        var items = BillItemBuilder.Build(
            [Make.Entry(1, 10, lot: "100"), Make.Entry(2, 10, lot: "9"), Make.Entry(3, 10, lot: "A1"), Make.Entry(4, 10, lot: "10")],
            Make.Style(order: LineOrder.Reference, combine: false), Make.Firm(), Rate);
        Assert.Equal(["9", "10", "100", "A1"], items.Select(i => i.Lot));
    }

    [Fact]
    public void Inward_date_order_sorts_by_date()
    {
        var items = BillItemBuilder.Build(
            [Make.Entry(1, 10, date: "2026-10-09"), Make.Entry(2, 10, date: "2026-10-01"), Make.Entry(3, 10, date: "2026-10-05")],
            Make.Style(order: LineOrder.InwardDate, combine: false), Make.Firm(), Rate);
        Assert.Equal([2L, 3, 1], items.Select(i => i.Entries[0].Id));
    }

    [Fact]
    public void Small_entries_of_one_finish_are_combined_up_to_the_limit()
    {
        var entries = Enumerable.Range(1, 7).Select(i => Make.Entry(i, 2, dn: $"D{i}")).Append(Make.Entry(8, 20, dn: "BIG")).ToList();
        var items = BillItemBuilder.Build(entries, Make.Style(), Make.Firm(smallBelow: 5, combineMax: 3), Rate);
        Assert.Equal([3, 3, 1, 1], items.Select(i => i.Entries.Count));
        Assert.Equal("D1,D2,D3", items[0].Dn);
        Assert.Equal(8, items.Sum(i => i.Entries.Count));
    }

    [Fact]
    public void Small_entries_of_different_finishes_are_not_combined()
    {
        var items = BillItemBuilder.Build([Make.Entry(1, 2), Make.Entry(2, 2, finish: "F2")], Make.Style(), Make.Firm(), Rate);
        Assert.Equal(2, items.Count);
    }

    [Theory]
    [InlineData(false, 5)]
    [InlineData(true, 0)]
    public void Combining_can_be_turned_off_by_the_style_or_the_rules(bool styleCombines, int smallBelow)
    {
        var items = BillItemBuilder.Build([Make.Entry(1, 2), Make.Entry(2, 2), Make.Entry(3, 2)], Make.Style(combine: styleCombines), Make.Firm(smallBelow: smallBelow), Rate);
        Assert.Equal(3, items.Count);
    }

    [Fact]
    public void Bill_as_finish_is_used_for_the_line()
    {
        var resolver = Make.Resolver(new Dictionary<string, string> { ["F1"] = "F2" }, [("F2", 20)]);
        Assert.Equal("F2", BillItemBuilder.Build([Make.Entry(1, 10)], Make.Style(), Make.Firm(), resolver).Single().Finish);
    }
}

public sealed class BillPackerTests
{
    private static readonly FinishResolver Rates = Make.Rates(("F1", 75), ("F2", 50), ("F3", 40));

    [Theory]
    [InlineData(25)]
    [InlineData(30)]
    [InlineData(35)]
    public void Each_bill_holds_at_most_its_rows_and_no_entry_is_lost(int rows)
    {
        var entries = Enumerable.Range(1, 80).Select(i => Make.Entry(i, 10, dn: i.ToString(System.Globalization.CultureInfo.InvariantCulture))).ToList();
        var pages = Make.Pack(entries, Make.Style(combine: false), Rates, Make.Firm(rows: rows, limit: 0));
        Assert.All(pages, p => Assert.True(p.Sum(l => Make.Sizer.RowsFor(l, 7.5m)) <= rows));
        Assert.Equal(800, pages.Sum(p => p.Where(l => l.Kind == LineKind.Priced).Sum(l => l.Qty ?? 0)));
        Assert.Equal(entries.Select(e => e.Id).Order(), pages.SelectMany(p => p).SelectMany(l => l.EntryIds ?? []).Order());
    }

    [Fact]
    public void Each_bill_stays_below_the_limit()
    {
        var entries = Enumerable.Range(1, 20).Select(i => Make.Entry(i, 100)).ToList();
        var pages = Make.Pack(entries, Make.Style(), Make.Rates(("F1", 300)), Make.Firm(limit: 200000));
        Assert.True(pages.Count > 1);
        Assert.All(pages, p => Assert.True(BillCalculator.Totals(p, 0, TaxMode.Intra, Make.Firm()).Total < 200000));
    }

    [Fact]
    public void Finishes_are_blocks_ending_in_a_priced_row_separated_by_blank_rows()
    {
        var entries = new[] { Make.Entry(1, 10), Make.Entry(2, 10), Make.Entry(3, 10, finish: "F2"), Make.Entry(4, 10, finish: "F2") };
        var page = Make.Pack(entries, Make.Style(combine: false), Rates, Make.Firm()).Single();
        Assert.Equal([LineKind.Detail, LineKind.Detail, LineKind.Priced, LineKind.Blank, LineKind.Detail, LineKind.Detail, LineKind.Priced], page.Select(l => l.Kind));
        Assert.All(page.Where(l => l.Kind == LineKind.Priced), l => Assert.True(l.AutoSum));
    }

    [Fact]
    public void Single_entry_finishes_carry_their_references_on_the_priced_row_at_the_top()
    {
        var entries = new[] { Make.Entry(1, 10, dn: "A"), Make.Entry(2, 10, dn: "B"), Make.Entry(3, 7, finish: "F3", dn: "SOLO") };
        var page = Make.Pack(entries, Make.Style(combine: false), Rates, Make.Firm()).Single();
        Assert.Equal(LineKind.Priced, page[0].Kind);
        Assert.Equal(("SOLO", "F3", 7), (page[0].Dn, page[0].Finish, page[0].Qty));
        Assert.Equal(LineKind.Blank, page[1].Kind);
    }

    [Fact]
    public void Lines_with_long_reference_lists_take_two_rows_and_pages_still_fit()
    {
        var entries = Enumerable.Range(1, 60).Select(i => Make.Entry(i, 2, dn: (13000 + i).ToString(System.Globalization.CultureInfo.InvariantCulture))).ToList();
        var pages = Make.Pack(entries, Make.Style(lot: ColumnContent.Blank), Rates, Make.Firm(rows: 25, smallBelow: 5, combineMax: 4, limit: 0));
        var rows = pages.Select(p => p.Sum(l => Make.Sizer.RowsFor(l, 7.5m))).ToList();
        Assert.Contains(pages.SelectMany(p => p), l => Make.Sizer.RowsFor(l, 7.5m) == 2);
        Assert.All(rows, r => Assert.True(r <= 25));
        Assert.Equal(60, pages.SelectMany(p => p).SelectMany(l => l.EntryIds ?? []).Distinct().Count());
    }

    [Fact]
    public void Random_bills_never_overflow_and_never_lose_or_repeat_an_entry()
    {
        var random = new Random(20261120);
        string[] finishes = ["F1", "F2", "F3"];
        for (var round = 0; round < 60; round++)
        {
            var count = random.Next(1, 120);
            var entries = Enumerable.Range(1, count).Select(i => Make.Entry(i, random.Next(1, 60), finish: finishes[random.Next(3)],
                dn: string.Join(",", Enumerable.Range(0, random.Next(1, 4)).Select(_ => random.Next(1, 99999))), lot: random.Next(1, 3000).ToString(System.Globalization.CultureInfo.InvariantCulture),
                gatePass: random.Next(1, 40).ToString(System.Globalization.CultureInfo.InvariantCulture))).ToList();
            var style = Make.Style((ColumnContent)random.Next(4), (ColumnContent)random.Next(1, 4), (ColumnContent)random.Next(4), (LineGrouping)random.Next(3), (LineOrder)random.Next(3), random.Next(2) == 0, random.Next(2) == 0);
            var firm = Make.Firm(rows: random.Next(5, 36), limit: random.Next(2) == 0 ? 0 : random.Next(20000, 300000), smallBelow: random.Next(0, 8), combineMax: random.Next(2, 6));
            var pages = Make.Pack(entries, style, Rates, firm);
            var ids = pages.SelectMany(p => p).SelectMany(l => l.EntryIds ?? []).ToList();
            Assert.Equal(entries.Select(e => e.Id).Order(), ids.Order());
            Assert.All(pages, p => Assert.True(p.Sum(l => Make.Sizer.RowsFor(l, 7.5m)) <= firm.RowsPerInvoice, $"round {round}: page over {firm.RowsPerInvoice} rows"));
            Assert.Equal(entries.Sum(e => e.NettThan), pages.Sum(p => BillCalculator.Totals(p, 0, TaxMode.Intra, firm).Than));
        }
    }
}
