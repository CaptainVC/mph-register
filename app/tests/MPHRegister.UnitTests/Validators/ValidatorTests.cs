using MPHRegister.Contracts.Entries;
using MPHRegister.Contracts.Masters;
using MPHRegister.Contracts.Settings;
using MPHRegister.Services.Validators;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Enums;
using MPHRegister.UnitTests.TestSupport;

namespace MPHRegister.UnitTests.Validators;

public sealed class EntryValidatorTests
{
    private static EntryInput Entry(int? than = 10, int? tp = 0, string date = "2026-11-02", int? inward = 1, string? party = "P", string? finish = "F1", params DispatchInput[] dispatches) =>
        new("2026-11", inward, date, party, "", "", false, than, tp, 0, finish, null, dispatches);

    [Fact]
    public void Good_entry_passes() => Assert.Empty(new EntryInputValidator().ErrorsFor(Entry()));

    [Fact]
    public void Zero_quantity_is_rejected_when_there_is_two_part_or_a_dispatch()
    {
        var withTwoPart = new EntryInputValidator().ErrorsFor(Entry(than: 0) with { TwoPart = 2 });
        Assert.Contains("THAN + TP must be more than 0.", withTwoPart);
        var dispatched = new EntryInputValidator().ErrorsFor(Entry(0, 0, "2026-11-02", 1, "P", null, new DispatchInput(1, "9", "2026-11-03")));
        Assert.Contains("THAN + TP must be more than 0.", dispatched);
        Assert.DoesNotContain("Choose a finish.", dispatched);
    }

    [Fact]
    public void All_zero_slip_needs_no_finish()
    {
        Assert.Empty(new EntryInputValidator().ErrorsFor(Entry(than: 0, finish: null)));
        Assert.True(EntryInputValidator.IsAllZero(Entry(than: null, tp: null, finish: null)));
    }

    [Fact]
    public void The_finish_may_be_left_blank_to_fill_in_later()
    {
        Assert.Empty(new EntryInputValidator().ErrorsFor(Entry(than: 6, finish: null)));
        Assert.Empty(new EntryInputValidator().ErrorsFor(Entry(than: 6, finish: " ") with { LotNo = "R", Repair = true }));
    }

    [Fact]
    public void Inward_number_zero_is_accepted_as_a_blank_register_number() => Assert.Empty(new EntryInputValidator().ErrorsFor(Entry(inward: 0)));

    [Fact]
    public void Missing_basics_are_each_reported()
    {
        var errors = new EntryInputValidator().ErrorsFor(Entry(than: null, tp: 1, date: "31/10/2026", inward: null, party: " ", finish: null));
        Assert.Contains("Inward number must be 0 or more.", errors);
        Assert.Contains("Enter a valid date.", errors);
        Assert.Contains("Choose a party.", errors);
        Assert.Contains("THAN must be 0 or more.", errors);
    }

    [Fact]
    public void Dispatch_before_inward_and_over_dispatch_are_rejected()
    {
        var errors = new EntryInputValidator().ErrorsFor(Entry(10, 0, "2026-11-02", 1, "P", "F1", new DispatchInput(11, "9", "2026-11-01")));
        Assert.Contains("Dispatch 1: date is before the inward date.", errors);
        Assert.Contains("Total dispatched (11) is more than NAG + TWO PART (10).", errors);
    }

    [Fact]
    public void A_dispatch_needs_quantity_gate_pass_and_date()
    {
        var errors = new EntryInputValidator().ErrorsFor(Entry(10, 0, "2026-11-02", 1, "P", "F1", new DispatchInput(0, " ", null)));
        Assert.Contains("Dispatch 1: JAWAK NAG must be 1 or more.", errors);
        Assert.Contains("Dispatch 1: enter the gate pass number.", errors);
        Assert.Contains("Dispatch 1: enter a valid date.", errors);
    }
}

public sealed class MasterValidatorTests
{
    private static PartyInput Party(string? name = "X", string? gstin = "", decimal? discount = 10) =>
        new(null, name, true, "", "", gstin, discount, "black", null, false, null, null);

    [Fact]
    public void Party_with_bad_gstin_discount_or_no_name_is_rejected()
    {
        var errors = new PartyInputValidator().ErrorsFor(Party(name: " ", gstin: "08TESTA12341ZU", discount: 100.5m));
        Assert.Contains("Party name is required.", errors);
        Assert.Contains(errors, e => e.StartsWith("GSTIN \"08TESTA12341ZU\" is not valid", StringComparison.Ordinal));
        Assert.Contains("Discount must be between 0 and 100.", errors);
        Assert.Contains("Discount can have at most 2 decimals.", new PartyInputValidator().ErrorsFor(Party(discount: 1.234m)));
        Assert.Empty(new PartyInputValidator().ErrorsFor(Party(gstin: "08testf9001j1zj", discount: null)));
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(-1, false)]
    [InlineData(0.01, true)]
    [InlineData(100000, true)]
    [InlineData(100000.01, false)]
    [InlineData(77.555, false)]
    public void Rate_must_be_positive_capped_and_two_decimals(double rate, bool ok)
    {
        var errors = new RateInputValidator().ErrorsFor(new RateInput("P", "F1", null, (decimal)rate));
        Assert.Equal(ok, errors.Count == 0);
    }

    [Fact]
    public void Rate_needs_a_party_and_a_finish() =>
        Assert.Equal(3, new RateInputValidator().ErrorsFor(new RateInput(" ", null, null, null)).Count);

    [Fact]
    public void Finish_cannot_fall_back_to_itself_or_to_too_many() =>
        Assert.Equal(2, new FinishInputValidator().ErrorsFor(new FinishInput(null, "F1", true, "", "black", ["f1", "A", "B", "C", "D", "E"])).Count);

    [Fact]
    public void Style_must_show_something_and_have_a_name()
    {
        var errors = new StyleInputValidator().ErrorsFor(new StyleInput(null, "", null, ColumnContent.Blank, ColumnContent.Blank, ColumnContent.Blank,
            LineGrouping.OnePerEntry, LineOrder.Inward, false, true));
        Assert.Contains("Style name is required.", errors);
        Assert.Contains("Choose at least one of G.P.N., D.N. or LOT NO. to show on the bill.", errors);
        Assert.Contains("Billing style has an unknown option.", new StyleInputValidator().ErrorsFor(new StyleInput(null, "S", null, (ColumnContent)9,
            ColumnContent.DesignNo, ColumnContent.LotNo, LineGrouping.OnePerEntry, LineOrder.Inward, false, true)));
    }

    [Theory]
    [InlineData("navy", "#000080", true)]
    [InlineData("navy", "#00008", false)]
    [InlineData("navy", "blue", false)]
    [InlineData("#abc", "#000080", false)]
    [InlineData("", "#000080", false)]
    public void Colour_needs_a_name_and_a_hex_value(string name, string hex, bool ok) =>
        Assert.Equal(ok, new ColorInputValidator().ErrorsFor(new ColorInput(null, name, hex)).Count == 0);
}

public sealed class SettingsValidatorTests
{
    private static SettingsInput Input(FirmProfile? firm = null, BillRules? rules = null, PrintSettings? print = null, string? fy = null, int? next = null) =>
        new(firm, rules, null, print, null, fy, next);

    [Fact]
    public void Sections_left_out_are_not_checked() => Assert.Empty(new SettingsInputValidator().ErrorsFor(Input()));

    [Fact]
    public void Firm_needs_a_name_a_valid_gstin_and_a_two_digit_state_code()
    {
        var errors = new SettingsInputValidator().ErrorsFor(Input(firm: new FirmProfile { Name = " ", Gstin = "08ABCDE1234F1ZX", HomeStateCode = "8" }));
        Assert.Equal(3, errors.Count);
    }

    [Theory]
    [InlineData(4, false)]
    [InlineData(5, true)]
    [InlineData(60, true)]
    [InlineData(61, false)]
    public void Rows_per_bill_stay_between_5_and_60(int rows, bool ok) =>
        Assert.Equal(ok, new SettingsInputValidator().ErrorsFor(Input(rules: new BillRules { RowsPerBill = rows })).Count == 0);

    [Fact]
    public void Other_bill_rules_are_range_checked()
    {
        var errors = new SettingsInputValidator().ErrorsFor(Input(rules: new BillRules { NumberPrefix = "", TotalMustStayBelow = -1, CombineUpTo = 1, CombineSmallBelowThan = 101, IgstPercent = 29 }));
        Assert.Equal(5, errors.Count);
    }

    [Theory]
    [InlineData(4.9, false)]
    [InlineData(5, true)]
    [InlineData(12, true)]
    [InlineData(12.5, false)]
    public void Smallest_font_stays_readable(double size, bool ok) =>
        Assert.Equal(ok, new SettingsInputValidator().ErrorsFor(Input(print: new PrintSettings { SmallestFontPt = (decimal)size })).Count == 0);

    [Fact]
    public void Financial_year_and_next_number_are_checked()
    {
        var errors = new SettingsInputValidator().ErrorsFor(Input(fy: "2026", next: 0));
        Assert.Contains("Financial year must look like 26-27.", errors);
        Assert.Contains("Next bill number must be 1 or more.", errors);
    }

    [Fact]
    public void Too_many_terms_or_too_long_texts_are_rejected()
    {
        var input = new SettingsInput(null, null, new PrintedTexts { Terms = ["1", "2", "3", "4", "5"], Title = new string('x', 301) }, null, null, null, null);
        Assert.Equal(2, new SettingsInputValidator().ErrorsFor(input).Count);
    }
}

public sealed class BillValidatorTests
{
    [Fact]
    public void Bill_lines_need_a_priced_row_and_two_decimal_rates()
    {
        var errors = new BillLinesValidator().ErrorsFor(new BillLines([Make.Detail(5), Make.Priced(5, 1.234m)]));
        Assert.Contains("Row 2: RATE can have at most 2 decimals.", errors);
        Assert.Empty(new BillLinesValidator().ErrorsFor(new BillLines([Make.Priced(5, 1.23m)])));
        Assert.Contains("A bill needs at least one line.", new BillLinesValidator().ErrorsFor(new BillLines(null)));
        Assert.Contains("A bill needs at least one priced row (with FINISH and RATE).", new BillLinesValidator().ErrorsFor(new BillLines([Make.Detail(1)])));
    }

    [Fact]
    public void Bill_dates_must_be_real_and_in_order()
    {
        Assert.Empty(new BillDatesValidator().ErrorsFor(new BillDates("2026-10-31", "2026-10-01", "2026-10-31")));
        Assert.Contains("Bill period 'to' date is before the 'from' date.", new BillDatesValidator().ErrorsFor(new BillDates("2026-10-31", "2026-10-02", "2026-10-01")));
        Assert.Contains("Enter a valid bill date.", new BillDatesValidator().ErrorsFor(new BillDates("2026-02-30", "2026-10-01", "2026-10-31")));
        Assert.Contains("Enter a valid bill period (from and to).", new BillDatesValidator().ErrorsFor(new BillDates("2026-10-31", "", "2026-10-31")));
    }

    [Fact]
    public void Bill_period_must_be_real_and_in_order()
    {
        Assert.Empty(new BillPeriodValidator().ErrorsFor(new BillPeriod("2026-11-01", "2026-11-01")));
        Assert.Equal(["Bill period 'to' date is before the 'from' date."], new BillPeriodValidator().ErrorsFor(new BillPeriod("2026-11-02", "2026-11-01")));
        Assert.Equal(["Enter a valid bill period (from and to)."], new BillPeriodValidator().ErrorsFor(new BillPeriod("2026-11-01", null)));
        Assert.Equal(["Enter a valid bill period (from and to)."], new BillPeriodValidator().ErrorsFor(new BillPeriod("2026-11-31", "2026-12-01")));
    }

    [Fact]
    public void Firm_snapshot_defaults_to_letter_paper_and_lakh_grouping()
    {
        FirmSettings firm = Make.Firm();
        Assert.Equal(PaperSize.Letter, firm.PaperSize);
        Assert.True(firm.IndianNumbers);
        Assert.Null(firm.Texts);
    }
}
