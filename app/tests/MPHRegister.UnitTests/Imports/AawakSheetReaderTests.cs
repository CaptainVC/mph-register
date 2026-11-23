using MPHRegister.Services.Imports.Aawak;
using MPHRegister.UnitTests.TestSupport;

namespace MPHRegister.UnitTests.Imports;

public sealed class AawakSheetReaderTests : IDisposable
{
    private readonly TempFolder folder = Make.Folder();

    public void Dispose() => folder.Dispose();

    [Fact]
    public void Reads_the_rows_and_skips_the_last_row_that_holds_only_a_number_and_a_date()
    {
        var path = AawakWorkbook.Write(folder.File("AAWAK--NOV.-26-27.xlsx"),
        [
            new("1", 11, "2026-11-01", "AW PARTY", 72, "LORRY ONE", "11-13"),
            new("2", 14, "2026-11-01", "AW OTHER", 40, "LORRY TWO"),
            new("2A", 15, "2026-11-02", "AW PARTY", 5, "LORRY ONE", "CARRIER"),
        ],
        [("AW PARTY", true, "AW GROUP"), ("AW OTHER", false, "")],
        [("LORRY ONE", true), ("LORRY TWO", false)]);

        var sheet = AawakSheetReader.Read(path);

        Assert.Empty(sheet.Errors);
        Assert.Empty(sheet.Warnings);
        Assert.Equal(["1", "2", "2A"], sheet.Rows.Select(r => r.Key));
        var first = sheet.Rows[0];
        Assert.Equal((11, "2026-11-01", "AW PARTY", 72, "LORRY ONE", "11-13"), (first.InwardNo, first.Date, first.Party, first.Nag, first.Transporter, first.Comments));
        Assert.Equal((2, "A"), (sheet.Rows[2].Number, sheet.Rows[2].Suffix));
        Assert.Equal((true, "AW GROUP"), sheet.Details.Parties["AW PARTY"]);
        Assert.Equal((false, ""), sheet.Details.Parties["AW OTHER"]);
        Assert.False(sheet.Details.Transporters["LORRY TWO"]);
    }

    [Fact]
    public void A_repeated_AAWAK_NO_and_a_bad_NAG_are_errors()
    {
        var path = AawakWorkbook.Write(folder.File("bad.xlsx"),
        [
            new("1", 11, "2026-11-01", "AW PARTY", 72, "LORRY ONE"),
            new("1", 12, "2026-11-01", "AW PARTY", 10, "LORRY ONE"),
            new("2", 13, "2026-11-01", "AW PARTY", 0, "LORRY ONE"),
        ]);

        var errors = AawakSheetReader.Read(path).Errors.Select(e => e.Message).ToList();

        Assert.Contains(errors, e => e.Contains("AAWAK NO 1 is on rows 2, 3", StringComparison.Ordinal));
        Assert.Contains(errors, e => e.Contains("NAG must be 1 or more", StringComparison.Ordinal));
    }

    [Fact]
    public void Another_workbook_is_refused() =>
        Assert.Contains("Missing columns", AawakSheetReader.Read(InwardWorkbook.Write(folder.File("inward.xlsx"), [new SheetRow(1, "2026-11-01", "AW PARTY")])).Errors[0].Message, StringComparison.Ordinal);
}
