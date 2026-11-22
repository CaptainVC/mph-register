using System.Text.Json;
using Dapper;
using Microsoft.Data.Sqlite;
using MPHRegister.UnitTests.TestSupport;

namespace MPHRegister.UnitTests.Api;

/// <summary>Importing a month that is already in the app, with made-up workbooks written by the test.</summary>
[Collection("api")]
public sealed class ApiImportTests(ApiFactory factory) : IClassFixture<ApiFactory>, IDisposable
{
    private readonly TempFolder folder = Make.Folder();

    public void Dispose() => folder.Dispose();

    private async Task<HttpClient> Ready()
    {
        var app = factory.App();
        if (factory.ConfigOnDisk.Finishes.Count != 0) return app;
        await Setup.Basics(app);
        foreach (var party in new[] { "IMP PARTY", "IMP OTHER" }) await app.Post("/api/masters/party", Setup.Party(party)).Ok();
        return app;
    }

    private string Workbook(string name, IEnumerable<SheetRow?> rows, string salt = "") => InwardWorkbook.Write(folder.File($"{name}.xlsx"), rows, salt);

    private static async Task<JsonElement> Import(HttpClient app, string path, string month, bool commit)
    {
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(await File.ReadAllBytesAsync(path)), "file", Path.GetFileName(path));
        form.Add(new StringContent(month), "month");
        form.Add(new StringContent(commit ? "true" : "false"), "commit");
        return await app.PostAsync(new Uri("/api/import", UriKind.Relative), form).Ok();
    }

    private static async Task<List<JsonElement>> Month(HttpClient app, string month) =>
        (await app.Get($"/api/entries?month={month}").Ok()).EnumerateArray().ToList();

    private static JsonElement Inward(List<JsonElement> entries, int inwardNo) => entries.Single(e => e.GetProperty("inwardNo").GetInt32() == inwardNo);

    private static List<string> Messages(JsonElement report, string list) =>
        report.GetProperty(list).EnumerateArray().Select(i => i.GetProperty("message").GetString()!).ToList();

    private static object Edit(JsonElement entry, string? lotNo = null, int? than = null) => new
    {
        registerMonth = entry.GetProperty("registerMonth").GetString(), inwardNo = entry.GetProperty("inwardNo").GetInt32(),
        entryDate = entry.GetProperty("entryDate").GetString(), party = entry.GetProperty("party").GetString(),
        designNo = entry.GetProperty("designNo").GetString(), lotNo = lotNo ?? entry.GetProperty("lotNo").GetString(), repair = false,
        than = than ?? entry.GetProperty("than").GetInt32(), tp = 0, twoPart = 0, finish = entry.GetProperty("finish").GetString(),
        dispatches = entry.GetProperty("dispatches").EnumerateArray().Select(d => new { qty = d.GetProperty("qty").GetInt32(), gatePass = d.GetProperty("gatePass").GetString(), date = d.GetProperty("date").GetString() }),
    };

    private void Sql(string sql)
    {
        using var connection = new SqliteConnection($"Data Source={Path.Combine(factory.DataDirectory, "mph-data.db")};Pooling=False");
        connection.Open();
        connection.Execute(sql);
    }

    [Fact]
    public async Task Importing_a_month_again_adds_updates_keeps_app_edits_and_removes()
    {
        var app = await Ready();
        SheetRow[] first =
        [
            new(1, "2026-04-01", "IMP PARTY", "D1", "L1", 10) { Dispatches = [(10, "G1", "2026-04-02")] },
            new(2, "2026-04-01", "IMP PARTY", "D2", Than: 12, Finish: ""),
            new SheetRow(3, "2026-04-02", "IMP PARTY", "D3", Than: 8).Sent((5, "G3", "2026-04-03")),
            new(4, "2026-04-02", "IMP OTHER", "D4", Than: 6, Finish: "F2"),
            new(5, "2026-04-03", "IMP PARTY", "D5", "L5", 7),
            new(6, "2026-04-03", "IMP PARTY", "D6", Than: 9),
        ];
        var report = await Import(app, Workbook("apr-1", first), "2026-04", commit: true);
        Assert.True(report.GetProperty("imported").GetBoolean());
        Assert.Equal((6, 0), (report.GetProperty("entries").GetInt32(), report.GetProperty("savedEntries").GetInt32()));
        var saved = await Month(app, "2026-04");
        await app.Put($"/api/entries/{Inward(saved, 5).GetProperty("id").GetInt64()}", Edit(Inward(saved, 5), lotNo: "L5X")).Ok();
        await app.Put($"/api/entries/{Inward(saved, 6).GetProperty("id").GetInt64()}", Edit(Inward(saved, 6), than: 19)).Ok();

        SheetRow[] second =
        [
            first[0],
            first[1] with { Finish = "F2", Dispatches = [(12, "G2", "2026-04-05")] },
            first[2].Sent((5, "G3", "2026-04-03"), (3, "G33", "2026-04-06")),
            first[4] with { Dn = "D5B" },
            first[5] with { Than = 29 },
            new(7, "2026-04-04", "IMP PARTY", "D7", Than: 11),
        ];
        var path = Workbook("apr-2", second);
        var check = await Import(app, path, "2026-04", commit: false);
        Assert.Empty(check.GetProperty("errors").EnumerateArray());
        Assert.False(check.GetProperty("imported").GetBoolean());
        Assert.Equal((6, 1, 3, 2, 1, false), (check.GetProperty("savedEntries").GetInt32(), check.GetProperty("entries").GetInt32(),
            check.GetProperty("updatedEntries").GetInt32(), check.GetProperty("unchangedEntries").GetInt32(), check.GetProperty("removedEntries").GetInt32(),
            check.GetProperty("upToDate").GetBoolean()));
        Assert.Equal(
        [
            "INW. NO. 2 of 2026-04-01 (IMP PARTY): FINISH filled in (F2); 1 later dispatch(es) added.",
            "INW. NO. 3 of 2026-04-02 (IMP PARTY): 1 later dispatch(es) added.",
            "INW. NO. 5 of 2026-04-03 (IMP PARTY): D.N. D5 → D5B.",
        ], Messages(check, "changes"));
        Assert.Equal(["INW. NO. 6 of 2026-04-03 (IMP PARTY): THAN 19 (workbook: 29)."], Messages(check, "kept"));
        Assert.Equal(["INW. NO. 4 of 2026-04-02 (IMP OTHER) will be removed."], Messages(check, "notInWorkbook"));
        Assert.Equal(6, (await Month(app, "2026-04")).Count);

        var done = await Import(app, path, "2026-04", commit: true);
        Assert.True(done.GetProperty("imported").GetBoolean());
        Assert.Equal(["INW. NO. 4 of 2026-04-02 (IMP OTHER) was removed."], Messages(done, "notInWorkbook"));
        var after = await Month(app, "2026-04");
        Assert.Equal([1, 2, 3, 5, 6, 7], after.Select(e => e.GetProperty("inwardNo").GetInt32()).Order());
        foreach (var inward in new[] { 1, 2, 3, 5, 6 })
            Assert.Equal(Inward(saved, inward).GetProperty("id").GetInt64(), Inward(after, inward).GetProperty("id").GetInt64());
        Assert.Equal(("F2", 1), (Inward(after, 2).GetProperty("finish").GetString(), Inward(after, 2).GetProperty("dispatches").GetArrayLength()));
        Assert.Equal(2, Inward(after, 3).GetProperty("dispatches").GetArrayLength());
        Assert.Equal(("D5B", "L5X"), (Inward(after, 5).GetProperty("designNo").GetString(), Inward(after, 5).GetProperty("lotNo").GetString()));
        Assert.Equal(19, Inward(after, 6).GetProperty("than").GetInt32());
        Assert.Equal(7, Inward(after, 7).GetProperty("sourceRow").GetInt32());

        var again = await Import(app, path, "2026-04", commit: false);
        Assert.Contains(Messages(again, "errors"), e => e.StartsWith("This exact file was already imported", StringComparison.Ordinal));
        var same = await Import(app, Workbook("apr-3", second, salt: "saved again"), "2026-04", commit: true);
        Assert.Empty(same.GetProperty("errors").EnumerateArray());
        Assert.True(same.GetProperty("upToDate").GetBoolean());
        Assert.False(same.GetProperty("imported").GetBoolean());
        Assert.Empty(Messages(same, "changes"));
    }

    [Fact]
    public async Task An_update_never_removes_a_billed_entry()
    {
        var app = await Ready();
        SheetRow[] first = [new(1, "2026-05-01", "IMP PARTY", "D1"), new(2, "2026-05-01", "IMP PARTY", "D2")];
        await Import(app, Workbook("may-1", first), "2026-05", commit: true);
        var billed = Inward(await Month(app, "2026-05"), 2).GetProperty("id").GetInt64();
        await app.Post("/api/billing/elsewhere", new { entryIds = new[] { billed }, note = "Billed in Excel", undo = false }).Ok();

        var report = await Import(app, Workbook("may-2", [first[0] with { Lot = "L1" }]), "2026-05", commit: true);
        Assert.False(report.GetProperty("imported").GetBoolean());
        Assert.Equal(
            ["INW. NO. 2 of 2026-05-01 (IMP PARTY) is marked as billed outside the app but is not in this workbook. Put the row back in the workbook, or undo the mark first."],
            Messages(report, "errors"));
        var entries = await Month(app, "2026-05");
        Assert.Equal(2, entries.Count);
        Assert.Equal("", Inward(entries, 1).GetProperty("lotNo").GetString());
    }

    [Fact]
    public async Task Entries_typed_in_the_app_are_matched_and_never_removed()
    {
        var app = await Ready();
        await app.Post("/api/entries", Setup.Entry(1, "IMP PARTY", dn: "D1", month: "2026-06")).Ok();
        await app.Post("/api/entries", Setup.Entry(2, "IMP PARTY", dn: "D2", month: "2026-06")).Ok();

        SheetRow[] rows = [new SheetRow(1, "2026-06-02", "IMP PARTY", "D1", "L1").Sent((10, "G1", "2026-06-03")), new(3, "2026-06-04", "IMP OTHER", "D3")];
        var report = await Import(app, Workbook("jun-1", rows), "2026-06", commit: true);
        Assert.True(report.GetProperty("imported").GetBoolean());
        Assert.Equal((2, 1, 1, 0), (report.GetProperty("savedEntries").GetInt32(), report.GetProperty("entries").GetInt32(),
            report.GetProperty("updatedEntries").GetInt32(), report.GetProperty("removedEntries").GetInt32()));
        Assert.Equal(["INW. NO. 1 of 2026-06-02 (IMP PARTY): LOT N. filled in (L1)."], Messages(report, "changes"));
        Assert.Equal(["INW. NO. 2 of 2026-06-02 (IMP PARTY) was entered in the app; it stays."], Messages(report, "notInWorkbook"));
        var entries = await Month(app, "2026-06");
        Assert.Equal([1, 2, 3], entries.Select(e => e.GetProperty("inwardNo").GetInt32()).Order());
        Assert.Equal("L1", Inward(entries, 1).GetProperty("lotNo").GetString());
    }

    [Fact]
    public async Task Dispatches_a_later_month_added_survive_an_update()
    {
        var app = await Ready();
        var july = new SheetRow(1, "2026-07-20", "IMP PARTY", "D1").Sent((6, "G1", "2026-07-25"));
        await Import(app, Workbook("jul-1", [july]), "2026-07", commit: true);
        var august = await Import(app, Workbook("aug-1", [new SheetRow(1, "2026-08-01", "IMP OTHER", "D9"), null, july.Sent((6, "G1", "2026-07-25"), (4, "G2", "2026-08-02"))]), "2026-08", commit: true);
        Assert.Equal(1, august.GetProperty("mergedCarryovers").GetInt32());
        Assert.Equal(2, Inward(await Month(app, "2026-07"), 1).GetProperty("dispatches").GetArrayLength());

        var update = await Import(app, Workbook("jul-2", [july with { Finish = "F2" }]), "2026-07", commit: true);
        Assert.Equal(["INW. NO. 1 of 2026-07-20 (IMP PARTY): FINISH F1 → F2."], Messages(update, "changes"));
        var entry = Inward(await Month(app, "2026-07"), 1);
        Assert.Equal(("F2", 2), (entry.GetProperty("finish").GetString(), entry.GetProperty("dispatches").GetArrayLength()));
    }

    [Fact]
    public async Task Importing_a_month_again_does_not_undo_what_a_later_months_carryover_changed()
    {
        var app = await Ready();
        var slip = new SheetRow(930, "2026-10-21", "IMP PARTY", "D930", Than: 10, TwoPart: 1);
        await Import(app, Workbook("oct-1", [slip]), "2026-10", commit: true);
        var november = Workbook("nov-1", [new(1, "2026-11-01", "IMP OTHER", "N1"), null, slip with { TwoPart = 0 }]);
        await Import(app, november, "2026-11", commit: true);
        await Import(app, Workbook("dec-1", [new(1, "2026-12-01", "IMP OTHER", "X1"), null, slip with { TwoPart = 1 }]), "2026-12", commit: true);
        Assert.Equal(1, Inward(await Month(app, "2026-10"), 930).GetProperty("twoPart").GetInt32());

        var again = await Import(app, Workbook("nov-2", [new(1, "2026-11-01", "IMP OTHER", "N1"), null, slip with { TwoPart = 0 }], salt: "again"), "2026-11", commit: true);
        Assert.True(again.GetProperty("upToDate").GetBoolean());
        Assert.Equal(1, Inward(await Month(app, "2026-10"), 930).GetProperty("twoPart").GetInt32());

        var changed = await Import(app, Workbook("nov-3", [new(1, "2026-11-01", "IMP OTHER", "N1"), null, slip with { TwoPart = 0, Lot = "L930" }]), "2026-11", commit: true);
        Assert.Contains(changed.GetProperty("warnings").EnumerateArray(), w => w.GetProperty("message").GetString() == "INW. NO. 930 of 2026-10-21 updates the 2026-10 entry: LOT N. filled in (L930).");
        var entry = Inward(await Month(app, "2026-10"), 930);
        Assert.Equal((1, "L930"), (entry.GetProperty("twoPart").GetInt32(), entry.GetProperty("lotNo").GetString()));
    }

    [Fact]
    public async Task A_later_months_carryover_adopted_by_its_month_moves_there_once()
    {
        var app = await Ready();
        var slip = new SheetRow(40, "2027-02-10", "IMP PARTY", "D40", Finish: "");
        var later = Workbook("mar-1", [new(1, "2027-03-01", "IMP OTHER", "M1"), null, slip]);
        await Import(app, later, "2027-03", commit: true);
        Assert.Equal(2, (await Month(app, "2027-03")).Count);

        var adopted = await Import(app, Workbook("feb-1", [slip with { Finish = "F2" }]), "2027-02", commit: true);
        Assert.Equal((0, 1), (adopted.GetProperty("entries").GetInt32(), adopted.GetProperty("mergedCarryovers").GetInt32()));
        var february = await Month(app, "2027-02");
        Assert.Equal(("F2", false), (Inward(february, 40).GetProperty("finish").GetString(), Inward(february, 40).GetProperty("carriedOver").GetBoolean()));
        Assert.Equal([1], (await Month(app, "2027-03")).Select(e => e.GetProperty("inwardNo").GetInt32()));

        var again = await Import(app, Workbook("feb-2", [slip with { Finish = "F2" }], salt: "again"), "2027-02", commit: true);
        Assert.True(again.GetProperty("upToDate").GetBoolean());
        var laterAgain = await Import(app, Workbook("mar-2", [new(1, "2027-03-01", "IMP OTHER", "M1"), null, slip], salt: "again"), "2027-03", commit: true);
        Assert.True(laterAgain.GetProperty("upToDate").GetBoolean());
        Assert.Single(await Month(app, "2027-02"));
        Assert.Equal("F2", Inward(await Month(app, "2027-02"), 40).GetProperty("finish").GetString());
    }

    [Fact]
    public async Task A_carryover_row_still_finds_its_entry_after_the_entrys_number_was_corrected()
    {
        var app = await Ready();
        var slip = new SheetRow(5, "2027-04-02", "IMP PARTY", "D5", "L5").Sent((4, "G5", "2027-04-03"));
        await Import(app, Workbook("apr27-1", [slip]), "2027-04", commit: true);
        SheetRow?[] may = [new SheetRow(1, "2027-05-01", "IMP OTHER", "B1"), null, slip.Sent((4, "G5", "2027-04-03"), (6, "G6", "2027-05-02"))];
        await Import(app, Workbook("may27-1", may), "2027-05", commit: true);

        var corrected = await Import(app, Workbook("apr27-2", [slip with { InwardNo = 50 }]), "2027-04", commit: true);
        Assert.Equal(["INW. NO. 5 of 2027-04-02 (IMP PARTY): INW. NO. 5 → 50."], Messages(corrected, "changes"));

        var again = await Import(app, Workbook("may27-2", may, salt: "again"), "2027-05", commit: true);
        Assert.True(again.GetProperty("upToDate").GetBoolean());
        Assert.Equal([1], (await Month(app, "2027-05")).Select(e => e.GetProperty("inwardNo").GetInt32()));
        var entry = Inward(await Month(app, "2027-04"), 50);
        Assert.Equal(2, entry.GetProperty("dispatches").GetArrayLength());
    }

    [Fact]
    public async Task A_month_carrying_a_corrected_slip_for_the_first_time_finds_its_entry()
    {
        var app = await Ready();
        var slip = new SheetRow(709, "2027-07-10", "IMP PARTY", "D709", "L709").Sent((3, "G1", "2027-07-11"));
        await Import(app, Workbook("jul27-1", [slip]), "2027-07", commit: true);
        await Import(app, Workbook("aug27-1", [new(1, "2027-08-01", "IMP OTHER", "A1"), null, slip.Sent((3, "G1", "2027-07-11"), (2, "G2", "2027-08-02"))]), "2027-08", commit: true);
        var corrected = await Import(app, Workbook("jul27-2", [slip with { InwardNo = 790 }]), "2027-07", commit: true);
        Assert.Equal(["INW. NO. 709 of 2027-07-10 (IMP PARTY): INW. NO. 709 → 790."], Messages(corrected, "changes"));

        var september = await Import(app, Workbook("sep27-1", [new(1, "2027-09-01", "IMP OTHER", "S1"), null,
            slip.Sent((3, "G1", "2027-07-11"), (2, "G2", "2027-08-02"), (1, "G3", "2027-09-02"))]), "2027-09", commit: true);
        Assert.Equal((1, 1), (september.GetProperty("entries").GetInt32(), september.GetProperty("mergedCarryovers").GetInt32()));
        Assert.Equal([1], (await Month(app, "2027-09")).Select(e => e.GetProperty("inwardNo").GetInt32()));
        Assert.Equal(3, Inward(await Month(app, "2027-07"), 790).GetProperty("dispatches").GetArrayLength());
    }

    [Fact]
    public async Task An_R_lot_left_at_REP_No_is_imported_as_a_repair_that_is_not_charged()
    {
        var app = await Ready();
        // As INW. NO. 397 and 398 of ARNOLD TEXTILES in the November 2026 register: LOT N. R, REP. No, no finish.
        SheetRow[] rows =
        [
            new SheetRow(1, "2027-11-02", "IMP PARTY", "13761", "543").Sent((10, "G1", "2027-11-03")),
            new SheetRow(2, "2027-11-06", "IMP PARTY", "1079", "R", Than: 1, Finish: "").Sent((1, "G2", "2027-11-06")),
            new(3, "2027-11-06", "IMP PARTY", "1075", "R mix", Than: 6),
        ];
        var report = await Import(app, Workbook("nov-r", rows), "2027-11", commit: true);
        var warnings = report.GetProperty("warnings").EnumerateArray().Select(w => (w.GetProperty("row").GetInt32(), w.GetProperty("message").GetString())).ToList();
        Assert.Contains((3, "LOT N. or D.N. is marked R (repair) but REP. is No; saved as a repair (REP. Yes), which is not charged."), warnings);
        Assert.DoesNotContain(warnings, w => w.Item1 == 3 && w.Item2 != "LOT N. or D.N. is marked R (repair) but REP. is No; saved as a repair (REP. Yes), which is not charged.");
        Assert.Equal((17, 16), (report.GetProperty("than").GetInt32(), report.GetProperty("nettThan").GetInt32()));

        var entries = await Month(app, "2027-11");
        var repair = Inward(entries, 2);
        Assert.Equal((true, 0), (repair.GetProperty("repair").GetBoolean(), repair.GetProperty("nettThan").GetInt32()));
        Assert.Empty(repair.GetProperty("warnings").EnumerateArray());
        Assert.False(Inward(entries, 3).GetProperty("repair").GetBoolean());
        var candidates = await app.Get("/api/billing/candidates?party=IMP%20PARTY&from=2027-11-01&to=2027-11-30").Ok();
        Assert.Equal([1, 3], candidates.GetProperty("entries").EnumerateArray().Select(e => e.GetProperty("inwardNo").GetInt32()).Order());

        var again = await Import(app, Workbook("nov-r-2", rows, salt: "again"), "2027-11", commit: true);
        Assert.True(again.GetProperty("upToDate").GetBoolean());
        Assert.True(Inward(await Month(app, "2027-11"), 2).GetProperty("repair").GetBoolean());
    }

    [Fact]
    public async Task Rows_kept_from_before_the_R_rule_do_not_turn_a_users_REP_No_into_Yes()
    {
        var app = await Ready();
        SheetRow[] rows = [new(1, "2027-12-02", "IMP PARTY", "D1", "R", Than: 4), new(2, "2027-12-02", "IMP PARTY", "D2", "R 146", Than: 3), new(3, "2027-12-03", "IMP PARTY", "D3", "L3")];
        await Import(app, Workbook("dec-r", rows), "2027-12", commit: true);
        // 1: kept row says REP. No (imported before the rule) and the user set REP. back to No in the Register.
        Sql("UPDATE entries SET repair = 0, updated_at = '2099-01-01 10:00:00', source_values = json_set(source_values, '$.repair', json('false')) WHERE register_month = '2027-12' AND inward_no = 1;");
        // 2: imported before rows were kept and never edited (billed with REP. No, as July 2026 INW. NO. 66).
        Sql("UPDATE entries SET repair = 0, source_values = NULL, updated_at = created_at WHERE register_month = '2027-12' AND inward_no = 2;");

        var report = await Import(app, Workbook("dec-r-2", rows, salt: "again"), "2027-12", commit: true);
        Assert.Empty(Messages(report, "changes"));
        var entries = await Month(app, "2027-12");
        Assert.False(Inward(entries, 1).GetProperty("repair").GetBoolean());
        Assert.False(Inward(entries, 2).GetProperty("repair").GetBoolean());

        // The workbook drops the R of entry 2's repair twin: a saved repair with an unchanged kept row follows the workbook.
        Sql("UPDATE entries SET repair = 1 WHERE register_month = '2027-12' AND inward_no = 2;");
        var dropped = await Import(app, Workbook("dec-r-3", [rows[0], rows[1] with { Lot = "146" }, rows[2]]), "2027-12", commit: true);
        Assert.Contains("INW. NO. 2 of 2027-12-02 (IMP PARTY): LOT N. R 146 → 146; REP. YES → NO.", Messages(dropped, "changes"));
        Assert.False(Inward(await Month(app, "2027-12"), 2).GetProperty("repair").GetBoolean());
    }

    [Fact]
    public async Task Entries_imported_before_rows_were_kept_trust_only_untouched_values()
    {
        var app = await Ready();
        SheetRow[] first = [new(1, "2026-09-01", "IMP PARTY", "D1", "L1"), new(2, "2026-09-01", "IMP PARTY", "D2", "L2", Finish: ""), new(3, "2026-09-02", "IMP PARTY", "D3")];
        await Import(app, Workbook("sep-1", first), "2026-09", commit: true);
        Sql("UPDATE entries SET source_values = NULL, created_at = '2001-01-01 10:00:00', updated_at = '2001-01-01 10:00:00' WHERE register_month = '2026-09';");
        Sql("UPDATE entries SET lot_no = 'APP', updated_at = '2001-01-02 10:00:00' WHERE register_month = '2026-09' AND inward_no = 2;");
        // A later month imported in the second entry 3 was saved could have changed it without a trace.
        Sql("UPDATE entries SET created_at = '2001-01-03 10:00:00', updated_at = '2001-01-03 10:00:00' WHERE register_month = '2026-09' AND inward_no = 3;");
        Sql("INSERT INTO import_batches(file_name, sha256, register_month, imported_at, entry_count, dispatch_count) VALUES ('later.xlsm', 'LATER', '2027-01', '2001-01-03 10:00:00', 0, 0);");

        var report = await Import(app, Workbook("sep-2", [first[0] with { Than = 15 }, first[1] with { Lot = "L2B", Finish = "F1" }, first[2] with { Than = 12 }]), "2026-09", commit: true);
        Assert.True(report.GetProperty("imported").GetBoolean());
        Assert.Equal(
            ["INW. NO. 1 of 2026-09-01 (IMP PARTY): THAN 10 → 15.", "INW. NO. 2 of 2026-09-01 (IMP PARTY): FINISH filled in (F1)."],
            Messages(report, "changes"));
        Assert.Equal(["INW. NO. 2 of 2026-09-01 (IMP PARTY): LOT N. APP (workbook: L2B).", "INW. NO. 3 of 2026-09-02 (IMP PARTY): THAN 10 (workbook: 12)."], Messages(report, "kept"));
        var entries = await Month(app, "2026-09");
        Assert.Equal(15, Inward(entries, 1).GetProperty("than").GetInt32());
        Assert.Equal(("APP", "F1"), (Inward(entries, 2).GetProperty("lotNo").GetString(), Inward(entries, 2).GetProperty("finish").GetString()));
        Assert.Equal(10, Inward(entries, 3).GetProperty("than").GetInt32());
    }
}
