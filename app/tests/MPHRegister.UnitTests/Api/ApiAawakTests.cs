using System.Net;
using System.Text.Json;
using MPHRegister.UnitTests.TestSupport;

namespace MPHRegister.UnitTests.Api;

[Collection("api")]
public sealed class ApiAawakTests(ApiFactory factory) : IClassFixture<ApiFactory>, IDisposable
{
    private readonly TempFolder folder = Make.Folder();

    public void Dispose() => folder.Dispose();

    private async Task<HttpClient> Ready()
    {
        var app = factory.App();
        if (factory.ConfigOnDisk.Finishes.Count != 0) return app;
        await Setup.Basics(app);
        await app.Post("/api/masters/party", Setup.Party("AW PARTY", sisterGroup: "AW GROUP")).Ok();
        await app.Post("/api/masters/party", Setup.Party("AW SISTER", sisterGroup: "AW GROUP")).Ok();
        await app.Post("/api/masters/party", Setup.Party("AW OTHER")).Ok();
        await app.Post("/api/masters/party", Setup.Party("AW LONE")).Ok();
        foreach (var lorry in new[] { "LORRY ONE", "LORRY TWO" })
            await app.Post("/api/masters/transporter", new { name = lorry, active = true, otherSpellings = Array.Empty<string>(), ownVehicle = false }).Ok();
        return app;
    }

    private static object Entry(int inward, string party, string date, int than = 10) => new
    {
        registerMonth = date[..7], inwardNo = inward, entryDate = date, party, designNo = "", lotNo = "", repair = false, than, tp = 0, twoPart = 0, finish = "F1",
        dispatches = Array.Empty<object>(),
    };

    private static object Arrival(string date, string party, int nag, string inward, string lorry = "LORRY ONE", string? no = null, string note = "") =>
        new { aawakMonth = "", aawakNo = no ?? "", arrivalDate = date, party, nag, transporter = lorry, inwardText = inward, note };

    private static async Task<JsonElement> Import(HttpClient app, string path, bool commit, bool groups = false, string month = "")
    {
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(await File.ReadAllBytesAsync(path)), "file", Path.GetFileName(path));
        form.Add(new StringContent(month), "month");
        form.Add(new StringContent(commit ? "true" : "false"), "commit");
        form.Add(new StringContent(groups ? "true" : "false"), "groups");
        return await app.PostAsync(new Uri("/api/import/aawak", UriKind.Relative), form).Ok();
    }

    private static async Task<JsonElement> EntryOf(HttpClient app, string month, int inward) =>
        (await app.Get($"/api/entries?month={month}").Ok()).EnumerateArray().Single(e => e.GetProperty("inwardNo").GetInt32() == inward);

    [Fact]
    public async Task An_arrival_typed_before_its_slips_links_when_the_office_enters_them()
    {
        var app = await Ready();
        var arrival = await app.Post("/api/arrivals", Arrival("2026-08-05", "AW PARTY", 30, "11-12")).Ok();
        Assert.Equal("notLinked", arrival.GetProperty("status").GetString());
        Assert.Equal([11, 12], arrival.GetProperty("missing").EnumerateArray().Select(n => n.GetInt32()));
        var id = arrival.GetProperty("id").GetInt64();

        await app.Post("/api/entries", Entry(11, "AW PARTY", "2026-08-05")).Ok();
        await app.Post("/api/entries", Entry(12, "AW SISTER", "2026-08-06", than: 20)).Ok();

        var linked = await app.Get($"/api/arrivals/{id}").Ok();
        Assert.Equal("linked", linked.GetProperty("status").GetString());
        Assert.Equal(30, linked.GetProperty("slipsNag").GetInt32());
        Assert.True(linked.GetProperty("slips").EnumerateArray().Single(s => s.GetProperty("inwardNo").GetInt32() == 12).GetProperty("sisterFirm").GetBoolean());

        var entry = await EntryOf(app, "2026-08", 11);
        Assert.Equal("found", entry.GetProperty("aawakState").GetString());
        Assert.Equal(arrival.GetProperty("number").GetString(), entry.GetProperty("aawak")[0].GetProperty("number").GetString());
        var next = await app.Get("/api/arrivals/next?month=2026-08").Ok();
        Assert.Equal(arrival.GetProperty("aawakNo").GetInt32() + 1, next.GetProperty("next").GetInt32());
    }

    [Fact]
    public async Task Another_firms_slip_links_only_when_the_NAG_proves_it()
    {
        var app = await Ready();
        await app.Post("/api/entries", Entry(21, "AW OTHER", "2026-07-10")).Ok();

        var wrong = await app.Post("/api/arrivals", Arrival("2026-07-10", "AW PARTY", 99, "21")).Ok();
        Assert.Equal("notLinked", wrong.GetProperty("status").GetString());
        Assert.Contains(wrong.GetProperty("warnings").EnumerateArray(), w => w.GetString()!.Contains("is under AW OTHER", StringComparison.Ordinal));

        var right = await app.Post("/api/arrivals", Arrival("2026-07-10", "AW PARTY", 10, "21")).Ok();
        Assert.Equal("linked", right.GetProperty("status").GetString());
        Assert.Contains(right.GetProperty("warnings").EnumerateArray(), w => w.GetString()!.Contains("not of this party or its sister firms", StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_shortened_range_is_read_the_way_the_NAG_matches()
    {
        var app = await Ready();
        for (var n = 12; n <= 20; n++) await app.Post("/api/entries", Entry(n, "AW LONE", "2026-06-10")).Ok();

        var preview = await app.Get("/api/arrivals/preview-slips?date=2026-06-10&party=AW%20LONE&nag=90&inward=12-2").Ok();
        Assert.Equal("12-20", preview.GetProperty("suggestion").GetString());
        Assert.Equal(90, preview.GetProperty("slipsNag").GetInt32());

        var saved = await app.Post("/api/arrivals", Arrival("2026-06-10", "AW LONE", 90, "12-2")).Ok();
        Assert.Equal("linked", saved.GetProperty("status").GetString());
        Assert.Equal(9, saved.GetProperty("slips").GetArrayLength());
    }

    [Fact]
    public async Task Aawak_NO_is_unique_in_its_month_and_a_deleted_row_comes_back()
    {
        var app = await Ready();
        var first = await app.Post("/api/arrivals", Arrival("2026-05-03", "AW LONE", 5, "", no: "5")).Ok();
        var errors = await app.Post("/api/arrivals", Arrival("2026-05-04", "AW LONE", 6, "", no: "5")).Refused();
        Assert.Contains(errors, e => e.Contains("Aawak NO 5 is already used in May 2026", StringComparison.Ordinal));
        var inserted = await app.Post("/api/arrivals", Arrival("2026-05-04", "AW LONE", 6, "", no: "5A")).Ok();
        Assert.Equal("5A", inserted.GetProperty("number").GetString());

        var id = first.GetProperty("id").GetInt64();
        await app.Delete($"/api/arrivals/{id}").Ok();
        await app.Get($"/api/arrivals/{id}").Refused(HttpStatusCode.NotFound);
        Assert.Contains((await app.Get("/api/arrivals/deleted").Ok()).EnumerateArray(), d => d.GetProperty("id").GetInt64() == id);
        var restored = await app.Post($"/api/arrivals/deleted/{id}/restore", new { }).Ok();
        Assert.Equal("5", restored.GetProperty("number").GetString());
    }

    [Fact]
    public async Task The_gates_workbook_imports_again_and_again_without_losing_app_changes()
    {
        var app = await Ready();
        await app.Post("/api/entries", Entry(31, "AW LONE", "2026-04-02")).Ok();
        var parties = new[] { ("AW LONE", true, "AW PAIR") };
        var lorries = new[] { ("LORRY ONE", true), ("LORRY THREE", false) };
        AawakSheetRow[] rows =
        [
            new("1", 31, "2026-04-02", "AW LONE", 10, "LORRY ONE", "31"),
            new("2", 32, "2026-04-02", "AW LONE", 20, "LORRY THREE", "32 CARRIER"),
            new("3", 33, "2026-04-03", "AW LONE", 30, "LORRY ONE"),
        ];
        var path = AawakWorkbook.Write(folder.File("Aawak--APR.-26-27.xlsx"), rows, parties, lorries);

        var check = await Import(app, path, commit: false);
        Assert.False(check.GetProperty("imported").GetBoolean());
        Assert.Equal("2026-04", check.GetProperty("aawakMonth").GetString());
        Assert.Equal(3, check.GetProperty("added").GetInt32());
        Assert.Equal(60, check.GetProperty("nag").GetInt32());

        var done = await Import(app, path, commit: true, groups: true);
        Assert.True(done.GetProperty("imported").GetBoolean());
        Assert.Equal(["LORRY THREE"], done.GetProperty("addedTransporters").EnumerateArray().Select(t => t.GetString()));
        Assert.Equal(1, done.GetProperty("links").GetProperty("linked").GetInt32());
        Assert.Equal("AW PAIR", factory.ConfigOnDisk.Parties.Single(p => p.Name == "AW LONE").SisterGroup);
        Assert.False(factory.ConfigOnDisk.Transporters.Single(t => t.Name == "LORRY THREE").Active);
        var month = (await app.Get("/api/arrivals?month=2026-04").Ok()).EnumerateArray().ToList();
        Assert.Equal(("32", "CARRIER"), (month[1].GetProperty("inwardText").GetString(), month[1].GetProperty("note").GetString()));

        var again = await Import(app, path, commit: true);
        Assert.Contains(again.GetProperty("errors").EnumerateArray(), e => e.GetProperty("message").GetString()!.Contains("already imported", StringComparison.Ordinal));

        // In the app: Aawak 1's NAG is corrected. In the workbook: Aawak 1 and 2 change, Aawak 3 is taken out.
        var first = month[0];
        await app.Put($"/api/arrivals/{first.GetProperty("id").GetInt64()}", Arrival("2026-04-02", "AW LONE", 11, "31", no: "1")).Ok();
        var newer = AawakWorkbook.Write(folder.File("Aawak--APR.-26-27 (2).xlsx"),
            [rows[0] with { Nag = 12 }, rows[1] with { Nag = 25 }], parties, lorries);
        var update = await Import(app, newer, commit: true);
        Assert.Equal(1, update.GetProperty("updated").GetInt32());
        Assert.Equal(1, update.GetProperty("keptTyped").GetInt32());
        Assert.Equal(1, update.GetProperty("removed").GetInt32());
        var after = (await app.Get("/api/arrivals?month=2026-04").Ok()).EnumerateArray().ToList();
        Assert.Equal([11, 25], after.Select(a => a.GetProperty("nag").GetInt32()));
        Assert.Equal("updated", after[1].GetProperty("lastImport").GetProperty("action").GetString());
    }

    [Fact]
    public async Task Renaming_a_lorry_wala_to_another_merges_them()
    {
        var app = await Ready();
        await app.Post("/api/masters/transporter", new { name = "LORRY FOUR", active = true, otherSpellings = Array.Empty<string>(), ownVehicle = false }).Ok();
        await app.Post("/api/masters/transporter", new { name = "LORY FOUR", active = true, otherSpellings = Array.Empty<string>(), ownVehicle = false }).Ok();
        var arrival = await app.Post("/api/arrivals", Arrival("2026-03-02", "AW LONE", 4, "", lorry: "LORY FOUR")).Ok();

        var refused = await app.Post("/api/masters/transporter", new { originalName = "LORY FOUR", name = "LORRY FOUR", active = true, otherSpellings = Array.Empty<string>(), ownVehicle = false }).Refused();
        Assert.Contains(refused, e => e.Contains("Merge", StringComparison.Ordinal));
        var merged = await app.Post("/api/masters/transporter", new { originalName = "LORY FOUR", name = "LORRY FOUR", active = true, otherSpellings = Array.Empty<string>(), ownVehicle = false, merge = true }).Ok();

        Assert.Equal(["LORY FOUR"], merged.GetProperty("otherSpellings").EnumerateArray().Select(s => s.GetString()));
        Assert.Equal("LORRY FOUR", (await app.Get($"/api/arrivals/{arrival.GetProperty("id").GetInt64()}").Ok()).GetProperty("transporter").GetString());
        Assert.DoesNotContain(factory.ConfigOnDisk.Transporters, t => t.Name == "LORY FOUR");
        var typed = await app.Post("/api/arrivals", Arrival("2026-03-03", "AW LONE", 4, "", lorry: "lory four")).Ok();
        Assert.Equal("LORRY FOUR", typed.GetProperty("transporter").GetString());
    }

    [Fact]
    public async Task A_slip_with_no_arrival_says_so_until_it_is_marked_as_not_needed()
    {
        var app = await Ready();
        await app.Post("/api/arrivals", Arrival("2026-02-01", "AW LONE", 1, "")).Ok();
        await app.Post("/api/entries", Entry(41, "AW LONE", "2026-09-20")).Ok();

        var entry = await EntryOf(app, "2026-09", 41);
        Assert.Equal("none", entry.GetProperty("aawakState").GetString());
        var check = await app.Get("/api/arrivals/check?from=2026-09-01&to=2026-09-30").Ok();
        Assert.Contains(check.GetProperty("slipsWithout").EnumerateArray(), s => s.GetProperty("inwardNo").GetInt32() == 41);

        await app.Put($"/api/arrivals/no-arrival/{entry.GetProperty("id").GetInt64()}", new { note = "moved inside" }).Ok();
        Assert.Equal("notNeeded", (await EntryOf(app, "2026-09", 41)).GetProperty("aawakState").GetString());
        check = await app.Get("/api/arrivals/check?from=2026-09-01&to=2026-09-30").Ok();
        Assert.DoesNotContain(check.GetProperty("slipsWithout").EnumerateArray(), s => s.GetProperty("inwardNo").GetInt32() == 41);
    }

    [Fact]
    public async Task Totals_add_up_sister_firms_under_their_group()
    {
        var app = await Ready();
        await app.Post("/api/arrivals", Arrival("2027-01-05", "AW PARTY", 40, "")).Ok();
        await app.Post("/api/arrivals", Arrival("2027-01-06", "AW SISTER", 60, "", lorry: "LORRY TWO")).Ok();
        await app.Post("/api/arrivals", Arrival("2027-01-16", "AW OTHER", 7, "")).Ok();

        var half = await app.Get("/api/arrivals/totals?from=2027-01-01&to=2027-01-15&group=true").Ok();
        Assert.Equal(100, half.GetProperty("nag").GetInt32());
        var line = half.GetProperty("parties").EnumerateArray().Single();
        Assert.Equal(("AW GROUP", true, 100), (line.GetProperty("name").GetString(), line.GetProperty("isGroup").GetBoolean(), line.GetProperty("nag").GetInt32()));
        Assert.Equal([("LORRY TWO", 60), ("LORRY ONE", 40)], half.GetProperty("transporters").EnumerateArray().Select(t => (t.GetProperty("name").GetString(), t.GetProperty("nag").GetInt32())));

        var statement = await app.Get("/api/arrivals/statement?from=2027-01-01&to=2027-01-31&transporter=LORRY%20ONE").Ok();
        Assert.Equal(47, statement.GetProperty("nag").GetInt32());
        Assert.Equal(2, statement.GetProperty("arrivals").GetArrayLength());
    }
}
