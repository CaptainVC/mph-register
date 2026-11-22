using System.Text.Json;
using static MPHRegister.UnitTests.Api.Http;

namespace MPHRegister.UnitTests.Api;

[Collection("api")]
public sealed class ApiBillNumberTests
{
    private static async Task<HttpClient> Ready(ApiFactory factory)
    {
        var app = factory.App();
        await Setup.Basics(app);
        await app.Put("/api/settings", new { fy = "26-27", nextSerial = 40 }).Ok();
        foreach (var party in new[] { "NUM A", "NUM B" })
        {
            await app.Post("/api/masters/party", Setup.Party(party, beforeDispatch: true, discount: 0, gstin: "")).Ok();
            await app.Put("/api/masters/party/rate", new { party, finish = "F1", rate = 100 }).Ok();
        }
        return app;
    }

    private static async Task<JsonElement> Draft(HttpClient app, string party, int inward)
    {
        var entry = await app.Post("/api/entries", Setup.Entry(inward, party, month: "2026-10")).Ok();
        var drafts = await app.Post("/api/billing/build", new
        {
            party, month = "2026-10", entryIds = new[] { entry.GetProperty("id").GetInt64() },
            billDate = "2026-10-28", periodFrom = "2026-10-01", periodTo = "2026-10-28",
        }).Ok();
        return Assert.Single(drafts.EnumerateArray());
    }

    private static int Serial(JsonElement bill) => int.Parse(new string(bill.GetProperty("invoiceNo").GetString()!.Reverse().TakeWhile(char.IsDigit).Reverse().ToArray()));

    private static async Task<List<JsonElement>> Numbers(HttpClient app, params int?[] serials) =>
        (await app.Post("/api/billing/numbers", new { bills = serials.Select(s => new { billDate = "2026-10-28", serial = s }) }).Ok()).EnumerateArray().ToList();

    [Fact]
    public async Task Numbers_preview_the_next_free_numbers_in_order()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var numbers = await Numbers(app, null, null);
        Assert.Equal([40, 41], numbers.Select(Serial));
        Assert.All(numbers, n => Assert.Equal(JsonValueKind.Null, n.GetProperty("problem").ValueKind));
    }

    [Fact]
    public async Task Typed_number_is_kept_and_automatic_ones_step_around_it()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var numbers = await Numbers(app, null, 40, null);
        Assert.Equal([41, 40, 42], numbers.Select(Serial));
        Assert.All(numbers, n => Assert.Equal(JsonValueKind.Null, n.GetProperty("problem").ValueKind));
    }

    [Fact]
    public async Task Numbers_flag_a_clash_with_a_saved_bill_or_another_draft_and_save_refuses_them()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var first = await Draft(app, "NUM A", 1);
        var saved = Assert.Single((await app.Post("/api/billing/save", new { invoices = new[] { first } }).Ok()).EnumerateArray());
        Assert.Equal(40, Serial(saved));

        var numbers = await Numbers(app, 40, 55, 55, 0);
        Assert.Contains("already used", numbers[0].GetProperty("problem").GetString());
        Assert.Contains("more than one", numbers[1].GetProperty("problem").GetString());
        Assert.Contains("more than one", numbers[2].GetProperty("problem").GetString());
        Assert.Contains("between 1", numbers[3].GetProperty("problem").GetString());

        var second = await Draft(app, "NUM B", 2);
        var clash = await app.Post("/api/billing/save", new { invoices = new[] { second }, serials = new int?[] { 40 } }).Refused(System.Net.HttpStatusCode.BadRequest);
        Assert.Contains(clash, m => m.Contains("already used"));
        Assert.Empty((await app.Get("/api/invoices?party=NUM%20B").Ok()).EnumerateArray());
    }

    [Fact]
    public async Task Save_uses_the_typed_number_and_keeps_the_next_automatic_number_moving_forward()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var draft = await Draft(app, "NUM A", 1);
        var typed = Assert.Single((await app.Post("/api/billing/save", new { invoices = new[] { draft }, serials = new int?[] { 7 } }).Ok()).EnumerateArray());
        Assert.Equal(7, Serial(typed));
        Assert.Equal(40, (await app.Get("/api/settings?fy=26-27").Ok()).GetProperty("nextSerial").GetInt32());

        var next = Assert.Single((await app.Post("/api/billing/save", new { invoices = new[] { await Draft(app, "NUM B", 2) } }).Ok()).EnumerateArray());
        Assert.Equal(40, Serial(next));

        var high = Assert.Single((await app.Post("/api/billing/save", new { invoices = new[] { await Draft(app, "NUM A", 3) }, serials = new int?[] { 90 } }).Ok()).EnumerateArray());
        Assert.Equal(90, Serial(high));
        Assert.Equal(91, (await app.Get("/api/settings?fy=26-27").Ok()).GetProperty("nextSerial").GetInt32());
    }
}
