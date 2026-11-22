using MPHRegister.Contracts.Billing;
using MPHRegister.Contracts.Entries;
using MPHRegister.Services.Billing;
using MPHRegister.Services.Imports.Bills;
using MPHRegister.Shared.Enums;
using MPHRegister.UnitTests.TestSupport;

namespace MPHRegister.UnitTests.Imports;

/// <summary>How Excel bill lines find the inward entries they bill, on made-up lines shaped like the real October workbooks.</summary>
public sealed class BillLineMatcherTests
{
    private static readonly DateOnly October = new(2026, 10, 1);
    private static readonly DateOnly OctoberEnd = new(2026, 10, 31);
    private static readonly FinishResolver Finishes = Make.Rates(("F1", 10m));
    private static readonly IReadOnlySet<string> Own = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "PARTY A" };

    private static EntryDto Entry(long id, int than, string date, string gatePass = "", string dn = "", string lot = "", string party = "PARTY A", string? sent = null)
    {
        var entry = Make.Entry(id, than, dn: dn, lot: lot, date: date, gatePass: gatePass, party: party, month: date[..7]);
        return sent is null ? entry : entry with { Dispatches = [new DispatchDto(than, gatePass, sent, null)] };
    }

    private static MatchLine Line(int key, int qty, string gpn = "", string dn = "", string lot = "", string finish = "F1", IReadOnlySet<string>? own = null) =>
        new(key, new LineDto(LineKind.Detail, gpn, dn, lot, string.Empty, qty, null, null, false, []), finish, October, OctoberEnd, own ?? Own, Finishes);

    private static MatchResult Match(IReadOnlyList<MatchLine> lines, params EntryDto[] pool) => BillLineMatcher.Match(lines, pool, MatchMode.Full);

    [Fact]
    public void Shorthand_in_a_cell_is_written_out_in_full()
    {
        Assert.Equal(["1049", "1050", "1051", "1052", "1053"], RefTokens.Parse("1049 TO 1053").Strong.Order(StringComparer.Ordinal));
        Assert.Equal(["1049", "1050", "1051", "1052", "1053"], RefTokens.Parse("1049 to 53").Strong.Order(StringComparer.Ordinal));
        var shortened = RefTokens.Parse("1134,35,36,");
        Assert.Equal(["1134", "1135", "1136"], shortened.Strong.Order(StringComparer.Ordinal));
        Assert.Equal(["35", "36"], shortened.Weak.Order(StringComparer.Ordinal));
        Assert.Equal(["13617", "13618"], RefTokens.Parse("13617,618").Strong.Order(StringComparer.Ordinal));
        Assert.Equal(["12"], RefTokens.Parse("12 (R) MIX").Strong);
        Assert.True(RefTokens.Parse("  ").IsEmpty);
    }

    [Fact]
    public void Six_designs_of_one_gate_pass_on_one_line_link_all_six()
    {
        // MAPLE MILLS INDIA 26-27\JOB\5 row 6: the six designs are spread over the G.P.N., D.N. and LOT columns.
        var pool = Enumerable.Range(1, 6).Select(i => Entry(i, 10, "2026-10-08", gatePass: "7719", dn: $"653{i}")).ToArray();
        var found = Match([Line(0, 60, gpn: "6531", dn: "6532,6533", lot: "6534,6535,6536")], pool);
        Assert.Equal([1L, 2, 3, 4, 5, 6], found.Links[0]);
        Assert.Empty(found.Missing);
    }

    [Fact]
    public void One_entry_billed_lot_by_lot_links_every_line()
    {
        // HARRISON INW 7: 24 THAN of design 12744 sent on gate pass 2682, billed as lot 1309 (16) and lot 1312 (8).
        var found = Match([Line(0, 16, gpn: "2682", dn: "12744", lot: "1309"), Line(1, 8, gpn: "2682", dn: "12744", lot: "1312")],
            Entry(7, 24, "2026-10-01", gatePass: "2682", dn: "12744"));
        Assert.Equal([7L], found.Links[0]);
        Assert.Equal([7L], found.Links[1]);
        Assert.Equal(24, found.Used[7]);
    }

    [Fact]
    public void Lots_mixed_both_ways_link_every_entry()
    {
        // Two slips each carry lots 650 and 651; the bill shows the lots one by one.
        var found = Match([Line(0, 80, lot: "650"), Line(1, 89, lot: "651")],
            Entry(1, 129, "2026-10-07", lot: "650,651"), Entry(2, 40, "2026-10-10", lot: "650,651"));
        Assert.Empty(found.Missing);
        Assert.Equal(169, found.Used.Values.Sum());
    }

    [Fact]
    public void A_single_lot_entry_is_not_displaced_by_newer_multi_lot_entries()
    {
        var september = Entry(1, 9, "2026-09-28", lot: "265", sent: "2026-09-01");
        var first = Entry(2, 100, "2026-10-08", lot: "264,265,268,272,273");
        var second = Entry(3, 130, "2026-10-10", lot: "264,265,268,272,273");

        var found = Match([Line(0, 90, lot: "264"), Line(1, 90, lot: "265"), Line(2, 49, lot: "268")],
            september, first, second);

        Assert.Contains(1L, found.Links[1]);
        Assert.Equal(9, found.Used[1]);
        Assert.Empty(found.Missing);
    }

    [Fact]
    public void An_older_single_lot_entry_does_not_displace_an_in_period_mixed_lot_entry()
    {
        var old = Entry(1, 9, "2026-09-20", lot: "265");
        var current = Entry(2, 100, "2026-10-08", lot: "264,265,268");
        var found = Match([Line(0, 90, lot: "265")], old, current);
        Assert.Equal([2L], found.Links[0]);
    }

    [Fact]
    public void Quantity_labels_are_matched_to_the_same_lots_in_the_preceding_finish_block()
    {
        var found = Match(QuantityLabelBill(), QuantityLabelEntries());

        Assert.Equal([1L], found.Links[0]);
        Assert.Equal([2L], found.Links[1]);
        Assert.Equal([3L], found.Links[2]);
        Assert.Equal(40, found.Used[2]);
        Assert.Equal(2L, found.QuantityLabels[1]);
        Assert.Equal(3L, found.QuantityLabels[2]);
        Assert.DoesNotContain(4L, found.Used.Keys);
        Assert.Empty(found.Missing);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Quantity_labels_do_not_claim_an_ambiguous_or_partly_unmatched_block(bool genuineLot)
    {
        var other = Entry(5, 40, "2026-10-24", lot: genuineLot ? "40" : "904");
        var found = Match(QuantityLabelBill(), [.. QuantityLabelEntries(), other]);

        Assert.Empty(found.QuantityLabels);
        Assert.DoesNotContain(2L, found.Used.Keys);
        Assert.DoesNotContain(3L, found.Used.Keys);
    }

    [Fact]
    public void Quantity_labels_cannot_use_an_anchor_from_another_bill()
    {
        var lines = QuantityLabelBill();
        lines[0] = lines[0] with { BillGroup = 2 };
        Assert.Empty(Match(lines, QuantityLabelEntries()).QuantityLabels);
    }

    private static MatchLine[] QuantityLabelBill()
    {
        var anchor = Line(0, 115, lot: "901,902,903,904", finish: "F2");
        return
        [
            anchor with { BillGroup = 1, Line = anchor.Line with { Kind = LineKind.Priced } },
            Line(1, 40, lot: "45") with { BillGroup = 1 },
            Line(2, 40, lot: "40") with { BillGroup = 1 },
        ];
    }

    private static EntryDto[] QuantityLabelEntries() =>
    [
        Entry(1, 115, "2026-10-13", lot: "901,902,903,904") with { Finish = "F2" },
        Entry(2, 45, "2026-10-13", lot: "901,902,903,904", sent: "2026-10-18"),
        Entry(3, 40, "2026-10-18", lot: "904", sent: "2026-10-26"),
        Entry(4, 40, "2026-10-26", lot: "905", sent: "2026-10-27"),
    ];

    [Fact]
    public void A_gate_pass_book_started_again_links_the_entry_of_this_period()
    {
        // Gate pass 57 was used in April and again in October; the October line also names design 4193.
        var april = Entry(388, 10, "2026-04-15", gatePass: "57", dn: "12831");
        var october = Entry(4765, 10, "2026-10-21", gatePass: "57", dn: "4193");
        var found = Match([Line(0, 10, gpn: "57", dn: "4193", lot: "15297")], april, october);
        Assert.Equal([4765L], found.Links[0]);
    }

    [Fact]
    public void A_line_with_numbers_is_not_linked_on_than_alone()
    {
        var found = Match([Line(0, 120, lot: "92")], Entry(1, 120, "2026-10-05", lot: "94"));
        Assert.Empty(found.Links);
        Assert.Equal(120, found.Missing[0]);
    }

    [Fact]
    public void A_line_without_numbers_takes_the_one_entry_of_that_than_and_finish()
    {
        var found = Match([Line(0, 48)], Entry(1, 48, "2026-10-05", lot: "7"), Entry(2, 30, "2026-10-05", lot: "8"));
        Assert.Equal([1L], found.Links[0]);
        Assert.Empty(Match([Line(0, 48)], Entry(1, 48, "2026-10-05"), Entry(2, 48, "2026-10-06")).Links);
    }

    [Fact]
    public void Own_entries_come_before_a_sister_firms_entries()
    {
        var own = Entry(1, 24, "2026-10-05", gatePass: "443", dn: "247");
        var sister = Entry(2, 24, "2026-10-05", gatePass: "443", dn: "247", party: "PARTY B");
        Assert.Equal([1L], Match([Line(0, 24, gpn: "443", dn: "247")], sister, own).Links[0]);
        Assert.Equal([2L], Match([Line(0, 24, gpn: "443", dn: "247")], sister).Links[0]);
    }

    [Fact]
    public void Entries_too_far_from_the_bill_period_are_left_alone()
    {
        Assert.Empty(Match([Line(0, 50, lot: "703")], Entry(1, 50, "2026-05-02", lot: "703")).Links);
        Assert.Empty(Match([Line(0, 50, lot: "703")], Entry(1, 50, "2026-11-20", lot: "703")).Links);
    }

    [Fact]
    public void A_small_part_of_an_entry_sent_after_the_period_is_left_for_the_next_bill()
    {
        // 1 THAN of lot 703 billed in October must not claim a 122-THAN slip that went out in November.
        var found = Match([Line(0, 1, lot: "703")], Entry(1, 122, "2026-10-30", lot: "703", sent: "2026-11-04"));
        Assert.Empty(found.Links);
    }

    [Fact]
    public void A_letter_label_in_another_column_links_its_entry()
    {
        // JARVIS 26-27\JOB\94 row 16: D.N. "D" bills the slip whose LOT N. is D.
        var found = Match([Line(0, 24, dn: "D")], Entry(332, 24, "2026-10-09", lot: "D"), Entry(333, 24, "2026-10-09", lot: "DR"));
        Assert.Equal([332L], found.Links[0]);
    }

    [Fact]
    public void A_number_one_digit_off_is_read_as_a_typing_slip_when_the_than_agree()
    {
        // M.ASHTON 26-27\JOB\223 row 4: lot 354 written as 344.
        var found = Match([Line(0, 47, lot: "344")], Entry(1, 47, "2026-10-09", lot: "354"));
        Assert.Equal([1L], found.Links[0]);
        Assert.Equal(["344 as 354"], found.Slips[0]);
        Assert.Empty(Match([Line(0, 50, lot: "344")], Entry(1, 47, "2026-10-09", lot: "354")).Links);
        Assert.Empty(Match([Line(0, 47, lot: "344")], Entry(1, 47, "2026-10-09", lot: "387")).Links);
    }

    [Fact]
    public void A_number_some_entry_has_as_written_is_not_a_typing_slip()
    {
        var billedAlready = Entry(1, 24, "2026-10-05", dn: "12744");
        var neighbour = Entry(2, 24, "2026-10-05", dn: "12745");
        Assert.Empty(BillLineMatcher.Match([Line(0, 24, dn: "12744")], [neighbour], MatchMode.Full, [billedAlready]).Links);
        Assert.Empty(BillLineMatcher.Match([Line(0, 24, dn: "12744")], [neighbour], MatchMode.NumbersOnly).Links);
    }

    [Fact]
    public void Typing_slips_over_several_lines_link_only_when_every_line_and_entry_is_complete()
    {
        // SHERWOOD 26-27\JOB\146 rows 4-6: lots 230, 234, 236 written as 231, 232, 233 (45 + 90 + 135 = 123 + 75 + 72).
        MatchLine[] lines = [Line(0, 45, lot: "231"), Line(1, 90, lot: "232"), Line(2, 135, lot: "233")];
        EntryDto[] pool = [Entry(1, 123, "2026-10-16", lot: "230,234,236"), Entry(2, 75, "2026-10-18", lot: "230,234,236"), Entry(3, 72, "2026-10-14", lot: "230,234,236")];
        var found = Match(lines, pool);
        Assert.Empty(found.Missing);
        Assert.Equal(270, found.Used.Values.Sum());
        Assert.Empty(Match(lines, pool[..2]).Links);
    }

    [Fact]
    public void A_shorter_number_far_from_the_one_before_is_a_number_of_its_own()
    {
        // M.ASHTON 26-27\JOB\223 row 4: lots 1060, 1061, 352 and 344, not 1352 and 1344.
        var tokens = RefTokens.Parse("1060,1061,352,344");
        Assert.Equal(["1060", "1061", "344", "352"], tokens.Strong.Order(StringComparer.Ordinal));
        Assert.Equal(["1352"], tokens.Weak);
    }

    [Fact]
    public void Two_rows_combined_under_one_number_link_the_slip_one_digit_off()
    {
        // MERCER 26-27\JOB\187 row 17: D.N. 13565 for 41 THAN = 1 THAN of 13565 + 40 THAN of 13665.
        var found = Match([Line(0, 41, dn: "13565", lot: "901,902")], Entry(1, 1, "2026-10-08", dn: "13565"), Entry(2, 40, "2026-10-04", dn: "13665"));
        Assert.Equal([1L, 2], found.Links[0]);
        Assert.Empty(found.Missing);
        Assert.Equal(["13565 also as 13665 (rows combined)"], found.Slips[0]);
    }

    [Fact]
    public void A_combined_row_takes_only_whole_entries_of_its_month_when_clearly_short()
    {
        // Short by 2 of 41: a piece returned, not a second slip.
        Assert.Equal([1L], Match([Line(0, 41, dn: "13565")], Entry(1, 39, "2026-10-08", dn: "13565"), Entry(2, 2, "2026-10-04", dn: "13665")).Links[0]);
        // The slip one digit off is in the next month's register.
        Assert.Equal([1L], Match([Line(0, 41, dn: "13565")], Entry(1, 1, "2026-10-08", dn: "13565"), Entry(2, 40, "2026-11-02", dn: "13665")).Links[0]);
        // The slip one digit off is partly billed on another line already.
        var shared = Match([Line(0, 41, dn: "13565"), Line(1, 10, dn: "13665")], Entry(1, 1, "2026-10-08", dn: "13565"), Entry(2, 50, "2026-10-04", dn: "13665"));
        Assert.Equal([1L], shared.Links[0]);
    }

    [Fact]
    public void A_number_billed_on_another_line_is_read_as_a_typing_slip_on_a_line_that_finds_nothing()
    {
        // M ASHTON FABRICS: lot 604 is billed on JOB\272; the lot 604 row of JOB\270 is lot 640.
        var found = Match([Line(0, 49, lot: "604"), Line(1, 51, lot: "604")], Entry(1, 49, "2026-10-02", lot: "604"), Entry(2, 51, "2026-10-04", lot: "640"));
        Assert.Equal([1L], found.Links[0]);
        Assert.Equal([2L], found.Links[1]);
        Assert.Equal(["604 also as 640 (rows combined)"], found.Slips[1]);
    }

    [Fact]
    public void A_number_of_a_slip_billed_months_before_does_not_stop_a_typing_slip()
    {
        // M.ASHTON JOB\223: lot 344 was a June lot ("343 TO 345", billed in June); on the September bill it is lot 354.
        MatchLine[] lines = [Line(0, 60, lot: "1061,344")];
        EntryDto[] pool = [Entry(1, 13, "2026-10-05", lot: "1061"), Entry(2, 47, "2026-10-09", lot: "354")];
        var june = Entry(3, 140, "2026-08-20", lot: "343 TO 345");
        Assert.Equal([1L, 2], BillLineMatcher.Match(lines, pool, MatchMode.Full, [june]).Links[0]);
        var lastMonth = Entry(3, 140, "2026-09-20", lot: "343 TO 345");
        Assert.Equal([1L], BillLineMatcher.Match(lines, pool, MatchMode.Full, [lastMonth]).Links[0]);
    }

    [Fact]
    public void Every_number_on_a_line_gets_its_own_slip()
    {
        // MAPLE MILLS 26-27\JOB\77 row 11: D.N. 6948, LOT 6894, 30 THAN = 12 of 6948 + 18 of 6894 (one gate pass); the other
        // 18 THAN of 6948 went on the next bill.
        var found = Match([Line(0, 30, dn: "6948", lot: "6894")],
            Entry(1, 12, "2026-10-24", gatePass: "2766", dn: "6948"), Entry(2, 18, "2026-10-29", gatePass: "2845", dn: "6948"),
            Entry(3, 18, "2026-10-24", gatePass: "2766", dn: "6894"));
        Assert.Equal([1L, 3], found.Links[0]);
        Assert.False(found.Used.ContainsKey(2));
    }

    [Fact]
    public void A_second_design_in_the_gate_pass_column_gets_its_slip()
    {
        // ARNOLD 26-27\JOB\41 rows 8-9: G.P.N. 13346 / D.N. 13349 = 22 + 7 THAN; G.P.N. 13344 / D.N. 13349 = 8 + 52 THAN.
        var found = Match([Line(0, 29, gpn: "13346", dn: "13349", lot: "938"), Line(1, 60, gpn: "13344", dn: "13349", lot: "938")],
            Entry(153, 22, "2026-10-01", gatePass: "2131", dn: "13346"), Entry(154, 7, "2026-10-01", gatePass: "2131", dn: "13349"),
            Entry(201, 8, "2026-10-05", gatePass: "2201", dn: "13344"), Entry(202, 52, "2026-10-05", gatePass: "2201", dn: "13349"));
        Assert.Equal([153L, 154], found.Links[0]);
        Assert.Equal([201L, 202], found.Links[1]);
        Assert.Empty(found.Missing);
    }

    [Fact]
    public void A_slip_with_no_design_or_lot_on_the_gate_pass_of_a_short_row_is_billed_on_it()
    {
        // MAPLE MILLS 26-27\JOB\77 row 17: designs 3215 and 2287 for 72 THAN; the third slip of gate pass 2790 has no design.
        var found = Match([Line(0, 72, dn: "3215,2287")],
            Entry(1, 24, "2026-10-25", gatePass: "2790", dn: "3215"), Entry(2, 24, "2026-10-25", gatePass: "2790", dn: "2287"),
            Entry(3, 24, "2026-10-25", gatePass: "2790"), Entry(4, 24, "2026-10-26", gatePass: "2816"));
        Assert.Equal([1L, 2, 3], found.Links[0]);
        Assert.Equal([3L], found.Plain[0]);
        // Two such slips of the same THAN and no gate pass to tell them apart: neither is taken.
        var unsure = Match([Line(0, 72, dn: "3215,2287")],
            Entry(1, 24, "2026-10-25", gatePass: "2790", dn: "3215"), Entry(2, 24, "2026-10-25", gatePass: "2790", dn: "2287"),
            Entry(3, 24, "2026-10-25", gatePass: "2791"), Entry(4, 24, "2026-10-26", gatePass: "2816"));
        Assert.Equal([1L, 2], unsure.Links[0]);
    }

    [Fact]
    public void Slips_with_no_design_or_lot_fill_mix_rows_when_every_row_and_slip_agrees()
    {
        // JARVIS 26-27\JOB\94 rows 15, 17, 18: "O,MIX" 29, "A,B" 96 and "MIX" 24 THAN; four plain slips of 24, 19, 5 and 24.
        MatchLine[] lines = [Line(0, 29, dn: "O,MIX"), Line(1, 91, dn: "A,B"), Line(2, 24, dn: "MIX")];
        var found = Match(lines, Entry(1, 24, "2026-10-09", lot: "O"), Entry(2, 24, "2026-10-09", lot: "A"), Entry(3, 24, "2026-10-09", lot: "B"),
            Entry(4, 24, "2026-10-06"), Entry(5, 19, "2026-10-06"), Entry(6, 5, "2026-10-09"), Entry(7, 24, "2026-10-12"));
        Assert.Empty(found.Missing);
        Assert.Equal(144, found.Used.Values.Sum());
    }

    [Fact]
    public void Repair_memo_rows_below_the_last_priced_row_are_not_billed_lines()
    {
        LineDto[] lines =
        [
            Make.Detail(20, lot: "61"),
            Make.Priced(20, 10, autoSum: true),
            Make.Detail(3, lot: "R,SG"),
        ];
        Assert.Equal([0], BillLineMatcher.Billable(lines).Select(x => x.Index));
    }
}
