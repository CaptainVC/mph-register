using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using MPHRegister.Contracts.Dashboard;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Json;

namespace MPHRegister.UnitTests.Api;

/// <summary>The app with its clock stopped at 21 Nov 2026, 10:00, so "today", "this month" and "days waiting" never move.</summary>
public sealed class DashboardApiFactory : ApiFactory
{
    public static readonly DateTimeOffset Now = new(2026, 11, 21, 10, 0, 0, TimeSpan.Zero);

    protected override void AddTestServices(IServiceCollection services) => services.AddSingleton<TimeProvider>(new FixedClock(Now));
}

[Collection("api")]
public sealed class ApiDashboardTests(DashboardApiFactory factory) : IClassFixture<DashboardApiFactory>
{
    private sealed record Business(HttpClient App, long Child, long NoRate, long Old, long Factory, long Recent);

    private static async Task<long> Add(HttpClient app, object entry) => (await app.Post("/api/entries", entry).Ok()).GetProperty("id").GetInt64();

    private static object Entry(int inward, string party, string finish, int than, string date, string? sent, bool repair = false,
        int tp = 0, int twoPart = 0, int? dispatchQty = null) => new
    {
        registerMonth = date[..7], inwardNo = inward, entryDate = date, party, designNo = "", lotNo = "", repair, than, tp, twoPart, finish,
        dispatches = sent is null ? Array.Empty<DispatchBody>() : [new DispatchBody(dispatchQty ?? than, $"GP{inward}", sent)],
    };

    private static Task Bill(HttpClient app, string party, params long[] ids) => Bill(app, "2026-10", party, ids);

    private static async Task Bill(HttpClient app, string month, string party, params long[] ids)
    {
        var drafts = await app.Post("/api/billing/build", new { party, month, entryIds = ids, billDate = $"{month}-31", periodFrom = $"{month}-01", periodTo = $"{month}-31" }).Ok();
        await app.Post("/api/billing/save", new { invoices = drafts }).Ok();
    }

    private static async Task<DashboardDto> Dashboard(HttpClient app, string query = "") => await app.Get($"/api/dashboard{query}").Ok<DashboardDto>();

    /// <summary>
    /// DASH A (10% discount, F1 ₹100, F2 ₹50) and DASH B (no discount, F1 ₹80) are billed in October; DASH CHILD is billed to DASH A.
    /// Left without a bill: a sent-back child entry, a DASH A entry in F3 (no rate), an old August DASH B entry, two DASH B entries
    /// still in the factory, and DASH QUIET's only cloth (September). One DASH A entry is a repair. A year before, DASH B had one
    /// October bill of 4 × ₹80 = ₹320.
    /// </summary>
    private async Task<Business> Build()
    {
        var app = factory.App();
        await Setup.Basics(app);
        var settings = await app.Get("/api/settings").Ok();
        var rules = settings.GetProperty("billRules").Deserialize<BillRules>(JsonDefaults.Options)! with
        {
            NumberPrefix = "{FY}\\D\\", TotalMustStayBelow = 200000, CgstPercent = 2.5m, SgstPercent = 2.5m, IgstPercent = 5,
        };
        await app.Put("/api/settings", new { firm = new FirmProfile { Name = "TEST FIRM", HomeStateCode = "08", HomeStateName = "HOME STATE" }, billRules = rules }).Ok();
        await app.Post("/api/masters/party", Setup.Party("DASH A", sisterGroup: "DASH SISTERS")).Ok();
        await app.Post("/api/masters/party", Setup.Party("DASH B", discount: 0)).Ok();
        await app.Post("/api/masters/party", Setup.Party("DASH CHILD", sisterGroup: "DASH SISTERS", gstin: "")).Ok();
        await app.Post("/api/masters/party", Setup.Party("DASH QUIET")).Ok();
        await app.Put("/api/masters/party/rate", new { party = "DASH A", finish = "F1", rate = 100 }).Ok();
        await app.Put("/api/masters/party/rate", new { party = "DASH A", finish = "F2", rate = 50 }).Ok();
        await app.Put("/api/masters/party/rate", new { party = "DASH CHILD", finish = "F1", rate = 100 }).Ok();
        await app.Put("/api/masters/party/rate", new { party = "DASH B", finish = "F1", rate = 80 }).Ok();
        await app.Put("/api/masters/party/rate", new { party = "DASH QUIET", finish = "F1", rate = 10 }).Ok();

        var a1 = await Add(app, Entry(1, "DASH A", "F1", 10, "2026-10-02", "2026-10-03"));
        var a2 = await Add(app, Entry(2, "DASH A", "F2", 20, "2026-10-02", "2026-10-03"));
        var b3 = await Add(app, Entry(3, "DASH B", "F1", 5, "2026-10-02", "2026-10-03"));
        var child = await Add(app, Entry(4, "DASH CHILD", "F1", 7, "2026-10-02", "2026-10-03"));
        var factoryEntry = await Add(app, Entry(5, "DASH B", "F1", 6, "2026-10-02", null));
        var noRate = await Add(app, Entry(6, "DASH A", "F3", 4, "2026-10-02", "2026-10-03"));
        await Add(app, Entry(7, "DASH A", "F1", 2, "2026-10-02", null, repair: true));
        var old = await Add(app, Entry(1, "DASH B", "F1", 3, "2026-08-02", "2026-08-03"));
        await Add(app, Entry(1, "DASH QUIET", "F1", 90, "2026-09-02", "2026-09-03"));
        var recent = await Add(app, Entry(1, "DASH B", "F1", 1, "2026-11-10", null));
        var lastYear = await Add(app, Entry(1, "DASH B", "F1", 4, "2025-10-02", "2025-10-03"));
        await Bill(app, "2025-10", "DASH B", lastYear);
        await Bill(app, "DASH A", a1, a2);
        await Bill(app, "DASH B", b3);
        return new Business(app, child, noRate, old, factoryEntry, recent);
    }

    [Fact]
    public async Task Dashboard_is_worked_out_from_the_bills_the_register_and_the_rates_and_follows_new_bills()
    {
        var business = await Build();
        var app = business.App;
        var d = await Dashboard(app);

        Assert.Equal(("2026-11-21", "26-27", "2026-10"), (d.Today, d.Fy, d.Month));
        Assert.Equal(["26-27", "25-26"], d.Years);
        Assert.Equal(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"], d.Months);
        // October is the only month covered in either year; do not present a comparable year-to-date or annualized pace.
        Assert.Null(d.Compared);

        // October bills: DASH A 2,000 − 10% = 1,800 (+45 + 45 GST); DASH B 400 (+10 + 10 GST).
        Assert.Equal(new YearFigures(2, 2, 35, 2400, 200, 2200, 110, 2310, 1, 0), d.Year);
        var october = d.Monthly.Single(m => m.Month == "2026-10");
        Assert.Equal((2, 35, 2200L, 55L, 55L, 0L, 2310L), (october.Bills, october.Than, october.Taxable, october.Cgst, october.Sgst, october.Igst, october.Total));
        Assert.Equal((7, 54, 320L), (october.InwardEntries, october.InwardThan, october.LastYearTaxable));
        Assert.Equal((1, 1), (d.Monthly.Single(m => m.Month == "2026-11").InwardEntries, d.Monthly.Single(m => m.Month == "2026-11").InwardThan));

        // Ready to bill: child 7 × ₹100 − 10% = 630; F3 has no rate, so 4 THAN × DASH A's ₹60 per THAN = 240; old August entry 3 × ₹80 = 240;
        // DASH QUIET's September cloth 90 × ₹10 − 10% = 810. In the factory: DASH B 6 + 1 THAN × ₹80 = 560.
        var u = d.Unbilled;
        Assert.Equal((4, 104, 1920L), (u.ReadyEntries, u.ReadyThan, u.ReadyValue));
        Assert.Equal((2, 7, 560L), (u.FactoryEntries, u.FactoryThan, u.FactoryValue));
        Assert.Equal((1, 4), (u.NoRateEntries, u.NoRateThan));
        Assert.Equal((2, 1050L, "2026-08-02", 60), (u.OldEntries, u.OldValue, u.Oldest, u.OldAfterDays));
        Assert.Equal([new AgeBucket("0-30", 0, 0, 0), new AgeBucket("31-60", 2, 11, 870), new AgeBucket("61-90", 1, 90, 810), new AgeBucket("90+", 1, 3, 240)], u.Ageing);
        var quietWork = new UnbilledParty("DASH QUIET", 1, 90, 810, 0, "2026-09-02", 79, 0, 0) { EarlierInwardEntries = 1 };
        var oldWork = new UnbilledParty("DASH B", 1, 3, 240, 0, "2026-08-02", 110, 7, 560) { EarlierInwardEntries = 1 };
        Assert.Equal([quietWork, new UnbilledParty("DASH CHILD", 1, 7, 630, 0, "2026-10-02", 49, 0, 0) { EarlierInwardEntries = 1 },
            new UnbilledParty("DASH A", 1, 4, 240, 1, "2026-10-02", 49, 0, 0) { EarlierInwardEntries = 1, ReadyNoRateEntries = 1 }, oldWork], d.UnbilledParties);
        Assert.Equal(new WorkEstimate(4, 104, 1920), d.Review.EarlierInward);
        Assert.Equal(new WorkEstimate(1, 4, 240), d.Review.MissingRate);

        Assert.Equal(
            [new PartyIncome("DASH A", 1, 30, 2000, 200, 1800, 81.8m, 10.0m, 60m, "2026-10-31"), new PartyIncome("DASH B", 1, 5, 400, 0, 400, 18.2m, 0m, 80m, "2026-10-31")],
            d.Parties);
        Assert.Equal([new FinishIncome("F1", 15, 1400, 58.3m, 93.33m), new FinishIncome("F2", 20, 1000, 41.7m, 50m)], d.Finishes);

        // DASH QUIET usually sends 90 THAN in 90 days (30 in 30 days) but nothing in the 30 days up to the last inward date (10 Nov).
        Assert.Equal([new QuietParty("DASH QUIET", 30, 0, "2026-09-02", 80)], d.QuietParties);
        Assert.Equal((1, 2), (d.Repairs.Entries, d.Repairs.Than));
        Assert.Equal([new RepairParty("DASH A", 1, 2)], d.Repairs.TopParties);
        // No Oct 10 or later inward was recorded, so the days 1–10 comparison isn't supported.
        Assert.Equal(new InwardNow("2026-11", "2026-11-10", 1, 1, null, 80, 0), d.ThisMonth);
        Assert.Equal(new DashboardCoverage("2026-11-10", "2026-10-03", "2026-10-31"), d.Coverage);

        Assert.Equal("2026-05", (await Dashboard(app, "?fy=26-27&month=2026-05")).Month);
        var past = await Dashboard(app, "?fy=25-26");
        Assert.Equal(("25-26", "2025-10", 12, 320L), (past.Fy, past.Month, past.Months.Count, past.Year.Taxable));
        Assert.Equal(320L, past.Year.Projected);
        Assert.Null(past.Compared);
        var unknown = await Dashboard(app, "?fy=99-00&month=1999-01");
        Assert.Equal(("26-27", "2026-10"), (unknown.Fy, unknown.Month));

        // Billing the child entry moves its 630 out of "ready to bill" and into income; the F3 guess follows DASH A's new average.
        var childDrafts = await app.Post("/api/billing/build", new { party = "DASH CHILD", month = "2026-10", entryIds = new[] { business.Child }, billDate = "2026-10-31", periodFrom = "2026-10-01", periodTo = "2026-10-31" }).Ok();
        var reassigned = await app.Post($"/api/billing/compute?recipient={Http.Q("DASH A")}", Assert.Single(childDrafts.EnumerateArray())).Ok();
        await app.Post("/api/billing/save", new { invoices = new[] { reassigned } }).Ok();
        var after = await Dashboard(app);
        Assert.Equal((3, 2830L), (after.Year.Bills, after.Year.Taxable));
        Assert.Equal((3, 97, 240L + 263L + 810L), (after.Unbilled.ReadyEntries, after.Unbilled.ReadyThan, after.Unbilled.ReadyValue));
        Assert.Equal(2830L, after.Monthly.Single(m => m.Month == "2026-10").Taxable);
        Assert.Equal([quietWork, new UnbilledParty("DASH A", 1, 4, 263, 1, "2026-10-02", 49, 0, 0) { EarlierInwardEntries = 1, ReadyNoRateEntries = 1 }, oldWork], after.UnbilledParties);
    }

    [Fact]
    public async Task Dispatch_balance_counts_partial_billed_early_and_repair_work_without_future_events()
    {
        using var isolated = new DashboardApiFactory();
        var app = isolated.App();
        var empty = await Dashboard(app);
        Assert.Equal(new InwardNow("2026-11", null, 0, 0, null, 0, 0), empty.ThisMonth);
        Assert.Equal(new DashboardCoverage(null, null, null), empty.Coverage);
        await Setup.Basics(app);
        await app.Post("/api/masters/party", Setup.Party("STOCK", discount: 0)).Ok();
        await app.Post("/api/masters/party", Setup.Party("EARLY", beforeDispatch: true, discount: 0)).Ok();
        var settings = await app.Get("/api/settings").Ok();
        var rules = settings.GetProperty("billRules").Deserialize<BillRules>(JsonDefaults.Options)! with
        {
            NumberPrefix = "{FY}\\D\\", TotalMustStayBelow = 200000,
        };
        await app.Put("/api/settings", new { billRules = rules }).Ok();
        await app.Put("/api/masters/party/rate", new { party = "STOCK", finish = "F1", rate = 100 }).Ok();
        await app.Put("/api/masters/party/rate", new { party = "EARLY", finish = "F1", rate = 100 }).Ok();
        var billed = await Add(app, Entry(81, "STOCK", "F1", 10, "2026-10-10", "2026-10-12", tp: 2, twoPart: 3, dispatchQty: 8));
        await Bill(app, "STOCK", billed);
        await Add(app, Entry(82, "STOCK", "F1", 8, "2026-10-12", "2026-10-14", dispatchQty: 5));
        await Add(app, Entry(83, "EARLY", "F1", 6, "2026-10-13", null, tp: 1));
        await Add(app, Entry(84, "STOCK", "", 4, "2026-11-12", null, repair: true));
        await Add(app, Entry(85, "STOCK", "F1", 3, "2026-11-12", "2026-11-25"));
        await Add(app, Entry(86, "STOCK", "F1", 9, "2026-11-25", null));
        var d = await Dashboard(app);
        Assert.Equal(new StockFigures(new(5, 24, 13, 2), new(2, 6, 3, 1), new(1, 7, 6, 0), new(1, 7, 0, 1), new(1, 4, 4, 0), new(0, 0, 0, 0)), d.Stock);
        Assert.Equal(new WorkEstimate(1, 8, 800), d.Review.DispatchIssue);
        Assert.Equal(new WorkEstimate(1, 6, 600), d.Review.BeforeDispatch);
        Assert.Equal(new DashboardCoverage("2026-11-12", "2026-10-14", "2026-10-31"), d.Coverage);
        Assert.Equal(new InwardNow("2026-11", "2026-11-12", 2, 7, 18, 300, 4), d.ThisMonth);
        Assert.Equal(7, d.Monthly.Single(m => m.Month == "2026-11").InwardThan);
    }

    [Fact]
    public async Task Dashboard_tab_is_on_the_page_and_can_be_hidden_in_settings()
    {
        var app = factory.App();
        var html = await app.GetStringAsync(new Uri("/", UriKind.Relative));
        Assert.Contains("data-view=\"dashboard\"", html, StringComparison.Ordinal);
        Assert.Contains("id=\"view-dashboard\"", html, StringComparison.Ordinal);
        Assert.Contains("src=\"dashboard.js\"", html, StringComparison.Ordinal);
        var script = await app.GetStringAsync(new Uri("/dashboard.js", UriKind.Relative));
        Assert.Contains("/api/dashboard", script, StringComparison.Ordinal);

        Assert.True((await app.Get("/api/info").Ok()).GetProperty("showDashboard").GetBoolean());
        var saved = await app.Put("/api/settings", new { display = new DisplaySettings { ShowDashboard = false } }).Ok();
        Assert.False(saved.GetProperty("display").GetProperty("showDashboard").GetBoolean());
        Assert.False((await app.Get("/api/info").Ok()).GetProperty("showDashboard").GetBoolean());
        Assert.False(factory.ConfigOnDisk.Display.ShowDashboard);
        await app.Put("/api/settings", new { display = new DisplaySettings() }).Ok();
        Assert.True((await app.Get("/api/info").Ok()).GetProperty("showDashboard").GetBoolean());
    }
}
