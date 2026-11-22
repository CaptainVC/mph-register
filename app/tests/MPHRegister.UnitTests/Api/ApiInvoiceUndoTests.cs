using System.Net;
using System.Text.Json;
using Dapper;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using MPHRegister.Data.Database;
using static MPHRegister.UnitTests.Api.Http;

namespace MPHRegister.UnitTests.Api;

[Collection("api")]
public sealed class ApiInvoiceUndoTests
{
    private static async Task<HttpClient> Ready(ApiFactory factory)
    {
        var app = factory.App();
        await Setup.Basics(app);
        await app.Put("/api/settings", new { fy = "26-27", nextSerial = 279 }).Ok();
        foreach (var party in new[] { "UNDO A", "UNDO B" })
        {
            await app.Post("/api/masters/party", Setup.Party(party, beforeDispatch: true, discount: 0, gstin: "")).Ok();
            await app.Put("/api/masters/party/rate", new { party, finish = "F1", rate = 100 }).Ok();
        }
        return app;
    }

    private static async Task<JsonElement> Draft(HttpClient app, string party, int inward, string month = "2026-10")
    {
        var entry = await app.Post("/api/entries", Setup.Entry(inward, party, month: month)).Ok();
        var drafts = await app.Post("/api/billing/build", new
        {
            party, month, entryIds = new[] { entry.GetProperty("id").GetInt64() },
            billDate = $"{month}-28", periodFrom = $"{month}-01", periodTo = $"{month}-28",
        }).Ok();
        return Assert.Single(drafts.EnumerateArray());
    }

    private static async Task<JsonElement> Save(HttpClient app, string party, int inward, string month = "2026-10")
    {
        var draft = await Draft(app, party, inward, month);
        return Assert.Single((await app.Post("/api/billing/save", new { invoices = new[] { draft } }).Ok()).EnumerateArray());
    }

    private static long Id(JsonElement bill) => bill.GetProperty("id").GetInt64();

    private static string? Token(JsonElement bill) => bill.GetProperty("undoSave").GetProperty("token").GetString();

    private static Task<HttpResponseMessage> Undo(HttpClient app, JsonElement bill) =>
        app.Post($"/api/invoices/{Id(bill)}/undo-save", new { neverIssued = true, token = Token(bill) });

    private static async Task<int> Next(HttpClient app, string fy = "26-27") =>
        (await app.Get($"/api/settings?fy={fy}").Ok()).GetProperty("nextSerial").GetInt32();

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
    public async Task Saved_bill_list_shows_financial_year_and_serial_so_the_screen_can_tell_the_newest_bills()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        await Save(app, "UNDO A", 1);
        await Save(app, "UNDO B", 2);

        var listed = (await app.Get("/api/invoices").Ok()).EnumerateArray().ToList();
        Assert.Equal([279, 280], listed.Select(i => i.GetProperty("serial").GetInt32()));
        Assert.All(listed, i => Assert.Equal("26-27", i.GetProperty("fy").GetString()));
    }

    [Fact]
    public async Task Latest_never_issued_save_releases_number_and_entries_but_preserves_audit_and_old_identity()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var bill = await Save(app, "UNDO A", 1);
        Assert.True(bill.GetProperty("undoSave").GetProperty("allowed").GetBoolean());
        Assert.Equal(280, await Next(app));

        var result = await Undo(app, bill).Ok();
        Assert.Equal(bill.GetProperty("invoiceNo").GetString(), result.GetProperty("invoiceNo").GetString());
        Assert.Equal(279, result.GetProperty("nextSerial").GetInt32());
        Assert.Equal(279, await Next(app));
        await app.Get($"/api/invoices/{Id(bill)}").Refused(HttpStatusCode.NotFound);
        Assert.Empty((await app.Get("/api/invoices").Ok()).EnumerateArray());
        var candidates = await app.Get("/api/billing/candidates?party=UNDO%20A&from=2026-10-01&to=2026-10-28").Ok();
        Assert.Single(candidates.GetProperty("entries").EnumerateArray());

        using (var db = Open(factory))
        {
            Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM invoice_lines;"));
            Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM invoice_entries;"));
            Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT confirmed_never_issued FROM invoice_undos WHERE invoice_id = @id;", new { id = Id(bill) }));
            var snapshotText = await db.ExecuteScalarAsync<string>("SELECT snapshot FROM invoice_undos WHERE invoice_id = @id;", new { id = Id(bill) });
            Assert.NotNull(snapshotText);
            using var document = JsonDocument.Parse(snapshotText);
            var snapshot = document.RootElement;
            Assert.Equal(Id(bill), snapshot.GetProperty("invoice").GetProperty("id").GetInt64());
            Assert.Equal(bill.GetProperty("total").GetInt64(), snapshot.GetProperty("invoice").GetProperty("total").GetInt64());
            Assert.Equal(bill.GetProperty("firm").GetProperty("invoicePrefix").GetString(),
                JsonDocument.Parse(snapshot.GetProperty("invoice").GetProperty("firm").GetString()!).RootElement.GetProperty("invoicePrefix").GetString());
            Assert.NotEqual("[]", snapshot.GetProperty("lines")[0].GetProperty("entryIds").GetString());
        }

        factory.Services.GetRequiredService<IDatabaseInitializer>().Initialize();
        var draft = Assert.Single((await app.Post("/api/billing/build", new
        {
            party = "UNDO A", month = "2026-10",
            entryIds = candidates.GetProperty("entries").EnumerateArray().Select(e => e.GetProperty("entryId").GetInt64()).ToArray(),
            billDate = "2026-10-28", periodFrom = "2026-10-01", periodTo = "2026-10-28",
        }).Ok()).EnumerateArray());
        var replacement = Assert.Single((await app.Post("/api/billing/save", new { invoices = new[] { draft } }).Ok()).EnumerateArray());
        Assert.Equal(bill.GetProperty("invoiceNo").GetString(), replacement.GetProperty("invoiceNo").GetString());
        Assert.True(Id(replacement) > Id(bill));
        await Undo(app, bill).Refused(HttpStatusCode.NotFound);
        await app.Post($"/api/invoices/{Id(bill)}/cancel", new { }).Refused(HttpStatusCode.NotFound);
        await app.Post("/api/invoices/pdf", new { ids = new[] { Id(bill) } }).Refused(HttpStatusCode.NotFound);
        Assert.Equal(280, await Next(app));
        using var persisted = Open(factory);
        Assert.Equal(1, await persisted.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM invoice_undos;"));
        Assert.Equal(1, await persisted.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM invoice_entries;"));
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task Confirmation_and_current_token_are_required(bool neverIssued, bool sendToken)
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var bill = await Save(app, "UNDO A", 1);
        await app.Post($"/api/invoices/{Id(bill)}/undo-save", new { neverIssued, token = sendToken ? Token(bill) : null }).Refused();
        Assert.Equal(280, await Next(app));
        await app.Get($"/api/invoices/{Id(bill)}").Ok();
        using var db = Open(factory);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM invoice_undos;"));
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM invoice_entries;"));
    }

    [Fact]
    public async Task Later_bill_for_another_party_blocks_undo_even_after_cancellation()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var first = await Save(app, "UNDO A", 1);
        var later = await Save(app, "UNDO B", 2);
        Assert.Contains(await Undo(app, first).Refused(), e => e.Contains("later bill", StringComparison.Ordinal));
        await app.Post($"/api/invoices/{Id(later)}/cancel", new { }).Ok();
        Assert.Contains(await Undo(app, first).Refused(), e => e.Contains("later bill", StringComparison.Ordinal));
        var cancelled = await app.Get($"/api/invoices/{Id(later)}").Ok();
        Assert.False(cancelled.GetProperty("undoSave").GetProperty("allowed").GetBoolean());
        Assert.Contains(await Undo(app, cancelled).Refused(), e => e.Contains("cancelled bill", StringComparison.Ordinal));
        Assert.Equal(281, await Next(app));
        using var db = Open(factory);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM invoice_undos;"));
    }

    [Fact]
    public async Task Imported_bill_cannot_be_undone_and_a_later_import_blocks_earlier_app_bills()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var first = await Save(app, "UNDO A", 1);
        var later = await Save(app, "UNDO B", 2);
        using var db = Open(factory);
        await db.ExecuteAsync("UPDATE invoices SET source = 'excel' WHERE id = @id;", new { id = Id(later) });
        var imported = await app.Get($"/api/invoices/{Id(later)}").Ok();
        Assert.False(imported.GetProperty("undoSave").GetProperty("allowed").GetBoolean());
        Assert.Contains(await Undo(app, imported).Refused(), e => e.Contains("Imported Excel", StringComparison.Ordinal));
        Assert.Contains(await Undo(app, first).Refused(), e => e.Contains("later bill", StringComparison.Ordinal));
        Assert.Equal(281, await Next(app));
    }

    [Fact]
    public async Task Manually_advanced_counter_is_not_rewound()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var bill = await Save(app, "UNDO A", 1);
        await app.Put("/api/settings", new { fy = "26-27", nextSerial = 300 }).Ok();
        var current = await app.Get($"/api/invoices/{Id(bill)}").Ok();
        Assert.False(current.GetProperty("undoSave").GetProperty("allowed").GetBoolean());
        Assert.Contains(await Undo(app, bill).Refused(), e => e.Contains("next bill number", StringComparison.Ordinal));
        Assert.Equal(300, await Next(app));
    }

    [Fact]
    public async Task Another_financial_year_does_not_block_or_have_its_counter_changed()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var bill = await Save(app, "UNDO A", 1);
        var other = await Save(app, "UNDO B", 2, "2027-04");
        var otherNext = await Next(app, "27-28");
        await Undo(app, bill).Ok();
        Assert.Equal(279, await Next(app));
        Assert.Equal(otherNext, await Next(app, "27-28"));
        await app.Get($"/api/invoices/{Id(other)}").Ok();
    }

    [Fact]
    public async Task An_edit_in_the_same_timestamp_second_invalidates_the_confirmation_token()
    {
        using var factory = new UndoClockFactory();
        using var app = await Ready(factory);
        var bill = await Save(app, "UNDO A", 1);
        var edited = await app.Put($"/api/invoices/{Id(bill)}", new
        {
            billDate = "2026-10-28", periodFrom = "2026-10-01", periodTo = "2026-10-28",
            notes = "corrected", lines = bill.GetProperty("lines"),
        }).Ok();
        Assert.Equal(bill.GetProperty("updatedAt").GetString(), edited.GetProperty("updatedAt").GetString());
        Assert.NotEqual(Token(bill), Token(edited));
        Assert.Contains(await Undo(app, bill).Refused(), e => e.Contains("bill has changed", StringComparison.Ordinal));
        Assert.Equal(280, await Next(app));
        await Undo(app, edited).Ok();
        Assert.Equal(279, await Next(app));
    }

    [Fact]
    public async Task Concurrent_undo_requests_record_one_undo_and_do_not_rewind_twice()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var bill = await Save(app, "UNDO A", 1);
        var responses = await Task.WhenAll(Undo(app, bill), Undo(app, bill));
        using var first = responses[0];
        using var second = responses[1];
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.NotFound);
        Assert.Equal(279, await Next(app));
        using var db = Open(factory);
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM invoice_undos;"));
    }

    [Fact]
    public async Task Concurrent_new_save_and_undo_keep_unique_numbers_and_the_correct_counter()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var bill = await Save(app, "UNDO A", 1);
        var draft = await Draft(app, "UNDO B", 2);
        var responses = await Task.WhenAll(Undo(app, bill), app.Post("/api/billing/save", new { invoices = new[] { draft } }));
        using var undone = responses[0];
        using var saved = responses[1];
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.True(undone.StatusCode is HttpStatusCode.OK or HttpStatusCode.BadRequest);
        var next = undone.IsSuccessStatusCode ? 280 : 281;
        Assert.Equal(next, await Next(app));
        using var db = Open(factory);
        Assert.Equal(undone.IsSuccessStatusCode ? 1 : 2, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM invoices;"));
        Assert.Equal(undone.IsSuccessStatusCode ? 1 : 0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM invoice_undos;"));
        Assert.Empty(await db.QueryAsync<int>("SELECT serial FROM invoices GROUP BY fy, serial HAVING COUNT(*) > 1;"));
    }

    [Fact]
    public async Task Failure_deleting_the_bill_rolls_back_the_audit_counter_and_entry_links()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var bill = await Save(app, "UNDO A", 1);
        using var db = Open(factory);
        await db.ExecuteAsync("CREATE TRIGGER reject_undo BEFORE DELETE ON invoices BEGIN SELECT RAISE(ABORT, 'test undo failure'); END;");
        await Undo(app, bill).Refused(HttpStatusCode.InternalServerError);
        Assert.Equal(280, await Next(app));
        await app.Get($"/api/invoices/{Id(bill)}").Ok();
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM invoice_undos;"));
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM invoice_lines;"));
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM invoice_entries;"));
    }

    private sealed class UndoClockFactory : ApiFactory
    {
        protected override void AddTestServices(IServiceCollection services) =>
            services.AddSingleton<TimeProvider>(new FixedClock(new DateTimeOffset(2026, 11, 21, 12, 0, 0, TimeSpan.Zero)));
    }
}
