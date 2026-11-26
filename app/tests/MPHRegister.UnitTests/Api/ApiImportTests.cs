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
        using var connection = TestDb.Open(factory.DataDirectory);
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
    public async Task A_NETT_THAN_typed_over_the_formula_is_what_is_charged_and_stays_so_through_edits_deletes_and_imports()
    {
        var app = await Ready();
        // "1 than bina finish": THAN 24 came in, but NETT THAN was typed as 23 (INW. NO. 206 of the November 2026 register).
        var typed = new SheetRow(1, "2027-12-01", "IMP PARTY", "299 (1than bina finish)", "12205", Than: 24) { Nett = 23 };
        var plain = new SheetRow(2, "2027-12-01", "IMP PARTY", "300", "12205", Than: 24);
        var report = await Import(app, Workbook("dec-nett-1", [typed, plain]), "2027-12", commit: true);
        Assert.Equal((48, 47), (report.GetProperty("than").GetInt32(), report.GetProperty("nettThan").GetInt32()));
        Assert.Contains("Sheet NETT THAN is 23, not THAN (24); saved as 23 charged.", Messages(report, "warnings"));

        var saved = await Month(app, "2027-12");
        Assert.Equal((24, 23, 24), (Inward(saved, 1).GetProperty("than").GetInt32(), Inward(saved, 1).GetProperty("nettThan").GetInt32(), Inward(saved, 2).GetProperty("nettThan").GetInt32()));
        var candidates = await app.Get("/api/billing/candidates?party=IMP%20PARTY&from=2027-12-01&to=2027-12-31").Ok();
        // December's own slips (the other tests' earlier IMP PARTY slips still in stock come along too, marked as from stock).
        Assert.Equal([23, 24], candidates.GetProperty("entries").EnumerateArray().Where(e => !e.GetProperty("fromStock").GetBoolean())
            .OrderBy(e => e.GetProperty("inwardNo").GetInt32()).Select(e => e.GetProperty("nettThan").GetInt32()));

        // Correcting the entry in the Register does not lose it.
        var id = Inward(saved, 1).GetProperty("id").GetInt64();
        var edited = await app.Put($"/api/entries/{id}", Edit(Inward(saved, 1), lotNo: "12205X")).Ok();
        Assert.Equal(23, edited.GetProperty("nettThan").GetInt32());

        // Deleting and restoring it does not either.
        await app.Delete($"/api/entries/{id}").Ok();
        var restored = await app.Post($"/api/entries/deleted/{id}/restore", new { }).Ok();
        Assert.Equal(23, restored.GetProperty("nettThan").GetInt32());

        // The same workbook again changes nothing.
        Assert.True((await Import(app, Workbook("dec-nett-2", [typed, plain], salt: "again"), "2027-12", commit: true)).GetProperty("upToDate").GetBoolean());

        // The workbook's NETT THAN is changed: the import takes it, and says so in the entry's history.
        var changed = await Import(app, Workbook("dec-nett-3", [typed with { Nett = 22, Lot = "12205X" }, plain]), "2027-12", commit: true);
        Assert.Equal(["INW. NO. 1 of 2027-12-01 (IMP PARTY): NETT THAN 23 → 22."], Messages(changed, "changes"));
        Assert.Equal(22, Inward(await Month(app, "2027-12"), 1).GetProperty("nettThan").GetInt32());
        Assert.Equal(["NETT THAN 23 → 22"], Fields((await Events(app, id))[0].GetProperty("details"), "effects"));

        // And back to the formula's figure.
        await Import(app, Workbook("dec-nett-4", [typed with { Nett = null, Lot = "12205X" }, plain]), "2027-12", commit: true);
        Assert.Equal(24, Inward(await Month(app, "2027-12"), 1).GetProperty("nettThan").GetInt32());
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

    private static (string? Action, string? Changes, string? Month) Mark(JsonElement entry) =>
        entry.GetProperty("lastImport") is { ValueKind: JsonValueKind.Object } mark
            ? (mark.GetProperty("action").GetString(), mark.GetProperty("changes").GetString(), mark.GetProperty("registerMonth").GetString())
            : (null, null, null);

    [Fact]
    public async Task An_import_lists_and_remembers_which_entries_it_added_and_which_it_updated()
    {
        var app = await Ready();
        SheetRow[] first = [new(1, "2025-04-01", "IMP PARTY", "D1", "L1"), new(2, "2025-04-01", "IMP PARTY", "D2"), new(3, "2025-04-02", "IMP OTHER", "D3")];
        var report = await Import(app, Workbook("apr25-1", first), "2025-04", commit: false);
        Assert.Equal(
        [
            "INW. NO. 1 of 2025-04-01 (IMP PARTY): D.N. D1, LOT N. L1, THAN 10, FINISH F1.",
            "INW. NO. 2 of 2025-04-01 (IMP PARTY): D.N. D2, THAN 10, FINISH F1.",
            "INW. NO. 3 of 2025-04-02 (IMP OTHER): D.N. D3, THAN 10, FINISH F1.",
        ], Messages(report, "added"));
        Assert.Empty(await Month(app, "2025-04"));
        await Import(app, Workbook("apr25-1", first), "2025-04", commit: true);
        Assert.All(await Month(app, "2025-04"), e => Assert.Equal(("added", "", "2025-04"), Mark(e)));

        SheetRow[] second =
        [
            first[0],
            first[1] with { Than = 15 },
            first[2] with { Lot = "L3", Dispatches = [(4, "G3", "2025-04-05")] },
            new SheetRow(4, "2025-04-03", "IMP PARTY", "D4", Than: 11, TwoPart: 1).Sent((2, "G4", "2025-04-04")),
        ];
        var path = Workbook("apr25-2", second);
        var check = await Import(app, path, "2025-04", commit: false);
        Assert.Equal(["INW. NO. 4 of 2025-04-03 (IMP PARTY): D.N. D4, THAN 11, TWO PART 1, FINISH F1, 1 dispatch."], Messages(check, "added"));
        Assert.Equal(
        [
            "INW. NO. 2 of 2025-04-01 (IMP PARTY): THAN 10 → 15.",
            "INW. NO. 3 of 2025-04-02 (IMP OTHER): LOT N. filled in (L3); 1 later dispatch(es) added.",
        ], Messages(check, "changes"));
        Assert.All(await Month(app, "2025-04"), e => Assert.Equal("added", Mark(e).Action));

        var done = await Import(app, path, "2025-04", commit: true);
        Assert.Equal((1, 2), (Messages(done, "added").Count, Messages(done, "changes").Count));
        var entries = await Month(app, "2025-04");
        Assert.Equal((null, null, null), Mark(Inward(entries, 1)));
        Assert.Equal(("updated", "THAN 10 → 15", "2025-04"), Mark(Inward(entries, 2)));
        Assert.Equal(("updated", "LOT N. filled in (L3); 1 later dispatch(es) added", "2025-04"), Mark(Inward(entries, 3)));
        Assert.Equal(("added", "", "2025-04"), Mark(Inward(entries, 4)));
        Assert.Equal("apr25-2.xlsx", Inward(entries, 4).GetProperty("lastImport").GetProperty("fileName").GetString());

        // A copy with nothing new is not imported, so it leaves the marks as they are; an edit in the app keeps them too.
        Assert.True((await Import(app, Workbook("apr25-3", second, salt: "again"), "2025-04", commit: true)).GetProperty("upToDate").GetBoolean());
        await app.Put($"/api/entries/{Inward(entries, 4).GetProperty("id").GetInt64()}", Edit(Inward(entries, 4), lotNo: "APP")).Ok();
        Assert.Equal("added", Mark(Inward(await Month(app, "2025-04"), 4)).Action);

        // The next import that changes something shows only what it did.
        await Import(app, Workbook("apr25-4", [.. second, new SheetRow(5, "2025-04-06", "IMP PARTY", "D5")]), "2025-04", commit: true);
        var latest = await Month(app, "2025-04");
        Assert.Equal([5], latest.Where(e => Mark(e).Action is not null).Select(e => e.GetProperty("inwardNo").GetInt32()));
        Assert.Equal("added", Mark(Inward(latest, 5)).Action);
    }

    [Fact]
    public async Task Carryover_rows_that_change_another_months_entry_count_as_updates()
    {
        var app = await Ready();
        var june = new SheetRow(60, "2025-06-10", "IMP PARTY", "D60");
        await Import(app, Workbook("jun25-1", [june]), "2025-06", commit: true);
        var july = await Import(app, Workbook("jul25-1", [new(1, "2025-07-01", "IMP OTHER", "J1"), null, june with { Lot = "L60" }]), "2025-07", commit: true);
        Assert.Equal(["INW. NO. 1 of 2025-07-01 (IMP OTHER): D.N. J1, THAN 10, FINISH F1."], Messages(july, "added"));
        Assert.Equal(["INW. NO. 60 of 2025-06-10 (IMP PARTY), 2025-06 register: LOT N. filled in (L60)."], Messages(july, "changes"));
        Assert.Equal((0, 1), (july.GetProperty("updatedEntries").GetInt32(), july.GetProperty("otherMonthUpdates").GetInt32()));
        Assert.Equal(("updated", "LOT N. filled in (L60)", "2025-07"), Mark(Inward(await Month(app, "2025-06"), 60)));

        // A later month's carryover adopted by its own month moves there: an update, not a new entry.
        var august = new SheetRow(80, "2025-08-10", "IMP PARTY", "D80");
        await Import(app, Workbook("sep25-1", [new(1, "2025-09-01", "IMP OTHER", "S1"), null, august]), "2025-09", commit: true);
        var adopted = await Import(app, Workbook("aug25-1", [august]), "2025-08", commit: true);
        Assert.Empty(Messages(adopted, "added"));
        Assert.Equal(["INW. NO. 80 of 2025-08-10 (IMP PARTY): moved here from the 2025-09 register."], Messages(adopted, "changes"));
        Assert.Equal(1, adopted.GetProperty("otherMonthUpdates").GetInt32());
        Assert.Equal(("updated", "moved here from the 2025-09 register", "2025-08"), Mark(Inward(await Month(app, "2025-08"), 80)));
    }

    private static async Task<List<JsonElement>> Events(HttpClient app, long entryId) =>
        (await app.Get($"/api/entries/{entryId}/import-history").Ok()).GetProperty("events").EnumerateArray().ToList();

    private static List<string> Fields(JsonElement details, string list) =>
        details.GetProperty(list).EnumerateArray().Select(f => $"{f.GetProperty("field").GetString()} {f.GetProperty("was").GetString()} → {f.GetProperty("now").GetString()}").ToList();

    [Fact]
    public async Task An_entry_keeps_the_import_that_added_it_and_only_the_latest_that_updated_it()
    {
        var app = await Ready();
        SheetRow row1 = new(1, "2027-10-01", "IMP PARTY", "D1", "L1");
        SheetRow row2 = new(2, "2027-10-01", "IMP PARTY", "D2");
        await Import(app, Workbook("oct27-1", [row1, row2]), "2027-10", commit: true);
        var saved = await Month(app, "2027-10");
        var (id1, id2) = (Inward(saved, 1).GetProperty("id").GetInt64(), Inward(saved, 2).GetProperty("id").GetInt64());
        Assert.All(saved, e => Assert.NotEqual(JsonValueKind.String, e.GetProperty("importUpdatedAt").ValueKind));
        var added = Assert.Single(await Events(app, id1));
        Assert.Equal(("added", "oct27-1.xlsx", JsonValueKind.Null), (added.GetProperty("action").GetString(), added.GetProperty("fileName").GetString(), added.GetProperty("details").ValueKind));

        // The second import changes entry 1: THAN and a dispatch, so NAG, NETT THAN and BALANCE follow.
        await Import(app, Workbook("oct27-2", [(row1 with { Than = 15 }).Sent((15, "G1", "2027-10-02")), row2]), "2027-10", commit: true);
        saved = await Month(app, "2027-10");
        Assert.Equal(JsonValueKind.String, Inward(saved, 1).GetProperty("importUpdatedAt").ValueKind);
        Assert.NotEqual(JsonValueKind.String, Inward(saved, 2).GetProperty("importUpdatedAt").ValueKind);
        var events = await Events(app, id1);
        Assert.Equal(["updated", "added"], events.Select(e => e.GetProperty("action").GetString()));
        Assert.Equal(["oct27-2.xlsx", "oct27-1.xlsx"], events.Select(e => e.GetProperty("fileName").GetString()));
        var details = events[0].GetProperty("details");
        Assert.Equal(["THAN 10 → 15"], Fields(details, "fields"));
        Assert.Equal(["NAG 10 → 15", "NETT THAN 10 → 15", "BALANCE 10 → 0"], Fields(details, "effects"));
        var dispatch = Assert.Single(details.GetProperty("dispatches").EnumerateArray());
        Assert.Equal((1, JsonValueKind.Null, 15, "G1"), (dispatch.GetProperty("number").GetInt32(), dispatch.GetProperty("was").ValueKind, dispatch.GetProperty("now").GetProperty("qty").GetInt32(), dispatch.GetProperty("now").GetProperty("gatePass").GetString()));
        Assert.Single(await Events(app, id2));

        // The third import changes entry 1 again: the second update is replaced, the adding import stays.
        var third = (row1 with { Than = 20 }).Sent((20, "G1", "2027-10-02"));
        await Import(app, Workbook("oct27-3", [third, row2]), "2027-10", commit: true);
        events = await Events(app, id1);
        Assert.Equal(["oct27-3.xlsx", "oct27-1.xlsx"], events.Select(e => e.GetProperty("fileName").GetString()));
        Assert.Equal(["THAN 15 → 20"], Fields(events[0].GetProperty("details"), "fields"));
        await using (var connection = TestDb.Open(factory.DataDirectory))
            Assert.Equal(2, await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM import_batch_entries WHERE entry_id = @id1;", new { id1 }));

        // An import that leaves the entry alone, or finds nothing to change, leaves its history as it is.
        Assert.True((await Import(app, Workbook("oct27-4", [third, row2], salt: "again"), "2027-10", commit: true)).GetProperty("upToDate").GetBoolean());
        await Import(app, Workbook("oct27-5", [third, row2 with { Lot = "L2" }]), "2027-10", commit: true);
        Assert.Equal(["oct27-3.xlsx", "oct27-1.xlsx"], (await Events(app, id1)).Select(e => e.GetProperty("fileName").GetString()));
        Assert.Equal(["oct27-5.xlsx", "oct27-1.xlsx"], (await Events(app, id2)).Select(e => e.GetProperty("fileName").GetString()));
        Assert.Equal(["LOT N.  → L2"], Fields((await Events(app, id2))[0].GetProperty("details"), "fields"));
        await app.Get("/api/entries/999999/import-history").Refused(System.Net.HttpStatusCode.NotFound);
    }
}
