using MPHRegister.Shared.Helpers;

namespace MPHRegister.UnitTests.Helpers;

public sealed class InwardNumbersTests
{
    [Theory]
    [InlineData("12-14", new[] { 12, 13, 14 })]
    [InlineData("13 TO 17", new[] { 13, 14, 15, 16, 17 })]
    [InlineData("139 TO  141", new[] { 139, 140, 141 })]
    [InlineData("470 TO482", new[] { 470, 471, 472, 473, 474, 475, 476, 477, 478, 479, 480, 481, 482 })]
    [InlineData("19,20", new[] { 19, 20 })]
    [InlineData("331, 332", new[] { 331, 332 })]
    [InlineData("2,,3", new[] { 2, 3 })]
    [InlineData("310.311", new[] { 310, 311 })]
    [InlineData("328/329", new[] { 328, 329 })]
    [InlineData("78--79", new[] { 78, 79 })]
    [InlineData("7 TO 11,13", new[] { 7, 8, 9, 10, 11, 13 })]
    [InlineData("35,49-51", new[] { 35, 49, 50, 51 })]
    [InlineData("44", new[] { 44 })]
    public void Reads_the_ways_the_gate_writes_slip_numbers(string text, int[] expected) =>
        Assert.Equal(expected, InwardNumbers.Read(text).Numbers);

    [Fact]
    public void A_name_written_with_the_numbers_becomes_the_note()
    {
        var read = InwardNumbers.Read("12 TO 14CARRIER");
        Assert.Equal([12, 13, 14], read.Numbers);
        Assert.Equal("CARRIER", read.Note);
        Assert.Equal("12 TO 14", read.NumbersText);

        var leading = InwardNumbers.Read("CARRIER-52-63");
        Assert.Equal(Enumerable.Range(52, 12), leading.Numbers);
        Assert.Equal("52-63", leading.NumbersText);
    }

    [Fact]
    public void Text_without_numbers_is_all_note()
    {
        var read = InwardNumbers.Read("Sent by the other firm");
        Assert.Empty(read.Numbers);
        Assert.Equal("Sent by the other firm", read.Note);
        Assert.Equal(string.Empty, read.NumbersText);
    }

    [Theory]
    [InlineData("237-24", 237, 240)]
    [InlineData("626-63", 626, 630)]
    [InlineData("105-6", 105, 106)]
    public void A_shortened_range_end_is_read_the_way_that_makes_a_range(string text, int from, int to) =>
        Assert.Equal(Enumerable.Range(from, to - from + 1), InwardNumbers.Read(text).Numbers);

    [Fact]
    public void A_shortened_end_that_fits_two_ways_gives_both_readings()
    {
        var read = InwardNumbers.Read("12-2");
        Assert.Equal(2, read.Readings.Count);
        Assert.Equal([12], read.Readings[0]);
        Assert.Equal(Enumerable.Range(12, 9), read.Readings[1]);
    }

    [Fact]
    public void A_range_too_long_for_one_consignment_keeps_only_its_ends() =>
        Assert.Equal([100, 400], InwardNumbers.Read("100-400").Numbers);

    [Fact]
    public void Formats_numbers_as_ranges() => Assert.Equal("12-14, 20, 22-23", InwardNumbers.Format([22, 12, 13, 14, 20, 23]));
}

public sealed class AawakNumberTests
{
    [Theory]
    [InlineData("217", 217, "")]
    [InlineData("217A", 217, "A")]
    [InlineData(" 12 b ", 12, "B")]
    public void Reads_a_number_with_an_optional_letter(string text, int number, string suffix)
    {
        Assert.True(AawakNumber.TryParse(text, out var n, out var s));
        Assert.Equal(number, n);
        Assert.Equal(suffix, s);
    }

    [Theory]
    [InlineData("")]
    [InlineData("0")]
    [InlineData("A1")]
    [InlineData("12AB")]
    public void Refuses_other_text(string text) => Assert.False(AawakNumber.TryParse(text, out _, out _));
}

public sealed class RegisterFileNameTests
{
    [Theory]
    [InlineData("Aawak--NOV.-26-27.xlsm", "2026-11")]
    [InlineData("AWAK--JUL.-26-27.xlsm", "2026-07")]
    [InlineData("Aawak--FEB.-26-27.xlsm", "2027-02")]
    [InlineData("INWARD REG.-JUN.-26-29.xlsm", "2026-06")]
    public void Guesses_the_month_from_the_file_name(string name, string month) => Assert.Equal(month, RegisterFileName.GuessMonth(name));

    [Fact]
    public void No_month_without_a_month_and_year() => Assert.Null(RegisterFileName.GuessMonth("gate register.xlsx"));
}
