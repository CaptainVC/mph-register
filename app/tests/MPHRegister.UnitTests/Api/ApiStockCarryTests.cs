using System.Text.Json;
using static MPHRegister.UnitTests.Api.Http;

namespace MPHRegister.UnitTests.Api;

/// <summary>Slips of earlier months still in stock when a month (or bill period) begins come along on Party-wise and Make bills.</summary>
[Collection("api")]
public sealed class ApiStockCarryTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Party = "STOCK PARTY";

    private static object Slip(int inward, string month, string date, params (int Qty, string Date)[] sent) => new
    {
        registerMonth = month, inwardNo = inward, entryDate = date, party = Party, designNo = $"D{inward}", lotNo = $"L{inward}", repair = false,
        than = 10, tp = 0, twoPart = 0, finish = "F1", dispatches = sent.Select((d, i) => new DispatchBody(d.Qty, $"GP{inward}{i}", d.Date)).ToArray(),
    };

    private async Task<(HttpClient App, Dictionary<int, long> Ids)> Ready()
    {
        var app = factory.App();
        await Setup.Basics(app);
        await app.Post("/api/masters/party", Setup.Party(Party)).Ok();
        await app.Put("/api/masters/party/rate", new { party = Party, finish = "F1", rate = 100 }).Ok();
        var ids = new Dictionary<int, long>();
        foreach (var (inward, body) in new[]
        {
            (1, Slip(1, "2026-03", "2026-03-10")),                                 // last financial year, nothing sent: in stock
            (2, Slip(2, "2026-09", "2026-09-10", (10, "2026-09-20"))),             // all sent in September
            (3, Slip(3, "2026-10", "2026-10-06")),                                 // nothing sent
            (4, Slip(4, "2026-10", "2026-10-08", (4, "2026-10-20"))),              // part sent in October
            (5, Slip(5, "2026-10", "2026-10-14", (10, "2026-11-05"))),             // all sent, but in November
            (6, Slip(6, "2026-10", "2026-10-19", (10, "2026-10-30"))),             // all sent in October
            (7, Slip(7, "2026-11", "2026-11-03", (10, "2026-11-04"))),             // November's own slip
            (8, Slip(8, "2026-12", "2026-12-02")),                                 // a later month
        })
        {
            ids[inward] = (await app.Post("/api/entries", body).Ok()).GetProperty("id").GetInt64();
        }
        return (app, ids);
    }

    private static List<int> Inward(JsonElement list) => list.EnumerateArray().Select(e => e.GetProperty("inwardNo").GetInt32()).Order().ToList();

    [Fact]
    public async Task Party_wise_and_bills_bring_along_earlier_slips_still_in_stock()
    {
        var (app, ids) = await Ready();

        // One month: its slips and every earlier one not fully sent before its 1st.
        Assert.Equal([1, 3, 4, 5, 7], Inward(await app.Get("/api/partywise?month=2026-11").Ok()));
        Assert.Equal([1, 3, 4, 5, 6], Inward(await app.Get($"/api/partywise?month=2026-10&party={Q(Party)}").Ok()));
        // A financial year: the earlier years' stock when April began; every year: nothing to bring along.
        Assert.Equal([1, 2, 3, 4, 5, 6, 7, 8], Inward(await app.Get("/api/partywise?fy=2026").Ok()));
        Assert.Equal([1], Inward(await app.Get("/api/partywise?fy=2025").Ok()));
        Assert.Equal([1, 2, 3, 4, 5, 6, 7, 8], Inward(await app.Get("/api/partywise?month=").Ok()));

        // The November bill lists the same stock, marked as such; the sent one is ticked.
        var toBill = (await app.Get("/api/billing/parties?from=2026-11-01&to=2026-11-30").Ok()).EnumerateArray().Single(p => p.GetProperty("party").GetString() == Party);
        Assert.Equal(5, toBill.GetProperty("entries").GetInt32());
        var candidates = (await app.Get($"/api/billing/candidates?party={Q(Party)}&from=2026-11-01&to=2026-11-30").Ok()).GetProperty("entries").EnumerateArray().ToList();
        Assert.Equal([1, 3, 4, 5, 7], candidates.Select(c => c.GetProperty("inwardNo").GetInt32()).Order());
        Assert.Equal([1, 3, 4, 5], candidates.Where(c => c.GetProperty("fromStock").GetBoolean()).Select(c => c.GetProperty("inwardNo").GetInt32()).Order());
        Assert.Equal([4, 5, 7], candidates.Where(c => c.GetProperty("selected").GetBoolean()).Select(c => c.GetProperty("inwardNo").GetInt32()).Order());

        // A slip from stock can be billed in November; one fully sent before the period cannot.
        var bill = new { party = Party, month = "2026-11", billDate = "2026-11-30", periodFrom = "2026-11-01", periodTo = "2026-11-30" };
        var refused = await app.Post("/api/billing/build", new { bill.party, bill.month, entryIds = new[] { ids[6] }, bill.billDate, bill.periodFrom, bill.periodTo }).Refused();
        Assert.Contains(refused, e => e.Contains("outside the bill period", StringComparison.Ordinal));
        var drafts = await app.Post("/api/billing/build", new { bill.party, bill.month, entryIds = new[] { ids[5], ids[7] }, bill.billDate, bill.periodFrom, bill.periodTo }).Ok();
        await app.Post("/api/billing/save", new { invoices = new[] { Assert.Single(drafts.EnumerateArray()) } }).Ok();

        var left = (await app.Get($"/api/billing/candidates?party={Q(Party)}&from=2026-11-01&to=2026-11-30").Ok()).GetProperty("entries");
        Assert.Equal([1, 3, 4], Inward(left));
        // Billed or not, Party-wise still shows where the goods are.
        Assert.Equal([1, 3, 4, 5, 7], Inward(await app.Get("/api/partywise?month=2026-11").Ok()));
    }
}
