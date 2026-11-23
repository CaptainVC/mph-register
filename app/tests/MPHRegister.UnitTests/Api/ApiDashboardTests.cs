using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using MPHRegister.Contracts.Dashboard;
using MPHRegister.Services.Dashboard;
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
    private Task<Business> Build() => Build(factory.App());

    private static async Task<Business> Build(HttpClient app)
    {
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
        Assert.Null(d.Party);
        Assert.Null(d.Overall);
        Assert.Contains("DASH CHILD", d.PartyOptions);

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

        var a = await Dashboard(app, $"?party={Http.Q(" dash  a ")}");
        Assert.Equal("DASH A", a.Party);
        Assert.Equal(d.PartyOptions, a.PartyOptions);
        Assert.Equal(new DashboardOverall(2200, 2200, 35, "2026-11-10"), a.Overall);
        Assert.Equal(new YearFigures(1, 1, 30, 2000, 200, 1800, 90, 1890, 1, 0), a.Year);
        Assert.Equal([new FinishIncome("F1", 10, 1000, 50m, 100m), new FinishIncome("F2", 20, 1000, 50m, 50m)], a.Finishes.OrderBy(f => f.Finish, StringComparer.Ordinal));
        Assert.Equal(81.8m, Assert.Single(a.Parties).Share);
        Assert.Equal((4, 36, 0L), (a.Monthly[^2].InwardEntries, a.Monthly[^2].InwardThan, a.Monthly[^2].LastYearTaxable));
        Assert.Equal((1, 4, 240L), (a.Unbilled.ReadyEntries, a.Unbilled.ReadyThan, a.Unbilled.ReadyValue));
        Assert.Equal(2, a.Stock.Total.Pieces);
        Assert.Equal(new RepairParty("DASH A", 1, 2), Assert.Single(a.Repairs.TopParties));
        Assert.Empty(a.QuietParties);
        Assert.Equal(new DashboardCoverage("2026-10-02", "2026-10-03", "2026-10-31"), a.Coverage);
        Assert.Equal(new InwardNow("2026-11", "2026-11-10", 0, 0, null, 0, 0), a.ThisMonth);

        var filteredPast = await Dashboard(app, $"?party={Http.Q("DASH A")}&fy=25-26");
        Assert.Equal(("2025-10", 0L, 320L, 4), (filteredPast.Month, filteredPast.Year.Taxable, filteredPast.Overall!.MonthTaxable, filteredPast.Overall.YearThan));
        Assert.Equal(a.Stock, filteredPast.Stock);
        Assert.Equal(a.Unbilled.ReadyEntries, filteredPast.Unbilled.ReadyEntries);
        var b = await Dashboard(app, $"?party={Http.Q("DASH B")}");
        Assert.Equal(320L, b.Monthly[^2].LastYearTaxable);
        var quiet = await Dashboard(app, $"?party={Http.Q("DASH QUIET")}&month=2026-11");
        Assert.Equal(d.QuietParties, quiet.QuietParties);
        Assert.Equal(0, quiet.Overall!.MonthTaxable);
        Assert.Equal(0, quiet.Review.EarlierInward.Entries);
        var absent = await Dashboard(app, "?party=ABSENT");
        Assert.Equal("ABSENT", absent.Party);
        Assert.Equal(0, absent.Year.Bills);
        Assert.Empty(absent.Finishes);
        Assert.Equal(new DashboardCoverage(null, null, null), absent.Coverage);
        Assert.Equal(a.Overall, absent.Overall);

        // Billing the child entry moves its 630 out of "ready to bill" and into income; the F3 guess follows DASH A's new average.
        var childDrafts = await app.Post("/api/billing/build", new { party = "DASH CHILD", month = "2026-10", entryIds = new[] { business.Child }, billDate = "2026-10-31", periodFrom = "2026-10-01", periodTo = "2026-10-31" }).Ok();
        var reassigned = await app.Post($"/api/billing/compute?recipient={Http.Q("DASH A")}", Assert.Single(childDrafts.EnumerateArray())).Ok();
        await app.Post("/api/billing/save", new { invoices = new[] { reassigned } }).Ok();
        var after = await Dashboard(app);
        Assert.Equal((3, 2830L), (after.Year.Bills, after.Year.Taxable));
        Assert.Equal((3, 97, 240L + 263L + 810L), (after.Unbilled.ReadyEntries, after.Unbilled.ReadyThan, after.Unbilled.ReadyValue));
        Assert.Equal(2830L, after.Monthly.Single(m => m.Month == "2026-10").Taxable);
        Assert.Equal([quietWork, new UnbilledParty("DASH A", 1, 4, 263, 1, "2026-10-02", 49, 0, 0) { EarlierInwardEntries = 1, ReadyNoRateEntries = 1 }, oldWork], after.UnbilledParties);
        var afterA = await Dashboard(app, $"?party={Http.Q("DASH A")}");
        var afterChild = await Dashboard(app, $"?party={Http.Q("DASH CHILD")}");
        Assert.Equal((2430L, 37, 36), (afterA.Year.Taxable, afterA.Year.Than, afterA.Monthly[^2].InwardThan));
        Assert.Equal((0, 7, 0), (afterChild.Year.Bills, afterChild.Monthly[^2].InwardThan, afterChild.Unbilled.ReadyEntries));
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
        Assert.Contains("src=\"js/dashboard/data.js\"", html, StringComparison.Ordinal);
        var script = await app.GetStringAsync(new Uri("/js/dashboard/data.js", UriKind.Relative));
        Assert.Contains("/api/dashboard", script, StringComparison.Ordinal);

        Assert.True((await app.Get("/api/info").Ok()).GetProperty("showDashboard").GetBoolean());
        var saved = await app.Put("/api/settings", new { display = new DisplaySettings { ShowDashboard = false } }).Ok();
        Assert.False(saved.GetProperty("display").GetProperty("showDashboard").GetBoolean());
        Assert.False((await app.Get("/api/info").Ok()).GetProperty("showDashboard").GetBoolean());
        Assert.False(factory.ConfigOnDisk.Display.ShowDashboard);
        await app.Put("/api/settings", new { display = new DisplaySettings() }).Ok();
        Assert.True((await app.Get("/api/info").Ok()).GetProperty("showDashboard").GetBoolean());
    }

    private static async Task<(DashboardFactsDto Facts, string Tag)> Facts(HttpClient app)
    {
        using var response = await app.Get("/api/dashboard/facts");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var tag = response.Headers.ETag?.Tag;
        Assert.NotNull(tag);
        return ((await response.Content.ReadFromJsonAsync<DashboardFactsDto>(JsonDefaults.Options))!, tag);
    }

    private static async Task<HttpStatusCode> FactsStatus(HttpClient app, string tag)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri("/api/dashboard/facts", UriKind.Relative));
        request.Headers.IfNoneMatch.Add(EntityTagHeaderValue.Parse(tag));
        using var response = await app.SendAsync(request);
        return response.StatusCode;
    }

    private static long[] Total(IEnumerable<long[]> rows, int from, int width)
    {
        var total = new long[width];
        foreach (var row in rows)
        {
            for (var i = 0; i < width; i++) total[i] += row[from + i];
        }
        return total;
    }

    private static WorkEstimate Sum(IEnumerable<WorkEstimate> work)
    {
        var list = work.ToList();
        return new WorkEstimate(list.Sum(w => w.Entries), list.Sum(w => w.Than), list.Sum(w => w.Value));
    }

    private static StockBalance Sum(IEnumerable<StockBalance> balances)
    {
        var list = balances.ToList();
        return new StockBalance(list.Sum(b => b.Entries), list.Sum(b => b.Pieces), list.Sum(b => b.UndispatchedThan), list.Sum(b => b.PartialEntries));
    }

    [Fact]
    public async Task Facts_hold_each_party_and_month_and_add_up_to_the_dashboard_figures()
    {
        using var isolated = new DashboardApiFactory();
        var app = (await Build(isolated.App())).App;
        var (f, tag) = await Facts(app);
        var d = await Dashboard(app);
        var past = await Dashboard(app, "?fy=25-26");
        string Name(long i) => f.Parties[(int)i].Name;
        string Month(long i) => f.Months[(int)i];
        bool ThisYear(long[] row) => string.CompareOrdinal(Month(row[1]), "2026-04") >= 0;

        Assert.Equal(("2026-11-21", "2025-04", "2026-11", 20), (f.Today, f.Months[0], f.Months[^1], f.Months.Count));
        Assert.Equal(d.PartyOptions, f.Parties.Select(p => p.Name));
        Assert.Equal(new FactsParty("DASH A", "DASH SISTERS", true, false, "2026-10-02", "2026-10-03", "2026-10-31"), f.Parties.Single(p => p.Name == "DASH A"));
        Assert.Equal(new FactsParty("DASH QUIET", "", true, false, "2026-09-02", "2026-09-03", null), f.Parties.Single(p => p.Name == "DASH QUIET"));
        Assert.Equal(d.Coverage, f.Coverage);
        Assert.Equal(DashboardService.OldAfterDays, f.OldAfterDays);

        // Bills per party and month add up to the dashboard's year, months and parties, this year and last.
        var year = Total(f.Bills.Where(ThisYear), 2, 9);
        Assert.Equal((d.Year.Bills, d.Year.Than, d.Year.Gross, d.Year.Discount, d.Year.Taxable, d.Year.Gst, d.Year.Total),
            ((int)year[0], (int)year[1], year[2], year[3], year[4], year[5] + year[6] + year[7], year[8]));
        Assert.Equal(past.Year.Taxable, Total(f.Bills.Where(r => !ThisYear(r)), 2, 9)[4]);
        foreach (var month in d.Monthly)
        {
            var bills = Total(f.Bills.Where(r => Month(r[1]) == month.Month), 2, 9);
            Assert.Equal((month.Bills, month.Than, month.Gross, month.Discount, month.Taxable, month.Cgst, month.Sgst, month.Igst, month.Total),
                ((int)bills[0], (int)bills[1], bills[2], bills[3], bills[4], bills[5], bills[6], bills[7], bills[8]));
            var inward = Total(f.Inward.Where(r => Month(r[1]) == month.Month), 2, 7);
            Assert.Equal((month.InwardEntries, month.InwardThan), ((int)inward[0], (int)inward[1]));
        }
        Assert.Equal(d.Parties.Select(p => (p.Party, p.Bills, p.Than, p.Gross, p.Discount, p.Taxable)),
            f.Bills.Where(ThisYear).GroupBy(r => Name(r[0])).Select(g => (Party: g.Key, Sum: Total(g, 2, 9)))
                .OrderByDescending(p => p.Sum[4]).Select(p => (p.Party, (int)p.Sum[0], (int)p.Sum[1], p.Sum[2], p.Sum[3], p.Sum[4])));
        Assert.Equal(d.Finishes.Select(x => (x.Finish, x.Than, x.Amount)),
            f.FinishLines.Where(ThisYear).GroupBy(r => f.Finishes[(int)r[2]]).Select(g => (Finish: g.Key, Than: (int)g.Sum(r => r[3]), Amount: g.Sum(r => r[4]))).OrderByDescending(x => x.Amount));

        // DASH A's October cloth: 10 + 20 + 4 THAN and a 2 THAN repair; worth 900 + 900 + 4 × its ₹60 per THAN; 34 pieces went back.
        Assert.Equal([f.Parties.ToList().FindIndex(p => p.Name == "DASH A"), f.Months.ToList().IndexOf("2026-10"), 4, 36, 36, 1, 2, 2040, 34],
            f.Inward.Single(r => Name(r[0]) == "DASH A" && Month(r[1]) == "2026-10"));

        // Today's billing queue per party adds up to the dashboard's queue, ageing and review flags.
        var u = d.Unbilled;
        Assert.Equal(new WorkEstimate(u.ReadyEntries, u.ReadyThan, u.ReadyValue), Sum(f.Unbilled.Select(q => q.Ready)));
        Assert.Equal(new WorkEstimate(u.FactoryEntries, u.FactoryThan, u.FactoryValue), Sum(f.Unbilled.Select(q => q.Factory)));
        Assert.Equal((u.NoRateEntries, u.NoRateThan), (Sum(f.Unbilled.Select(q => q.NoRate)).Entries, Sum(f.Unbilled.Select(q => q.NoRate)).Than));
        Assert.Equal((u.OldEntries, u.OldValue), (Sum(f.Unbilled.Select(q => q.Old)).Entries, Sum(f.Unbilled.Select(q => q.Old)).Value));
        Assert.Equal(u.Ageing.Select(b => new WorkEstimate(b.Entries, b.Than, b.Value)), Enumerable.Range(0, 4).Select(i => Sum(f.Unbilled.Select(q => q.Ageing[i]))));
        Assert.Equal([d.Review.EarlierInward, d.Review.MissingRate, d.Review.DispatchIssue, d.Review.BeforeDispatch],
            [Sum(f.Unbilled.Select(q => q.EarlierInward)), Sum(f.Unbilled.Select(q => q.MissingRate)), Sum(f.Unbilled.Select(q => q.DispatchIssue)), Sum(f.Unbilled.Select(q => q.BeforeDispatch))]);
        Assert.Equal(d.UnbilledParties.Select(p => (p.Party, p.Entries, p.Than, p.Value, p.Oldest, p.DaysWaiting, p.FactoryThan, p.FactoryValue)),
            f.Unbilled.GroupBy(q => Name(q.Party)).Select(g => (Party: g.Key, Ready: Sum(g.Select(q => q.Ready)), Oldest: g.Select(q => q.Oldest).Where(o => o is not null).Min() ?? string.Empty,
                    DaysWaiting: g.Max(q => q.DaysWaiting), Factory: Sum(g.Select(q => q.Factory))))
                .OrderByDescending(p => p.Ready.Value).ThenByDescending(p => p.Ready.Than).ThenByDescending(p => p.Factory.Value).ThenBy(p => p.Party, StringComparer.OrdinalIgnoreCase)
                .Select(p => (p.Party, p.Ready.Entries, p.Ready.Than, p.Ready.Value, p.Oldest, p.DaysWaiting, p.Factory.Than, p.Factory.Value)));
        // Earlier inward is measured against the last billing run of all parties, so DASH QUIET's September cloth counts too.
        Assert.Equal(new WorkEstimate(1, 90, 810), f.Unbilled.Single(q => Name(q.Party) == "DASH QUIET").EarlierInward);

        Assert.Equal(d.Stock.Total, Sum(f.Stock.Select(s => s.Total)));
        Assert.Equal(d.Stock.Unbilled, Sum(f.Stock.Select(s => s.Unbilled)));
        Assert.Equal(2, f.Stock.Single(s => Name(s.Party) == "DASH A").Total.Pieces);
        Assert.Equal(d.QuietParties.Select(q => new FactsQuiet(f.Parties.ToList().FindIndex(p => p.Name == q.Party), q.UsualThan, q.RecentThan, q.LastInward, q.DaysSinceLast)), f.Quiet);
        Assert.Equal(("2026-11", "2026-11-10", false), (f.ThisMonth.Month, f.ThisMonth.UpTo, f.ThisMonth.Comparable));
        Assert.Empty(f.ThisMonth.SameDaysLastMonth);

        // Unchanged data answers 304, so the screen's refresh costs nothing; a new entry changes the answer.
        Assert.Equal(HttpStatusCode.NotModified, await FactsStatus(app, tag));
        await Add(app, Entry(9, "DASH B", "F1", 2, "2026-11-11", null));
        Assert.Equal(HttpStatusCode.OK, await FactsStatus(app, tag));
        var (after, newTag) = await Facts(app);
        Assert.NotEqual(tag, newTag);
        Assert.Equal(3, Total(after.Inward.Where(r => after.Parties[(int)r[0]].Name == "DASH B" && after.Months[(int)r[1]] == "2026-11"), 2, 7)[1]);
    }

    [Fact]
    public async Task Facts_count_pieces_sent_back_and_compare_the_same_days_of_last_month()
    {
        using var isolated = new DashboardApiFactory();
        var app = isolated.App();
        await Setup.Basics(app);
        await app.Post("/api/masters/party", Setup.Party("STOCK", discount: 0)).Ok();
        await app.Post("/api/masters/party", Setup.Party("EARLY", beforeDispatch: true, discount: 0)).Ok();
        await app.Put("/api/masters/party/rate", new { party = "STOCK", finish = "F1", rate = 100 }).Ok();
        await app.Put("/api/masters/party/rate", new { party = "EARLY", finish = "F1", rate = 100 }).Ok();
        await Add(app, Entry(81, "STOCK", "F1", 10, "2026-10-10", "2026-10-12", tp: 2, twoPart: 3, dispatchQty: 8));
        await Add(app, Entry(82, "STOCK", "F1", 8, "2026-10-12", "2026-10-14", dispatchQty: 5));
        await Add(app, Entry(83, "EARLY", "F1", 6, "2026-10-13", null, tp: 1));
        await Add(app, Entry(84, "STOCK", "", 4, "2026-11-12", null, repair: true));
        await Add(app, Entry(85, "STOCK", "F1", 3, "2026-11-12", "2026-11-25"));
        await Add(app, Entry(86, "STOCK", "F1", 9, "2026-11-25", null));
        var (f, _) = await Facts(app);
        var d = await Dashboard(app);
        int P(string name) => f.Parties.ToList().FindIndex(p => p.Name == name);
        int M(string month) => f.Months.ToList().IndexOf(month);

        // Pieces = THAN + TP + TWO PART; the dispatch dated after today and the entry dated after today are not counted yet.
        Assert.Equal(
            [[P("EARLY"), M("2026-10"), 1, 6, 7, 0, 0, 600, 0], [P("STOCK"), M("2026-10"), 2, 18, 23, 0, 0, 1800, 13], [P("STOCK"), M("2026-11"), 2, 7, 7, 1, 4, 300, 0]],
            f.Inward);
        Assert.Equal(d.Stock.Total, Sum(f.Stock.Select(s => s.Total)));
        Assert.Equal([d.Stock.Unbilled, d.Stock.BeforeDispatch, d.Stock.Billed, d.Stock.Repairs, d.Stock.NoBill],
            [Sum(f.Stock.Select(s => s.Unbilled)), Sum(f.Stock.Select(s => s.BeforeDispatch)), Sum(f.Stock.Select(s => s.Billed)), Sum(f.Stock.Select(s => s.Repairs)), Sum(f.Stock.Select(s => s.NoBill))]);
        Assert.Equal(("2026-11", "2026-11-12", true), (f.ThisMonth.Month, f.ThisMonth.UpTo, f.ThisMonth.Comparable));
        Assert.Equal([new FactsPartyCount(P("STOCK"), 2, 18)], f.ThisMonth.SameDaysLastMonth);
        Assert.Equal(d.ThisMonth.LastMonthSameDaysThan, f.ThisMonth.SameDaysLastMonth.Sum(c => c.Than));
    }

    [Fact]
    public async Task Facts_do_not_count_work_carried_in_from_before_the_register_as_cloth_received_that_month()
    {
        using var isolated = new DashboardApiFactory();
        var app = isolated.App();
        await Setup.Basics(app);
        await app.Post("/api/masters/party", Setup.Party("OPENING", discount: 0)).Ok();
        await app.Put("/api/masters/party/rate", new { party = "OPENING", finish = "F1", rate = 100 }).Ok();
        static object Carried(int inward, string date, string sent) => new
        {
            registerMonth = "2026-04", inwardNo = inward, entryDate = date, party = "OPENING", designNo = "", lotNo = "", repair = false, than = 10, tp = 0, twoPart = 0,
            finish = "F1", carriedOver = true, dispatches = new[] { new DispatchBody(4, "GP", sent) },
        };
        await Add(app, Carried(1, "2026-03-20", "2026-03-25"));
        await Add(app, Entry(2, "OPENING", "F1", 5, "2026-04-02", "2026-04-03"));
        var (f, _) = await Facts(app);
        int M(string month) => f.Months.ToList().IndexOf(month);

        // March holds only what was carried in: nothing was received or sent back in March, and the work left counts in April.
        Assert.DoesNotContain(f.Inward, r => r[1] == M("2026-03"));
        Assert.Equal([[0, M("2026-04"), 1, 5, 5, 0, 0, 500, 5]], f.Inward);
        Assert.Equal([M("2026-04")], f.Unbilled.Select(q => (long)q.Month).Distinct());
        Assert.Equal(new WorkEstimate(2, 15, 1500), Sum(f.Unbilled.Select(q => q.Ready)));
        Assert.Equal([M("2026-04")], f.Stock.Select(s => (long)s.Month));
        Assert.Equal(6, Sum(f.Stock.Select(s => s.Total)).Pieces);
    }
}
