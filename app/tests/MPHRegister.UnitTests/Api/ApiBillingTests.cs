using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using MPHRegister.Shared.Configuration;
using static MPHRegister.UnitTests.Api.Http;

namespace MPHRegister.UnitTests.Api;

[Collection("api")]
public sealed class ApiBillingTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private async Task<HttpClient> Ready()
    {
        var app = factory.App();
        if (factory.ConfigOnDisk.Finishes.Count != 0) return app;
        await Setup.Basics(app);
        var settings = await app.Get("/api/settings").Ok();
        var rules = settings.GetProperty("billRules").Deserialize<BillRules>(Shared.Json.JsonDefaults.Options)! with
        {
            NumberPrefix = "{FY}\\T\\", TotalMustStayBelow = 200000, RowsPerBill = 25, CombineSmallBelowThan = 5, CombineUpTo = 4, CgstPercent = 2.5m, SgstPercent = 2.5m, IgstPercent = 5,
        };
        await app.Put("/api/settings", new { firm = new FirmProfile { Name = "TEST FIRM", HomeStateCode = "08", HomeStateName = "HOME STATE" }, billRules = rules }).Ok();
        return app;
    }

    private static async Task<JsonElement> Candidates(HttpClient app, string party) => await app.Get($"/api/billing/candidates?party={Q(party)}&from=2026-10-01&to=2026-10-31").Ok();

    private static List<long> Ticked(JsonElement candidates) =>
        candidates.GetProperty("entries").EnumerateArray().Where(e => e.GetProperty("selected").GetBoolean()).Select(e => e.GetProperty("entryId").GetInt64()).ToList();

    private static async Task<JsonElement> Build(HttpClient app, string party, IEnumerable<long> ids) =>
        await app.Post("/api/billing/build", new { party, month = "2026-10", entryIds = ids, billDate = "2026-10-31", periodFrom = "2026-10-01", periodTo = "2026-10-31" }).Ok();

    [Fact]
    public async Task Bills_are_made_saved_numbered_edited_and_cancelled()
    {
        var app = await Ready();
        await app.Post("/api/masters/party", Setup.Party("BILL PARTY")).Ok();
        await app.Put("/api/masters/party/rate", new { party = "BILL PARTY", finish = "F1", rate = 100 }).Ok();
        await app.Put("/api/masters/party/rate", new { party = "BILL PARTY", finish = "F2", rate = 50 }).Ok();
        foreach (var (inward, finish, than, sent) in new[] { (11, "F1", 10, true), (12, "F1", 12, true), (13, "F1", 8, true), (14, "F2", 10, true), (15, "F1", 6, false) })
            await app.Post("/api/entries", Setup.Entry(inward, "BILL PARTY", finish, than, dn: $"D{inward}", lot: $"L{inward}", dispatched: sent, gatePass: $"GP{inward}")).Ok();

        var toBill = await app.Get("/api/billing/parties?from=2026-10-01&to=2026-10-31").Ok();
        var row = toBill.EnumerateArray().Single(p => p.GetProperty("party").GetString() == "BILL PARTY");
        Assert.Equal((5, 46, 1), (row.GetProperty("entries").GetInt32(), row.GetProperty("nettThan").GetInt32(), row.GetProperty("notDispatched").GetInt32()));

        var candidates = await Candidates(app, "bill party");
        Assert.Equal("BILL PARTY", candidates.GetProperty("billParty").GetString());
        Assert.Equal(["BILL PARTY"], candidates.GetProperty("billRecipients").EnumerateArray().Select(p => p.GetString()));
        Assert.Equal("GATE PASS STYLE", candidates.GetProperty("style").GetProperty("name").GetString());
        var ticked = Ticked(candidates);
        Assert.Equal(4, ticked.Count);

        var count = await app.Post("/api/billing/count", new { party = "BILL PARTY", entryIds = ticked }).Ok();
        Assert.Equal(1, count.GetInt32());
        var none = await app.Post("/api/billing/count", new { party = "BILL PARTY", entryIds = Array.Empty<long>() }).Ok();
        Assert.Equal(0, none.GetInt32());

        var drafts = await Build(app, "BILL PARTY", ticked);
        var draft = Assert.Single(drafts.EnumerateArray());
        var lines = draft.GetProperty("lines").EnumerateArray().ToList();
        Assert.Equal(["priced", "blank", "detail", "detail", "detail", "priced"], lines.Select(l => l.GetProperty("kind").GetString()));
        Assert.Equal(("GP14", "F2", 10, 500L), (lines[0].GetProperty("gpn").GetString(), lines[0].GetProperty("finish").GetString(), lines[0].GetProperty("qty").GetInt32(), lines[0].GetProperty("amount").GetInt64()));
        Assert.Equal((30, 3000L), (lines[5].GetProperty("qty").GetInt32(), lines[5].GetProperty("amount").GetInt64()));
        Assert.Equal((3500L, 350L, 3150L, 79L, 79L, 3308L), (draft.GetProperty("gross").GetInt64(), draft.GetProperty("discount").GetInt64(), draft.GetProperty("taxable").GetInt64(),
            draft.GetProperty("cgst").GetInt64(), draft.GetProperty("sgst").GetInt64(), draft.GetProperty("total").GetInt64()));
        Assert.Contains("Three Thousand", draft.GetProperty("amountInWords").GetString(), StringComparison.Ordinal);

        var saved = await app.Post("/api/billing/save", new { invoices = new[] { draft } }).Ok();
        var bill = Assert.Single(saved.EnumerateArray());
        Assert.Equal("26-27\\T\\1", bill.GetProperty("invoiceNo").GetString());
        var id = bill.GetProperty("id").GetInt64();
        Assert.Equal(2, (await app.Get("/api/settings?fy=26-27").Ok()).GetProperty("nextSerial").GetInt32());
        Assert.Equal("TEST FIRM", bill.GetProperty("firm").GetProperty("firmName").GetString());
        Assert.Equal("TAX INVOICE", bill.GetProperty("firm").GetProperty("texts").GetProperty("title").GetString());

        var twice = await app.Post("/api/billing/save", new { invoices = new[] { draft } }).Refused();
        Assert.Contains(twice, e => e.Contains("already billed", StringComparison.Ordinal));
        var left = Ticked(await Candidates(app, "BILL PARTY"));
        Assert.Empty(left);
        Assert.Single((await Candidates(app, "BILL PARTY")).GetProperty("entries").EnumerateArray());

        var editLines = bill.GetProperty("lines").EnumerateArray().Select(l => l.Deserialize<Dictionary<string, object?>>()!).ToList();
        editLines.RemoveAt(2);
        var edited = await app.Put($"/api/invoices/{id}", new { billDate = "2026-10-31", periodFrom = "2026-10-01", periodTo = "2026-10-31", notes = "fixed", refreshParty = false, lines = editLines }).Ok();
        Assert.Equal(2000L + 500 - 250 + 56 + 56, edited.GetProperty("total").GetInt64());
        Assert.Equal(2, (await Candidates(app, "BILL PARTY")).GetProperty("entries").GetArrayLength());
        var wrongYear = await app.Put($"/api/invoices/{id}", new { billDate = "2027-04-01", periodFrom = "2026-10-01", periodTo = "2026-10-31", lines = editLines }).Refused();
        Assert.Contains(wrongYear, e => e.Contains("must stay in financial year 26-27", StringComparison.Ordinal));

        var cancelled = await app.Post($"/api/invoices/{id}/cancel", new { }).Ok();
        Assert.Equal("cancelled", cancelled.GetProperty("status").GetString());
        Assert.Equal(5, (await Candidates(app, "BILL PARTY")).GetProperty("entries").GetArrayLength());
        Assert.Equal(2, (await app.Get("/api/settings?fy=26-27").Ok()).GetProperty("nextSerial").GetInt32());
        await app.Post($"/api/invoices/{id}/cancel", new { }).Refused();
        var serialUsed = await app.Put("/api/settings", new { fy = "26-27", nextSerial = 1 }).Refused();
        Assert.Contains(serialUsed, e => e.Contains("already used", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Z_draft_discount_can_be_overridden_and_saved()
    {
        var app = await Ready();
        await app.Post("/api/masters/party", Setup.Party("DISCOUNT PARTY", discount: 0)).Ok();
        await app.Put("/api/masters/party/rate", new { party = "DISCOUNT PARTY", finish = "F1", rate = 100 }).Ok();
        var entry = await app.Post("/api/entries", Setup.Entry(701, "DISCOUNT PARTY", than: 10, month: "2027-04")).Ok();
        var draft = Assert.Single((await app.Post("/api/billing/build", new
        {
            party = "DISCOUNT PARTY", month = "2027-04", entryIds = new[] { entry.GetProperty("id").GetInt64() },
            billDate = "2027-04-30", periodFrom = "2027-04-01", periodTo = "2027-04-30",
        }).Ok()).EnumerateArray());
        var edited = draft.Deserialize<Dictionary<string, object?>>()!;
        edited["discountPct"] = 12.5m;

        var computed = await app.Post("/api/billing/compute", edited).Ok();
        Assert.Equal(125L, computed.GetProperty("discount").GetInt64());

        var invalid = draft.Deserialize<Dictionary<string, object?>>()!;
        invalid["discountPct"] = 100.01m;
        var computeErrors = await app.Post("/api/billing/compute", invalid).Refused(HttpStatusCode.BadRequest);
        Assert.Contains("Discount must be between 0 and 100.", computeErrors);
        var saveErrors = await app.Post("/api/billing/save", new { invoices = new[] { invalid } }).Refused(HttpStatusCode.BadRequest);
        Assert.Contains("Discount must be between 0 and 100.", saveErrors);

        var saved = Assert.Single((await app.Post("/api/billing/save", new { invoices = new[] { edited } }).Ok()).EnumerateArray());
        Assert.Equal(12.5m, saved.GetProperty("discountPct").GetDecimal());
        Assert.Equal(125L, saved.GetProperty("discount").GetInt64());
    }

    [Fact]
    public async Task A_draft_can_bill_a_sister_firm_but_not_an_unrelated_party()
    {
        var app = await Ready();
        await app.Post("/api/masters/party", Setup.Party("SOURCE FIRM", sisterGroup: "FIRMS", discount: 0)).Ok();
        await app.Post("/api/masters/party", Setup.Party("RECIPIENT FIRM", sisterGroup: "FIRMS", discount: 20)).Ok();
        await app.Post("/api/masters/party", Setup.Party("OTHER FIRM")).Ok();
        await app.Put("/api/masters/party/rate", new { party = "SOURCE FIRM", finish = "F1", rate = 100 }).Ok();
        await app.Put("/api/masters/party/rate", new { party = "RECIPIENT FIRM", finish = "F1", rate = 200 }).Ok();
        var entry = await app.Post("/api/entries", Setup.Entry(1301, "SOURCE FIRM", than: 10)).Ok();
        var id = entry.GetProperty("id").GetInt64();
        var candidates = await Candidates(app, "SOURCE FIRM");
        Assert.Equal(["SOURCE FIRM", "RECIPIENT FIRM"], candidates.GetProperty("billRecipients").EnumerateArray().Select(p => p.GetString()));
        Assert.Empty((await Candidates(app, "RECIPIENT FIRM")).GetProperty("entries").EnumerateArray());
        var draft = Assert.Single((await Build(app, "SOURCE FIRM", [id])).EnumerateArray());
        await app.Post($"/api/billing/compute?recipient={Q("OTHER FIRM")}", draft).Refused();
        var forged = draft.Deserialize<Dictionary<string, object?>>()!;
        forged["party"] = "OTHER FIRM";
        await app.Post("/api/billing/save", new { invoices = new[] { forged } }).Refused();
        var chosen = await app.Post($"/api/billing/compute?recipient={Q("RECIPIENT FIRM")}", draft).Ok();
        Assert.Equal("RECIPIENT FIRM", chosen.GetProperty("partyName").GetString());
        Assert.Equal(2000, chosen.GetProperty("gross").GetInt64());
        Assert.Equal(400, chosen.GetProperty("discount").GetInt64());
        var saved = Assert.Single((await app.Post("/api/billing/save", new { invoices = new[] { chosen } }).Ok()).EnumerateArray());
        Assert.Equal("RECIPIENT FIRM", saved.GetProperty("party").GetString());
        Assert.Empty((await Candidates(app, "SOURCE FIRM")).GetProperty("entries").EnumerateArray());
        Assert.Equal("SOURCE FIRM", (await app.Get($"/api/entries/{id}").Ok()).GetProperty("party").GetString());
    }

    [Fact]
    public async Task A_month_bill_can_take_entries_of_a_wider_window_while_printing_the_calendar_month()
    {
        var app = await Ready();
        await app.Post("/api/masters/party", Setup.Party("WINDOW PARTY")).Ok();
        await app.Put("/api/masters/party/rate", new { party = "WINDOW PARTY", finish = "F1", rate = 10 }).Ok();
        foreach (var (inward, date) in new[] { (901, "2026-09-25"), (902, "2026-09-26"), (903, "2026-10-25"), (904, "2026-10-26") })
            await app.Post("/api/entries", new { registerMonth = "2026-10", inwardNo = inward, entryDate = date, party = "WINDOW PARTY", designNo = "", lotNo = "", repair = false, than = 10, tp = 0, twoPart = 0, finish = "F1", dispatches = Array.Empty<DispatchBody>() }).Ok();
        var window = (await app.Get($"/api/billing/candidates?party={Q("WINDOW PARTY")}&from=2026-09-26&to=2026-10-25").Ok()).GetProperty("entries").EnumerateArray().ToList();
        var offered = window.ToDictionary(e => e.GetProperty("inwardNo").GetInt32(), e => e.GetProperty("entryId").GetInt64());
        // 901 came in the day before the window but is still in stock, so it comes along (marked as from stock).
        Assert.Equal([901, 902, 903], offered.Keys.Order());
        Assert.Equal([901], window.Where(e => e.GetProperty("fromStock").GetBoolean()).Select(e => e.GetProperty("inwardNo").GetInt32()));

        object Request(params int[] inwards) => new
        {
            party = "WINDOW PARTY", month = "2026-10", entryIds = inwards.Select(i => offered[i]), billDate = "2026-10-31",
            periodFrom = "2026-10-01", periodTo = "2026-10-31", entriesFrom = "2026-09-26", entriesTo = "2026-10-25",
        };
        var bill = Assert.Single((await app.Post("/api/billing/build", Request(902, 903)).Ok()).EnumerateArray());
        Assert.Equal(("2026-10-01", "2026-10-31", 20), (bill.GetProperty("periodFrom").GetString(), bill.GetProperty("periodTo").GetString(), bill.GetProperty("than").GetInt32()));

        var all = await app.Get($"/api/billing/candidates?party={Q("WINDOW PARTY")}&from=2026-09-01&to=2026-10-31").Ok();
        var outside = all.GetProperty("entries").EnumerateArray().Single(e => e.GetProperty("inwardNo").GetInt32() == 904).GetProperty("entryId").GetInt64();
        var refused = await app.Post("/api/billing/build", new { party = "WINDOW PARTY", month = "2026-10", entryIds = new[] { outside }, billDate = "2026-10-31", periodFrom = "2026-10-01", periodTo = "2026-10-31", entriesFrom = "2026-09-26", entriesTo = "2026-10-25" }).Refused();
        Assert.Contains("Some ticked entries have an inward date outside the bill period. Refresh the list.", refused);
        Assert.Contains("Bill period 'to' date is before the 'from' date.", await app.Post("/api/billing/build", new { party = "WINDOW PARTY", month = "2026-10", entryIds = new[] { outside }, billDate = "2026-10-31", periodFrom = "2026-10-01", periodTo = "2026-10-31", entriesFrom = "2026-10-25", entriesTo = "2026-09-26" }).Refused());
    }

    [Fact]
    public async Task Only_entries_with_an_inward_date_in_the_bill_period_are_offered_and_billed()
    {
        var app = await Ready();
        await app.Post("/api/masters/party", Setup.Party("PERIOD PARTY")).Ok();
        await app.Put("/api/masters/party/rate", new { party = "PERIOD PARTY", finish = "F1", rate = 10 }).Ok();
        foreach (var (inward, month) in new[] { (301, "2026-09"), (302, "2026-10"), (303, "2026-11") })
            await app.Post("/api/entries", Setup.Entry(inward, "PERIOD PARTY", month: month)).Ok();

        async Task<List<(int Inward, long Id)>> Offered(string from, string to) =>
            [.. (await app.Get($"/api/billing/candidates?party={Q("PERIOD PARTY")}&from={from}&to={to}").Ok()).GetProperty("entries").EnumerateArray()
                .Select(e => (e.GetProperty("inwardNo").GetInt32(), e.GetProperty("entryId").GetInt64()))];
        var october = await Offered("2026-10-01", "2026-10-31");
        Assert.Equal([302], october.Select(e => e.Inward));
        Assert.Equal([301, 302], (await Offered("2026-09-02", "2026-10-02")).Select(e => e.Inward));
        // 302 came in on the 2nd and was sent on the 3rd: still in stock when a period from the 3rd begins, so it comes along.
        Assert.Equal([302], (await Offered("2026-10-03", "2026-11-01")).Select(e => e.Inward));
        Assert.Empty(await Offered("2026-10-04", "2026-11-01"));

        var row = (await app.Get("/api/billing/parties?from=2026-10-01&to=2026-10-31").Ok()).EnumerateArray().Single(p => p.GetProperty("party").GetString() == "PERIOD PARTY");
        Assert.Equal((1, 10), (row.GetProperty("entries").GetInt32(), row.GetProperty("nettThan").GetInt32()));
        Assert.DoesNotContain((await app.Get("/api/billing/parties?from=2026-12-01&to=2026-12-31").Ok()).EnumerateArray(), p => p.GetProperty("party").GetString() == "PERIOD PARTY");

        var september = Assert.Single(await Offered("2026-09-01", "2026-09-30")).Id;
        var outside = await app.Post("/api/billing/build", new { party = "PERIOD PARTY", month = "2026-10", entryIds = new[] { september, october[0].Id }, billDate = "2026-10-31", periodFrom = "2026-10-01", periodTo = "2026-10-31" }).Refused();
        Assert.Contains("Some ticked entries have an inward date outside the bill period. Refresh the list.", outside);
        Assert.Equal(10, Assert.Single((await Build(app, "PERIOD PARTY", [october[0].Id])).EnumerateArray()).GetProperty("than").GetInt32());

        Assert.Contains("Bill period 'to' date is before the 'from' date.", await app.Get("/api/billing/parties?from=2026-10-31&to=2026-10-01").Refused());
        Assert.Contains("Enter a valid bill period (from and to).", await app.Get($"/api/billing/candidates?party={Q("PERIOD PARTY")}&from=2026-10-01").Refused());
    }

    [Fact]
    public async Task All_zero_slip_is_saved_without_a_finish_shown_last_party_wise_and_never_billed()
    {
        var app = await Ready();
        await app.Post("/api/masters/party", Setup.Party("ZERO PARTY")).Ok();
        await app.Post("/api/entries", Setup.Entry(401, "ZERO PARTY")).Ok();
        var slip = await app.Post("/api/entries", new { registerMonth = "2026-10", inwardNo = 402, entryDate = "2026-10-02", party = "ZERO PARTY", designNo = "INW 547", than = 0, finish = "" }).Ok();
        Assert.Equal(("allZero", "", 0), (slip.GetProperty("status").GetString(), slip.GetProperty("finish").GetString(), slip.GetProperty("warnings").GetArrayLength()));

        var partyWise = await app.Get($"/api/partywise?month=2026-10&party={Q("ZERO PARTY")}").Ok();
        Assert.Equal([401, 402], partyWise.EnumerateArray().Select(e => e.GetProperty("inwardNo").GetInt32()));
        Assert.Equal([401], (await Candidates(app, "ZERO PARTY")).GetProperty("entries").EnumerateArray().Select(e => e.GetProperty("inwardNo").GetInt32()));

        var withDispatch = await app.Put($"/api/entries/{slip.GetProperty("id").GetInt64()}", new
        {
            registerMonth = "2026-10", inwardNo = 402, entryDate = "2026-10-02", party = "ZERO PARTY", than = 0, finish = "",
            dispatches = new[] { new DispatchBody(1, "G1", "2026-10-03") },
        }).Refused();
        Assert.Contains("THAN + TP must be more than 0.", withDispatch);
    }

    [Fact]
    public async Task Parties_that_want_bills_before_dispatch_get_undispatched_entries_ticked()
    {
        var app = await Ready();
        await app.Post("/api/masters/party", Setup.Party("EARLY PARTY", beforeDispatch: true)).Ok();
        await app.Put("/api/masters/party/rate", new { party = "EARLY PARTY", finish = "F1", rate = 10 }).Ok();
        await app.Post("/api/entries", Setup.Entry(21, "EARLY PARTY", dispatched: false)).Ok();
        var candidates = await Candidates(app, "EARLY PARTY");
        Assert.True(candidates.GetProperty("billBeforeDispatch").GetBoolean());
        Assert.Single(Ticked(candidates));
        var draft = (await Build(app, "EARLY PARTY", Ticked(candidates))).EnumerateArray().Single();
        Assert.Contains(draft.GetProperty("warnings").EnumerateArray(), w => w.GetString()!.Contains("billed before dispatch", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Long_design_number_lists_take_two_rows_and_bills_still_hold_at_most_their_rows()
    {
        var app = await Ready();
        await app.Post("/api/masters/style", new { name = "DN ONLY", gpnColumn = "blank", dnColumn = "designNo", lotColumn = "blank", lines = "onePerEntry", order = "inward", showQuantityBreakdown = false, combineSmallEntries = true }).Ok();
        await app.Post("/api/masters/party", Setup.Party("SMALL LOTS", style: "DN ONLY")).Ok();
        await app.Put("/api/masters/party/rate", new { party = "SMALL LOTS", finish = "F1", rate = 10 }).Ok();
        for (var i = 0; i < 80; i++) await app.Post("/api/entries", Setup.Entry(100 + i, "SMALL LOTS", than: 2, dn: (13000 + i).ToString(System.Globalization.CultureInfo.InvariantCulture))).Ok();
        var drafts = await Build(app, "SMALL LOTS", Ticked(await Candidates(app, "SMALL LOTS")));
        var bills = drafts.EnumerateArray().ToList();
        Assert.Contains(bills.SelectMany(b => b.GetProperty("lines").EnumerateArray()), l => l.GetProperty("rows").GetInt32() == 2);
        Assert.All(bills, b => Assert.True(b.GetProperty("lines").EnumerateArray().Sum(l => l.GetProperty("rows").GetInt32()) <= 25));
        Assert.Equal(160, bills.Sum(b => b.GetProperty("than").GetInt32()));

        var tooTall = bills[0].Deserialize<Dictionary<string, object?>>()!;
        var lines = bills[0].GetProperty("lines").EnumerateArray().Select(l => l.Deserialize<Dictionary<string, object?>>()!).ToList();
        while (lines.Count < 30) lines.Insert(0, new Dictionary<string, object?> { ["kind"] = "detail", ["dn"] = "1", ["qty"] = 0, ["entryIds"] = Array.Empty<long>() });
        tooTall["lines"] = lines;
        var refused = await app.Post("/api/billing/save", new { invoices = new[] { tooTall } }).Refused();
        Assert.Contains(refused, e => e.Contains("printed rows", StringComparison.Ordinal) && e.Contains("a bill holds 25", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Rows_per_bill_can_grow_only_as_far_as_the_paper_allows()
    {
        var app = await Ready();
        var settings = await app.Get("/api/settings").Ok();
        var limits = settings.GetProperty("limits");
        var letter = limits.GetProperty("maxRowsLetter").GetInt32();
        var a4 = limits.GetProperty("maxRowsA4").GetInt32();
        Assert.True(letter > 25 && a4 > letter);
        var rules = settings.GetProperty("billRules").Deserialize<BillRules>(Shared.Json.JsonDefaults.Options)!;
        var print = settings.GetProperty("print").Deserialize<PrintSettings>(Shared.Json.JsonDefaults.Options)!;

        await app.Put("/api/settings", new { billRules = rules with { RowsPerBill = letter } }).Ok();
        var refused = await app.Put("/api/settings", new { billRules = rules with { RowsPerBill = letter + 1 } }).Refused();
        Assert.Contains(refused, e => e.Contains($"At most {letter} rows fit on a Letter bill", StringComparison.Ordinal));
        await app.Put("/api/settings", new { billRules = rules with { RowsPerBill = a4 }, print = print with { PaperSize = Shared.Enums.PaperSize.A4 } }).Ok();
        Assert.Contains(await app.Put("/api/settings", new { print = print with { PaperSize = Shared.Enums.PaperSize.Letter } }).Refused(), e => e.Contains("Letter", StringComparison.Ordinal));
        var smaller = await app.Put("/api/settings", new { print = print with { PaperSize = Shared.Enums.PaperSize.A4, SmallestFontPt = 6 } }).Ok();
        Assert.True(smaller.GetProperty("limits").GetProperty("maxRows").GetInt32() > a4);
        await app.Put("/api/settings", new { billRules = rules, print }).Ok();
        Assert.Equal(25, factory.ConfigOnDisk.BillRules.RowsPerBill);
    }
}

[Collection("api")]
public sealed class ApiSettingsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly byte[] Png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");

    [Fact]
    public async Task A_section_saved_alone_leaves_the_others_and_lands_in_the_config_file()
    {
        var app = factory.App();
        var before = factory.ConfigOnDisk;
        var saved = await app.Put("/api/settings", new { display = new DisplaySettings { Theme = Shared.Enums.UiTheme.Dark, ShowExcelImport = false } }).Ok();
        Assert.Equal("dark", saved.GetProperty("display").GetProperty("theme").GetString());
        var after = factory.ConfigOnDisk;
        Assert.Equal((Shared.Enums.UiTheme.Dark, false), (after.Display.Theme, after.Display.ShowExcelImport));
        Assert.Equal(before.BillRules, after.BillRules);
        Assert.Equal(before.Firm, after.Firm);
        var info = await app.Get("/api/info").Ok();
        Assert.Equal(("dark", false), (info.GetProperty("theme").GetString(), info.GetProperty("showExcelImport").GetBoolean()));
        await app.Put("/api/settings", new { display = new DisplaySettings() }).Ok();
    }

    [Fact]
    public async Task Printed_texts_and_firm_details_are_saved_and_used_for_new_bills()
    {
        var app = factory.App();
        await app.Put("/api/settings", new
        {
            firm = new FirmProfile { Name = "NEW FIRM", Gstin = "08testf9001j1zj", HomeStateCode = "08" },
            printedTexts = new PrintedTexts { Title = "BILL OF SUPPLY", Terms = ["1. One", "2. Two"], SignatureLabel = "Signed" },
        }).Ok();
        var context = await app.Get("/api/settings/print-context").Ok();
        Assert.Equal("NEW FIRM", context.GetProperty("firm").GetProperty("firmName").GetString());
        Assert.Equal("08TESTF9001J1ZJ", context.GetProperty("firm").GetProperty("gstin").GetString());
        Assert.Equal("BILL OF SUPPLY", context.GetProperty("texts").GetProperty("title").GetString());
        Assert.Equal("1. One\n2. Two", context.GetProperty("firm").GetProperty("terms").GetString());
        Assert.Equal("Signed", factory.ConfigOnDisk.PrintedTexts.SignatureLabel);
        Assert.Contains(await app.Put("/api/settings", new { firm = new FirmProfile { Name = "X", HomeStateCode = "8" } }).Refused(), e => e.Contains("2 digits", StringComparison.Ordinal));
    }

    [Fact]
    public async Task The_signature_is_kept_in_the_config_file()
    {
        var app = factory.App();
        using var form = new MultipartFormDataContent();
        var picture = new ByteArrayContent(Png);
        picture.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        form.Add(picture, "file", "sign.png");
        var saved = await app.PutAsync(new Uri("/api/settings/signature", UriKind.Relative), form).Ok();
        Assert.True(saved.GetProperty("hasSignature").GetBoolean());
        Assert.StartsWith("data:image/png;base64,", factory.ConfigOnDisk.Signature, StringComparison.Ordinal);
        using (var image = await app.Get("/api/settings/signature"))
        {
            Assert.Equal("image/png", image.Content.Headers.ContentType?.MediaType);
            Assert.Equal(Png, await image.Content.ReadAsByteArrayAsync());
        }
        using var bad = new MultipartFormDataContent { { new ByteArrayContent([1, 2, 3]), "file", "x.png" } };
        Assert.Contains("The signature must be a PNG or JPG picture.", await app.PutAsync(new Uri("/api/settings/signature", UriKind.Relative), bad).Refused());
        await app.Delete("/api/settings/signature").Ok();
        Assert.Null(factory.ConfigOnDisk.Signature);
        await app.Get("/api/settings/signature").Refused(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_config_file_changed_outside_the_app_is_read_again_and_a_broken_one_is_reported()
    {
        var app = factory.App();
        var config = factory.ConfigOnDisk;
        await File.WriteAllTextAsync(factory.ConfigPath, ConfigJson.Serialize(config with { Parties = [.. config.Parties, new PartyConfig { Name = "TYPED IN NOTEPAD", Color = "black" }] }));
        File.SetLastWriteTimeUtc(factory.ConfigPath, DateTime.UtcNow.AddSeconds(2));
        await app.Post("/api/settings/reload", new { }).Ok();
        var masters = await app.Get("/api/masters").Ok();
        Assert.Contains(masters.GetProperty("parties").EnumerateArray(), p => p.GetProperty("name").GetString() == "TYPED IN NOTEPAD");

        await File.WriteAllTextAsync(factory.ConfigPath, "{ \"parties\": [ oops");
        File.SetLastWriteTimeUtc(factory.ConfigPath, DateTime.UtcNow.AddSeconds(4));
        var settings = await app.Post("/api/settings/reload", new { }).Ok();
        Assert.Contains("mistake", settings.GetProperty("configFile").GetProperty("problem").GetString(), StringComparison.Ordinal);
        var info = await app.Get("/api/info").Ok();
        Assert.False(string.IsNullOrEmpty(info.GetProperty("configProblem").GetString()));
        Assert.Contains((await app.Get("/api/masters").Ok()).GetProperty("parties").EnumerateArray(), p => p.GetProperty("name").GetString() == "TYPED IN NOTEPAD");

        await app.Post("/api/masters/color", new { name = "teal", hex = "#008080" }).Ok();
        Assert.Contains(factory.ConfigOnDisk.Colors, c => c.Name == "teal");
        Assert.NotEmpty(Directory.GetFiles(Path.Combine(factory.DataDirectory, "backups"), "mph-config-*-unreadable.json"));
        Assert.Equal(JsonValueKind.Null, (await app.Get("/api/info").Ok()).GetProperty("configProblem").ValueKind);
    }

    [Fact]
    public async Task The_print_page_gets_colours_for_parties_and_finishes()
    {
        var app = factory.App();
        await app.Post("/api/masters/color", new { name = "brick", hex = "#aa4422" }).Ok();
        await app.Post("/api/masters/party", new { name = "PAINTED", active = true, color = "brick" }).Ok();
        var context = await app.Get("/api/settings/print-context").Ok();
        Assert.Equal("#aa4422", context.GetProperty("colors").GetProperty("brick").GetString());
        Assert.Equal("#aa4422", context.GetProperty("partyColors").GetProperty("painted").GetString());
    }
}
