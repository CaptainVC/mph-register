using System.Text.Json;
using Dapper;
using Microsoft.Data.Sqlite;
using static MPHRegister.UnitTests.Api.Http;

namespace MPHRegister.UnitTests.Api;

[Collection("api")]
public sealed class ApiInvoiceRestoreTests
{
    private const string Month = "2026-10";

    private static async Task<HttpClient> Ready(ApiFactory factory)
    {
        var app = factory.App();
        await Setup.Basics(app);
        await app.Put("/api/settings", new { fy = "26-27", nextSerial = 279 }).Ok();
        await app.Post("/api/masters/party", Setup.Party("RESTORE A", beforeDispatch: true, discount: 0, gstin: "")).Ok();
        await app.Put("/api/masters/party/rate", new { party = "RESTORE A", finish = "F1", rate = 100 }).Ok();
        return app;
    }

    private static async Task<long> NewEntry(HttpClient app, int inward) =>
        (await app.Post("/api/entries", Setup.Entry(inward, "RESTORE A", month: Month)).Ok()).GetProperty("id").GetInt64();

    private static async Task<JsonElement> SaveBill(HttpClient app, long entryId)
    {
        var drafts = await app.Post("/api/billing/build", new
        {
            party = "RESTORE A", month = Month, entryIds = new[] { entryId },
            billDate = $"{Month}-28", periodFrom = $"{Month}-01", periodTo = $"{Month}-28",
        }).Ok();
        return Assert.Single((await app.Post("/api/billing/save", new { invoices = new[] { Assert.Single(drafts.EnumerateArray()) } }).Ok()).EnumerateArray());
    }

    private static long Id(JsonElement bill) => bill.GetProperty("id").GetInt64();

    private static string No(JsonElement bill) => bill.GetProperty("invoiceNo").GetString()!;

    private static Task<HttpResponseMessage> Restore(HttpClient app, JsonElement bill) => app.Post($"/api/invoices/{Id(bill)}/restore", new { });

    private static Task<JsonElement> Cancel(HttpClient app, JsonElement bill) => app.Post($"/api/invoices/{Id(bill)}/cancel", new { }).Ok();

    private static async Task<int> Unbilled(HttpClient app) =>
        (await app.Get($"/api/billing/candidates?party=RESTORE%20A&from={Month}-01&to={Month}-28").Ok()).GetProperty("entries").GetArrayLength();

    private static SqliteConnection Open(ApiFactory factory)
    {
        var db = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(factory.DataDirectory, "mph-data.db"), Pooling = false,
        }.ToString());
        db.Open();
        return db;
    }

    [Fact]
    public async Task Cancelled_bill_is_restored_with_its_number_and_entries()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var bill = await SaveBill(app, await NewEntry(app, 1));
        var cancelled = await Cancel(app, bill);
        Assert.True(cancelled.GetProperty("restore").GetProperty("allowed").GetBoolean());
        Assert.Equal(1, await Unbilled(app));

        var restored = await Restore(app, bill).Ok();
        Assert.Equal("saved", restored.GetProperty("status").GetString());
        Assert.Equal(No(bill), No(restored));
        Assert.Equal(JsonValueKind.Null, restored.GetProperty("restore").ValueKind);
        Assert.Equal(0, await Unbilled(app));
        using var db = Open(factory);
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM invoice_entries WHERE invoice_id = @id;", new { id = Id(bill) }));
        Assert.Null(await db.ExecuteScalarAsync<string?>("SELECT cancelled_at FROM invoices WHERE id = @id;", new { id = Id(bill) }));
        Assert.Equal(280, (await app.Get("/api/settings?fy=26-27").Ok()).GetProperty("nextSerial").GetInt32());
    }

    [Fact]
    public async Task Entries_billed_again_on_another_saved_bill_block_the_restore_until_that_bill_is_cancelled()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var entry = await NewEntry(app, 1);
        var first = await SaveBill(app, entry);
        await Cancel(app, first);
        var second = await SaveBill(app, entry);

        var blocked = await app.Get($"/api/invoices/{Id(first)}").Ok();
        Assert.False(blocked.GetProperty("restore").GetProperty("allowed").GetBoolean());
        Assert.Contains(No(second), blocked.GetProperty("restore").GetProperty("reason").GetString(), StringComparison.Ordinal);
        Assert.Contains(await Restore(app, first).Refused(), e => e.Contains(No(second), StringComparison.Ordinal));
        Assert.Equal("cancelled", (await app.Get($"/api/invoices/{Id(first)}").Ok()).GetProperty("status").GetString());
        using var db = Open(factory);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM invoice_entries WHERE invoice_id = @id;", new { id = Id(first) }));
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM invoice_entries WHERE invoice_id = @id;", new { id = Id(second) }));

        await Cancel(app, second);
        Assert.Equal("saved", (await Restore(app, first).Ok()).GetProperty("status").GetString());
        Assert.Contains(await Restore(app, second).Refused(), e => e.Contains(No(first), StringComparison.Ordinal));
    }

    [Fact]
    public async Task Entry_marked_billed_elsewhere_or_deleted_blocks_the_restore()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var elsewhere = await SaveBill(app, await NewEntry(app, 1));
        var gone = await SaveBill(app, await NewEntry(app, 2));
        await Cancel(app, elsewhere);
        await Cancel(app, gone);
        using (var db = Open(factory))
        {
            await db.ExecuteAsync("INSERT INTO billed_elsewhere(entry_id, note, created_at) SELECT entry_id, 'Old register', '2026-11-01' FROM (SELECT 1 AS entry_id FROM entries WHERE inward_no = 1);");
            await db.ExecuteAsync("DELETE FROM entries WHERE inward_no = 2;");
        }
        Assert.Contains(await Restore(app, elsewhere).Refused(), e => e.Contains("billed elsewhere", StringComparison.Ordinal));
        Assert.Contains(await Restore(app, gone).Refused(), e => e.Contains("no longer exists", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Only_a_cancelled_bill_can_be_restored()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var bill = await SaveBill(app, await NewEntry(app, 1));
        Assert.Equal(JsonValueKind.Null, (await app.Get($"/api/invoices/{Id(bill)}").Ok()).GetProperty("restore").ValueKind);
        Assert.Contains(await Restore(app, bill).Refused(), e => e.Contains("cancelled", StringComparison.Ordinal));
        await app.Post("/api/invoices/99999/restore", new { }).Refused(System.Net.HttpStatusCode.NotFound);
    }
}
