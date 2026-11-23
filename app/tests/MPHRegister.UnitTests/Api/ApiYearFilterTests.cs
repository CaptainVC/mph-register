using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Dapper;
using Microsoft.Data.Sqlite;
using static MPHRegister.UnitTests.Api.Http;

namespace MPHRegister.UnitTests.Api;

/// <summary>Lists of one financial year (?fy=), the bill months list, the bill count in the candidates, long id lists and the dashboard's tag.</summary>
[Collection("api")]
public sealed class ApiYearFilterTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private async Task<HttpClient> Ready()
    {
        var app = factory.App();
        if (factory.ConfigOnDisk.Finishes.Count != 0) return app;
        await Setup.Basics(app);
        foreach (var party in new[] { "FY PARTY", "FY OTHER" })
        {
            await app.Post("/api/masters/party", Setup.Party(party)).Ok();
            await app.Put("/api/masters/party/rate", new { party, finish = "F1", rate = 100 }).Ok();
        }
        await app.Post("/api/masters/transporter", new { name = "FY LORRY", active = true, otherSpellings = Array.Empty<string>(), ownVehicle = false }).Ok();
        return app;
    }

    // Inward numbers below 10 are this class's year test's own entries; the other tests add theirs to the same data folder.
    private static List<int> Inward(JsonElement list) => list.EnumerateArray().Select(e => e.GetProperty("inwardNo").GetInt32()).Where(n => n < 10).Order().ToList();

    private static async Task<long> SaveBill(HttpClient app, string month, long entryId)
    {
        var culture = System.Globalization.CultureInfo.InvariantCulture;
        var to = DateOnly.ParseExact(month + "-01", "yyyy-MM-dd", culture).AddMonths(1).AddDays(-1).ToString("yyyy-MM-dd", culture);
        var drafts = await app.Post("/api/billing/build", new { party = "FY PARTY", month, entryIds = new[] { entryId }, billDate = to, periodFrom = $"{month}-01", periodTo = to }).Ok();
        var saved = await app.Post("/api/billing/save", new { invoices = new[] { Assert.Single(drafts.EnumerateArray()) } }).Ok();
        return Assert.Single(saved.EnumerateArray()).GetProperty("id").GetInt64();
    }

    [Fact]
    public async Task Entries_party_wise_Aawak_and_bills_can_be_read_for_one_financial_year()
    {
        var app = await Ready();
        var ids = new Dictionary<string, long>();
        foreach (var (inward, month) in new[] { (1, "2030-03"), (2, "2030-04"), (3, "2031-03"), (4, "2031-04") })
        {
            var saved = await app.Post("/api/entries", Setup.Entry(inward, inward == 3 ? "FY OTHER" : "FY PARTY", month: month)).Ok();
            ids[month] = saved.GetProperty("id").GetInt64();
            await app.Post("/api/arrivals", new { aawakMonth = "", aawakNo = "", arrivalDate = $"{month}-02", party = "FY PARTY", nag = 10, transporter = "FY LORRY", inwardText = $"{inward}", note = "" }).Ok();
        }

        // fy=2030 is April 2030 to March 2031, by register month; a month in the query wins, even an empty one.
        Assert.Equal([2, 3], Inward(await app.Get("/api/entries?fy=2030").Ok()));
        Assert.Equal([1], Inward(await app.Get("/api/entries?fy=2029").Ok()));
        Assert.Equal([2], Inward(await app.Get("/api/entries?fy=2030&month=2030-04").Ok()));
        Assert.Equal([1, 2, 3, 4], Inward(await app.Get("/api/entries?fy=2030&month=").Ok()));
        Assert.Equal([1, 2, 3, 4], Inward(await app.Get("/api/entries").Ok()));
        Assert.Equal([1, 2, 3, 4], Inward(await app.Get("/api/entries?fy=30-31").Ok()));

        Assert.Equal([2, 3], Inward(await app.Get("/api/partywise?fy=2030").Ok()));
        Assert.Equal([2], Inward(await app.Get($"/api/partywise?fy=2030&party={Q("fy party")}").Ok()));
        Assert.Equal([1, 2, 3, 4], Inward(await app.Get("/api/partywise?month=&fy=2030").Ok()));
        Assert.Equal([1, 2, 4], Inward(await app.Get($"/api/partywise?month=&party={Q("FY PARTY")}").Ok()));

        var aawak = await app.Get("/api/arrivals?fy=2030").Ok();
        Assert.Equal(["2030-04", "2031-03"], aawak.EnumerateArray().Select(a => a.GetProperty("aawakMonth").GetString()));
        Assert.Equal(4, (await app.Get("/api/arrivals").Ok()).GetArrayLength());
        Assert.Equal(["2030-04"], (await app.Get("/api/arrivals?fy=2030&month=2030-04").Ok()).EnumerateArray().Select(a => a.GetProperty("aawakMonth").GetString()));

        Assert.Empty((await app.Get("/api/invoices/months").Ok()).EnumerateArray());
        var march = await SaveBill(app, "2030-03", ids["2030-03"]);
        await SaveBill(app, "2030-04", ids["2030-04"]);
        await SaveBill(app, "2031-04", ids["2031-04"]);
        await app.Post($"/api/invoices/{march}/cancel", new { }).Ok();

        var all = await app.Get("/api/invoices").Ok();
        Assert.Equal(["2030-04"], (await app.Get("/api/invoices?fy=2030").Ok()).EnumerateArray().Select(i => i.GetProperty("billMonth").GetString()));
        Assert.Equal(["2030-03"], (await app.Get("/api/invoices?fy=2029&party=FY%20PARTY").Ok()).EnumerateArray().Select(i => i.GetProperty("billMonth").GetString()));
        Assert.Equal(3, (await app.Get("/api/invoices?month=&fy=2030").Ok()).GetArrayLength());

        // The bill months list says what the whole list of bills (cancelled ones too) would, newest first.
        var months = (await app.Get("/api/invoices/months").Ok()).EnumerateArray().Select(m => (m.GetProperty("month").GetString(), m.GetProperty("bills").GetInt32())).ToList();
        Assert.Equal([("2031-04", 1), ("2030-04", 1), ("2030-03", 1)], months);
        Assert.Equal(all.EnumerateArray().GroupBy(i => i.GetProperty("billMonth").GetString()).Select(g => (g.Key, g.Count())).OrderByDescending(m => m.Key, StringComparer.Ordinal), months);
    }

    [Fact]
    public async Task Candidates_count_the_bills_of_the_ticked_entries_as_the_count_endpoint_does()
    {
        var app = await Ready();
        await app.Post("/api/masters/party", Setup.Party("FY MANY")).Ok();
        await app.Put("/api/masters/party/rate", new { party = "FY MANY", finish = "F1", rate = 100 }).Ok();
        await app.Post("/api/masters/party", Setup.Party("FY WAITING")).Ok();
        await app.Post("/api/masters/party", Setup.Party("FY NO BILL", noBill: true)).Ok();
        for (var i = 0; i < 30; i++)
            await app.Post("/api/entries", Setup.Entry(100 + i, "FY MANY", dn: $"D{i}", lot: $"L{i}", gatePass: $"G{i}", month: "2026-08")).Ok();
        await app.Post("/api/entries", Setup.Entry(200, "FY WAITING", dispatched: false, month: "2026-08")).Ok();
        await app.Post("/api/entries", Setup.Entry(201, "FY NO BILL", month: "2026-08")).Ok();

        var candidates = await app.Get($"/api/billing/candidates?party={Q("fy many")}&from=2026-08-01&to=2026-08-31").Ok();
        var ticked = candidates.GetProperty("entries").EnumerateArray().Where(e => e.GetProperty("selected").GetBoolean()).Select(e => e.GetProperty("entryId").GetInt64()).ToList();
        Assert.Equal(30, ticked.Count);
        var counted = (await app.Post("/api/billing/count", new { party = candidates.GetProperty("billParty").GetString(), entryIds = ticked }).Ok()).GetInt32();
        Assert.True(counted > 1, $"30 one-line entries make more than one bill of 25 rows, not {counted}");
        Assert.Equal(counted, candidates.GetProperty("count").GetInt32());

        // Nothing ticked (not dispatched, no billing before dispatch) and no bill needed: no count.
        var waiting = await app.Get($"/api/billing/candidates?party={Q("FY WAITING")}&from=2026-08-01&to=2026-08-31").Ok();
        Assert.Single(waiting.GetProperty("entries").EnumerateArray());
        Assert.Equal(JsonValueKind.Null, waiting.GetProperty("count").ValueKind);
        var noBill = await app.Get($"/api/billing/candidates?party={Q("FY NO BILL")}&from=2026-08-01&to=2026-08-31").Ok();
        Assert.Equal(JsonValueKind.Null, noBill.GetProperty("count").ValueKind);
    }

    [Fact]
    public async Task Very_long_lists_of_entry_ids_are_one_parameter_not_one_each()
    {
        var app = await Ready();
        var entry = (await app.Post("/api/entries", Setup.Entry(300, "FY OTHER", month: "2026-09")).Ok()).GetProperty("id").GetInt64();
        // More ids than SQLite takes parameters (32,766): each used to be one parameter.
        var ids = Enumerable.Range(1, 40_000).Select(i => 10_000_000L + i).Append(entry).ToList();
        Assert.Equal(1, (await app.Post("/api/billing/count", new { party = "FY OTHER", entryIds = ids }).Ok()).GetInt32());
        var errors = await app.Post("/api/billing/build", new { party = "FY OTHER", month = "2026-09", entryIds = ids, billDate = "2026-09-30", periodFrom = "2026-09-01", periodTo = "2026-09-30" }).Refused();
        Assert.Contains(errors, e => e.Contains("already billed or do not belong", StringComparison.Ordinal));

        // Working a draft out again reads its lines' entries by id.
        var draft = Assert.Single((await app.Post("/api/billing/build", new { party = "FY OTHER", month = "2026-09", entryIds = new[] { entry }, billDate = "2026-09-30", periodFrom = "2026-09-01", periodTo = "2026-09-30" }).Ok()).EnumerateArray());
        var doc = draft.Deserialize<Dictionary<string, JsonElement>>()!;
        var lines = doc["lines"].Deserialize<List<Dictionary<string, JsonElement>>>()!;
        var priced = lines.First(l => l["entryIds"].ValueKind == JsonValueKind.Array && l["entryIds"].GetArrayLength() > 0);
        priced["entryIds"] = JsonSerializer.SerializeToElement(ids);
        doc["lines"] = JsonSerializer.SerializeToElement(lines);
        var computed = await app.Post("/api/billing/compute", doc).Ok();
        Assert.Equal(draft.GetProperty("total").GetInt64(), computed.GetProperty("total").GetInt64());
    }

    [Fact]
    public async Task The_dashboard_answers_not_modified_until_the_data_the_config_or_the_day_changes()
    {
        var app = await Ready();
        var (first, tag) = await Dashboard(app, "/api/dashboard?fy=26-27");
        Assert.Equal(HttpStatusCode.NotModified, await Status(app, "/api/dashboard?fy=26-27", tag));
        Assert.Equal(HttpStatusCode.OK, await Status(app, "/api/dashboard?fy=25-26", tag));
        var (again, sameTag) = await Dashboard(app, "/api/dashboard?fy=26-27");
        Assert.Equal((tag, first), (sameTag, again));

        await app.Post("/api/entries", Setup.Entry(400, "FY OTHER", month: "2026-09")).Ok();
        Assert.Equal(HttpStatusCode.OK, await Status(app, "/api/dashboard?fy=26-27", tag));
        var (_, afterEntry) = await Dashboard(app, "/api/dashboard?fy=26-27");

        // A change made outside the app (another program on the data file) is seen too: the file's size or write time moves.
        await using (var outside = new SqliteConnection($"Data Source={Path.Combine(factory.DataDirectory, "mph-data.db")};Pooling=False"))
            await outside.ExecuteAsync("UPDATE entries SET than = than + 1 WHERE inward_no = 400;");
        Assert.Equal(HttpStatusCode.OK, await Status(app, "/api/dashboard?fy=26-27", afterEntry));
        var (_, afterOutside) = await Dashboard(app, "/api/dashboard?fy=26-27");

        await app.Post("/api/masters/party", Setup.Party("FY NEW PARTY")).Ok();
        Assert.Equal(HttpStatusCode.OK, await Status(app, "/api/dashboard?fy=26-27", afterOutside));
        var (_, factsTag) = await Dashboard(app, "/api/dashboard/facts");
        Assert.Equal(HttpStatusCode.NotModified, await Status(app, "/api/dashboard/facts", factsTag));
    }

    private static async Task<(string Body, string Tag)> Dashboard(HttpClient app, string url)
    {
        using var response = await app.Get(url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadAsStringAsync(), response.Headers.ETag?.Tag ?? throw new InvalidOperationException("no ETag"));
    }

    private static async Task<HttpStatusCode> Status(HttpClient app, string url, string tag)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(url, UriKind.Relative));
        request.Headers.IfNoneMatch.Add(EntityTagHeaderValue.Parse(tag));
        using var response = await app.SendAsync(request);
        if (response.StatusCode == HttpStatusCode.NotModified) Assert.Equal(tag, response.Headers.ETag?.Tag);
        return response.StatusCode;
    }
}
