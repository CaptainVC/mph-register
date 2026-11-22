using MPHRegister.Contracts.Dashboard;
using static MPHRegister.UnitTests.Api.Http;

namespace MPHRegister.UnitTests.Api;

[Collection("api")]
public sealed class ApiNoBillTests
{
    private const string Query = "from=2026-10-01&to=2026-10-31";

    [Fact]
    public async Task Party_that_needs_no_bill_is_left_out_of_billing_the_dashboard_work_and_gets_a_register_flag()
    {
        using var isolated = new DashboardApiFactory();
        var app = isolated.App();
        await Setup.Basics(app);
        await app.Post("/api/masters/party", Setup.Party("PAYS", discount: 0)).Ok();
        await app.Put("/api/masters/party/rate", new { party = "PAYS", finish = "F1", rate = 100 }).Ok();

        // No GSTIN, discount, rates or usable style are needed for a party that is never billed.
        var saved = await app.Post("/api/masters/party", Setup.Party("PARKER", style: "", gstin: "", discount: null, noBill: true)).Ok();
        Assert.True(saved.GetProperty("noBillNeeded").GetBoolean());
        Assert.Empty(saved.GetProperty("problems").EnumerateArray());

        await app.Post("/api/entries", Setup.Entry(1, "PAYS")).Ok();
        var sent = await app.Post("/api/entries", Setup.Entry(2, "PARKER")).Ok();
        await app.Post("/api/entries", Setup.Entry(3, "PARKER", dispatched: false)).Ok();

        var toBill = await app.Get($"/api/billing/parties?{Query}").Ok();
        Assert.Equal(["PAYS"], toBill.EnumerateArray().Select(p => p.GetProperty("party").GetString()).ToList());

        var candidates = await app.Get($"/api/billing/candidates?party=PARKER&{Query}").Ok();
        Assert.True(candidates.GetProperty("noBillNeeded").GetBoolean());
        Assert.Empty(candidates.GetProperty("entries").EnumerateArray());

        var entryIds = new[] { sent.GetProperty("id").GetInt64() };
        var request = new { party = "PARKER", month = "2026-10", entryIds, billDate = "2026-10-31", periodFrom = "2026-10-01", periodTo = "2026-10-31" };
        Assert.Contains("No bill needed", Assert.Single(await app.Post("/api/billing/build", request).Refused()), StringComparison.Ordinal);
        Assert.Contains("No bill needed", Assert.Single(await app.Post("/api/billing/count", request).Refused()), StringComparison.Ordinal);

        var register = (await app.Get("/api/entries?month=2026-10").Ok()).EnumerateArray().ToList();
        Assert.Equal([false, true, true], register.OrderBy(e => e.GetProperty("inwardNo").GetInt32()).Select(e => e.GetProperty("noBillNeeded").GetBoolean()));

        var dashboard = await app.Get("/api/dashboard").Ok<DashboardDto>();
        Assert.Equal((1, 10), (dashboard.Unbilled.ReadyEntries, dashboard.Unbilled.ReadyThan));
        Assert.Equal(0, dashboard.Unbilled.FactoryEntries);
        Assert.Equal(["PAYS"], dashboard.UnbilledParties.Select(p => p.Party));
        Assert.Equal(new StockBalance(1, 10, 10, 0), dashboard.Stock.NoBill);
        Assert.Equal(new StockBalance(0, 0, 0, 0), dashboard.Stock.Unbilled);
    }

    [Fact]
    public async Task Saving_a_party_without_the_setting_keeps_it_and_clearing_it_brings_the_party_back_into_billing()
    {
        using var isolated = new DashboardApiFactory();
        var app = isolated.App();
        await Setup.Basics(app);
        await app.Post("/api/masters/party", Setup.Party("PARKER", discount: 0, noBill: true)).Ok();
        await app.Put("/api/masters/party/rate", new { party = "PARKER", finish = "F1", rate = 100 }).Ok();
        await app.Post("/api/entries", Setup.Entry(1, "PARKER")).Ok();

        // Clients that do not send the field leave it as it is.
        var untouched = await app.Post("/api/masters/party", new
        {
            originalName = "PARKER", name = "PARKER", active = true, address = "NEW ADDR", state = "(HOME STATE)", gstin = "08TESTF9001J1ZJ", discount = 0, color = "navy",
            billingStyle = "GATE PASS STYLE", billBeforeDispatch = false, billAs = new Dictionary<string, string>(),
        }).Ok();
        Assert.True(untouched.GetProperty("noBillNeeded").GetBoolean());

        var cleared = await app.Post("/api/masters/party", Setup.Party("PARKER", original: "PARKER", discount: 0)).Ok();
        Assert.False(cleared.GetProperty("noBillNeeded").GetBoolean());
        var toBill = await app.Get($"/api/billing/parties?{Query}").Ok();
        Assert.Equal(["PARKER"], toBill.EnumerateArray().Select(p => p.GetProperty("party").GetString()).ToList());
        var candidates = await app.Get($"/api/billing/candidates?party=PARKER&{Query}").Ok();
        Assert.False(candidates.GetProperty("noBillNeeded").GetBoolean());
        Assert.Single(candidates.GetProperty("entries").EnumerateArray());
    }
}
