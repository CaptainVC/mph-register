using MPHRegister.Shared.Helpers;

namespace MPHRegister.UnitTests.Helpers;

public sealed class RepairMarkTests
{
    // Every way the April–November 2026 registers wrote the repair mark in LOT N. or D.N.
    [Theory]
    [InlineData("R")]
    [InlineData("r")]
    [InlineData("R,118,125")]
    [InlineData("R,,1159")]
    [InlineData("R 146")]
    [InlineData("R1064")]
    [InlineData("12858,R")]
    [InlineData("R  12980")]
    [InlineData("R 13481,13484, 13489")]
    [InlineData("REP.")]
    public void The_R_mark_is_a_repair(string text) => Assert.True(RepairMark.Is(text));

    // Lot names that only start with R, ordinary numbers, and blanks are charged as usual.
    [Theory]
    [InlineData("RAJWADI")]
    [InlineData("R mix")]
    [InlineData("rMIX")]
    [InlineData("RB,325")]
    [InlineData("543,547,548")]
    [InlineData("MIX")]
    [InlineData("")]
    [InlineData(null)]
    public void Other_lots_are_not(string? text) => Assert.False(RepairMark.Is(text));

    [Fact]
    public void Either_column_can_carry_it()
    {
        Assert.True(RepairMark.In("", "R"));
        Assert.True(RepairMark.In("R", "1079"));
        Assert.False(RepairMark.In("543", "13761"));
    }
}

public sealed class RupeeWordsTests
{
    // Texts cached by Excel in the April–September bill workbooks (=RupeeFormat(G43)), spaces and all.
    [Theory]
    [InlineData(1945, " Rupees  One Thousand  Nine Hundred Forty Five Only")]
    [InlineData(2677, " Rupees  Two Thousand  Six Hundred Seventy Seven Only")]
    [InlineData(16057, " Rupees Sixteen Thousand Fifty Seven Only")]
    [InlineData(26996, " Rupees Twenty Six Thousand  Nine Hundred Ninety Six Only")]
    [InlineData(54616, " Rupees Fifty Four Thousand  Six Hundred Sixteen Only")]
    [InlineData(188897, " Rupees  One Lakh Eighty Eight Thousand  Eight Hundred Ninety Seven Only")]
    [InlineData(197506, " Rupees  One Lakh Ninety Seven Thousand  Five Hundred  Six Only")]
    [InlineData(6037, " Rupees  Six Thousand Thirty Seven Only")]
    [InlineData(7070, " Rupees  Seven Thousand Seventy Only")]
    [InlineData(9005, " Rupees  Nine Thousand  Five Only")]
    public void Matches_the_Excel_macro_exactly(long total, string excel) => Assert.Equal(excel, RupeeWords.Format(total));

    [Theory]
    [InlineData(0, "No Rupees Only")]
    [InlineData(5, " Rupees  Five Only")]
    [InlineData(10, " Rupees Ten Only")]
    [InlineData(100, " Rupees  One Hundred  Only")]
    [InlineData(181071, " Rupees  One Lakh Eighty One Thousand Seventy One Only")]
    [InlineData(1000000, " Rupees Ten Lakh  Only")]
    public void Edge_amounts(long total, string expected) => Assert.Equal(expected, RupeeWords.Format(total));
}

public sealed class GstinTests
{
    [Theory]
    [InlineData("08TESTF9001J1ZJ", true)]
    [InlineData("08TESTF4321J1ZM", true)]
    [InlineData("08TESTY2468M1ZL", true)]
    [InlineData("08TESTK5678S1ZD", true)]
    [InlineData("0808TESTY2468M1ZL", false)]
    [InlineData("08TESTA12341ZU", false)]
    [InlineData("O8TESTK5678S1ZD", false)]
    [InlineData("08ABCDE1234F1ZX", false)]
    [InlineData("", false)]
    public void Checks_format_and_check_character(string gstin, bool valid) => Assert.Equal(valid, Gstin.IsValid(gstin));

    [Fact]
    public void Clean_removes_spaces_and_upper_cases() => Assert.Equal("08TESTF9001J1ZJ", Gstin.Clean(" 08testf 9001j1zj "));
}

public sealed class MoneyAndDateTests
{
    [Theory]
    [InlineData(2.5, 3)]
    [InlineData(-2.5, -3)]
    [InlineData(472.9, 473)]
    [InlineData(472.49, 472)]
    public void Rounds_halves_away_from_zero_like_Excel(double value, long expected) => Assert.Equal(expected, Money.RoundRupee((decimal)value));

    [Theory]
    [InlineData("2026-04-01", "26-27")]
    [InlineData("2027-03-31", "26-27")]
    [InlineData("2027-04-01", "27-28")]
    public void Financial_year_runs_april_to_march(string date, string fy) => Assert.Equal(fy, FinancialYear.Of(DateOnly.Parse(date, System.Globalization.CultureInfo.InvariantCulture)));

    [Fact]
    public void Natural_order_puts_9_before_10_and_numbers_first()
    {
        var sorted = new[] { "10", "9", "A1", "100", "2,3" }.Order(NaturalComparer.Instance).ToArray();
        Assert.Equal(["2,3", "9", "10", "100", "A1"], sorted);
    }
}

public sealed class IndianNumberTests
{
    [Theory]
    [InlineData(0, "0")]
    [InlineData(999, "999")]
    [InlineData(1000, "1,000")]
    [InlineData(99999, "99,999")]
    [InlineData(100000, "1,00,000")]
    [InlineData(1234567, "12,34,567")]
    [InlineData(123456789, "12,34,56,789")]
    [InlineData(-200000, "-2,00,000")]
    public void Groups_thousands_then_lakhs_and_crores(long value, string expected) => Assert.Equal(expected, IndianNumbers.Format(value));

    [Theory]
    [InlineData(137757, 2, "1,37,757.00")]
    [InlineData(0.005, 2, "0.01")]
    [InlineData(-0.004, 2, "0.00")]
    [InlineData(1234.5, 0, "1,235")]
    public void Decimals_are_rounded_half_away_from_zero(double value, int decimals, string expected) =>
        Assert.Equal(expected, IndianNumbers.Format((decimal)value, decimals));

    [Fact]
    public void Rupees_get_the_rupee_sign() => Assert.Equal("₹2,00,000", IndianNumbers.Rupees(200000));
}

public sealed class SignatureImageTests
{
    private static readonly byte[] Png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");

    [Fact]
    public void Png_and_jpeg_round_trip_through_a_data_url()
    {
        var url = SignatureImage.Encode(Png);
        Assert.StartsWith("data:image/png;base64,", url, StringComparison.Ordinal);
        Assert.True(SignatureImage.TryDecode(url, out var back, out var type));
        Assert.Equal(Png, back);
        Assert.Equal("image/png", type);
        Assert.Equal("image/jpeg", SignatureImage.ContentType(new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("data:image/png;base64,???")]
    [InlineData("data:image/png,iVBORw0KGgo=")]
    [InlineData("data:image/png;base64,R0lGODlhAQABAAAAACw=")]
    public void Anything_else_is_not_a_signature(string? url) => Assert.False(SignatureImage.TryDecode(url, out _, out _));

    [Fact]
    public void Encoding_something_that_is_not_a_picture_is_refused() =>
        Assert.Throws<ArgumentException>(() => SignatureImage.Encode([1, 2, 3]));
}

public sealed class BillFileNameTests
{
    [Theory]
    [InlineData("Sharma Textiles", "2026-04-10", "MPH\\26-27\\12", 0, "Sharma_Textiles_26-27_Apr_Job12.pdf")]
    [InlineData("Sharma Textiles", "2027-03-31", "MPH/26-27/7", 0, "Sharma_Textiles_26-27_Mar_Job7.pdf")]
    [InlineData("A/B: \"Co.\"  Ltd", "2026-11-02", "5", 2, "AB_Co._Ltd_26-27_Nov_Job5_and_2_more.pdf")]
    [InlineData("", "2026-05-01", null, 0, "party_26-27_May_Job.pdf")]
    public void Is_party_financial_year_month_and_job_number(string party, string date, string? number, int more, string expected) =>
        Assert.Equal(expected, BillFileName.Of(party, DateOnly.Parse(date, System.Globalization.CultureInfo.InvariantCulture), number, more));
}
