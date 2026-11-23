using System.Net;
using System.Text.Json;
using Dapper;
using Microsoft.Data.Sqlite;
using MPHRegister.UnitTests.TestSupport;
using static MPHRegister.UnitTests.Api.Http;

namespace MPHRegister.UnitTests.Api;

/// <summary>Deleting entries in the app and restoring them, with the checks on both sides.</summary>
[Collection("api")]
public sealed class ApiEntryDeleteTests
{
    private const string Month = "2026-10";
    private const string Party = "DELETE A";

    private static async Task<HttpClient> Ready(ApiFactory factory)
    {
        var app = factory.App();
        await Setup.Basics(app);
        await app.Put("/api/settings", new { fy = "26-27", nextSerial = 1 }).Ok();
        await app.Post("/api/masters/party", Setup.Party(Party, beforeDispatch: true, discount: 0, gstin: "")).Ok();
        await app.Put("/api/masters/party/rate", new { party = Party, finish = "F1", rate = 100 }).Ok();
        return app;
    }

    private static async Task<long> NewEntry(HttpClient app, int inward, string dn = "", string lot = "", int than = 10) =>
        (await app.Post("/api/entries", Setup.Entry(inward, Party, dn: dn, lot: lot, than: than, month: Month)).Ok()).GetProperty("id").GetInt64();

    private static Task<HttpResponseMessage> Delete(HttpClient app, long id) => app.Delete($"/api/entries/{id}");

    private static Task<HttpResponseMessage> Restore(HttpClient app, long id) => app.Post($"/api/entries/deleted/{id}/restore", new { });

    private static async Task<List<JsonElement>> Bin(HttpClient app) => (await app.Get("/api/entries/deleted").Ok()).EnumerateArray().ToList();

    private static async Task<List<JsonElement>> MonthEntries(HttpClient app) => (await app.Get($"/api/entries?month={Month}").Ok()).EnumerateArray().ToList();

    private static List<string> Texts(JsonElement list) => list.EnumerateArray().Select(e => e.GetString()!).ToList();

    private static async Task<JsonElement> SaveBill(HttpClient app, long entryId)
    {
        var drafts = await app.Post("/api/billing/build", new
        {
            party = Party, month = Month, entryIds = new[] { entryId },
            billDate = $"{Month}-28", periodFrom = $"{Month}-01", periodTo = $"{Month}-28",
        }).Ok();
        return Assert.Single((await app.Post("/api/billing/save", new { invoices = new[] { Assert.Single(drafts.EnumerateArray()) } }).Ok()).EnumerateArray());
    }

    private static SqliteConnection Open(ApiFactory factory) => TestDb.Open(factory.DataDirectory);

    [Fact]
    public async Task Deleted_entry_comes_back_whole_under_the_same_id()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var keep = await NewEntry(app, 1);
        var id = await NewEntry(app, 2, dn: "D2", lot: "L2", than: 12);
        var before = await app.Get($"/api/entries/{id}").Ok();

        var result = await Delete(app, id).Ok();
        Assert.Equal(id, result.GetProperty("deleted").GetProperty("id").GetInt64());
        Assert.Empty(Texts(result.GetProperty("notes")));
        await app.Get($"/api/entries/{id}").Refused(HttpStatusCode.NotFound);
        Assert.Equal([keep], (await MonthEntries(app)).Select(e => e.GetProperty("id").GetInt64()));
        using (var db = Open(factory))
            Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dispatches WHERE entry_id = @id;", new { id }));

        var bin = Assert.Single(await Bin(app));
        Assert.Equal((id, 2, "D2", 1), (bin.GetProperty("id").GetInt64(), bin.GetProperty("inwardNo").GetInt32(), bin.GetProperty("designNo").GetString(), bin.GetProperty("dispatches").GetInt32()));
        Assert.True(bin.GetProperty("restore").GetProperty("allowed").GetBoolean());
        // A deleted number is free again; restoring is then refused until it is free once more.
        Assert.Equal(2, (await app.Get($"/api/next-inward?month={Month}").Ok()).GetProperty("next").GetInt32());

        var restored = await Restore(app, id).Ok();
        Assert.Equal(id, restored.GetProperty("id").GetInt64());
        Assert.Equal(before.ToString(), restored.ToString());
        Assert.Empty(await Bin(app));
        await Restore(app, id).Refused(HttpStatusCode.NotFound);
        await Delete(app, 999_999).Refused(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Purging_removes_every_deleted_entry_for_good_and_leaves_live_ones()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        Assert.Equal(0, (await app.Delete("/api/entries/deleted").Ok()).GetProperty("removed").GetInt32());

        var keep = await NewEntry(app, 1);
        var first = await NewEntry(app, 2);
        var second = await NewEntry(app, 3);
        await Delete(app, first).Ok();
        await Delete(app, second).Ok();
        Assert.Equal(2, (await Bin(app)).Count);

        Assert.Equal(2, (await app.Delete("/api/entries/deleted").Ok()).GetProperty("removed").GetInt32());
        Assert.Empty(await Bin(app));
        await Restore(app, first).Refused(HttpStatusCode.NotFound);
        await Restore(app, second).Refused(HttpStatusCode.NotFound);
        Assert.Equal([keep], (await MonthEntries(app)).Select(e => e.GetProperty("id").GetInt64()));
    }

    [Fact]
    public async Task Billed_entry_cannot_be_deleted_and_a_cancelled_bill_waits_for_the_entry()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var id = await NewEntry(app, 1);
        var bill = await SaveBill(app, id);
        var billId = bill.GetProperty("id").GetInt64();
        var billNo = bill.GetProperty("invoiceNo").GetString()!;

        var refused = Assert.Single(await Delete(app, id).Refused());
        Assert.Contains($"is on bill {billNo}", refused, StringComparison.Ordinal);
        Assert.Single(await MonthEntries(app));

        await app.Post($"/api/invoices/{billId}/cancel", new { }).Ok();
        var result = await Delete(app, id).Ok();
        Assert.Contains(Texts(result.GetProperty("notes")), n => n.Contains($"Cancelled bill {billNo}", StringComparison.Ordinal));
        var bill2 = await app.Get($"/api/invoices/{billId}").Ok();
        Assert.False(bill2.GetProperty("restore").GetProperty("allowed").GetBoolean());

        await Restore(app, id).Ok();
        Assert.True((await app.Get($"/api/invoices/{billId}").Ok()).GetProperty("restore").GetProperty("allowed").GetBoolean());
        await app.Post($"/api/invoices/{billId}/restore", new { }).Ok();
        Assert.Equal(billNo, (await app.Get($"/api/entries/{id}").Ok()).GetProperty("billedIn").GetString());
    }

    [Fact]
    public async Task Entry_marked_billed_elsewhere_cannot_be_deleted()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var id = await NewEntry(app, 1);
        await app.Post("/api/billing/elsewhere", new { entryIds = new[] { id }, note = "Billed in Excel" }).Ok();
        Assert.Contains("billed outside the app", Assert.Single(await Delete(app, id).Refused()), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Restore_is_refused_while_its_inward_number_is_used_again()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var id = await NewEntry(app, 5, dn: "D5");
        await Delete(app, id).Ok();
        var other = await NewEntry(app, 5, dn: "OTHER");

        var bin = Assert.Single(await Bin(app));
        Assert.False(bin.GetProperty("restore").GetProperty("allowed").GetBoolean());
        var clash = Assert.Single(Texts(bin.GetProperty("restore").GetProperty("clashes")));
        Assert.Contains("INW. NO. 5", clash, StringComparison.Ordinal);
        Assert.Single(await Restore(app, id).Refused());
        Assert.Single(await MonthEntries(app));
        Assert.Single(await Bin(app));

        await app.Put($"/api/entries/{other}", Setup.Entry(6, Party, dn: "OTHER", month: Month)).Ok();
        await Restore(app, id).Ok();
        Assert.Equal([5, 6], (await MonthEntries(app)).Select(e => e.GetProperty("inwardNo").GetInt32()).Order());
    }

    [Fact]
    public async Task Restore_is_refused_when_the_same_slip_is_back_and_warns_about_a_lookalike()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var id = await NewEntry(app, 3, dn: "D3", lot: "L3", than: 7);
        await Delete(app, id).Ok();

        // Typed again under another number: allowed, but the lookalike is pointed out.
        var again = await NewEntry(app, 4, dn: "D3", lot: "L3", than: 7);
        var check = Assert.Single(await Bin(app)).GetProperty("restore");
        Assert.True(check.GetProperty("allowed").GetBoolean());
        Assert.Contains("INW. NO. 4", Assert.Single(Texts(check.GetProperty("warnings"))), StringComparison.Ordinal);

        // The same slip (number, date and party) in another month's register blocks it.
        await app.Put($"/api/entries/{again}", Setup.Entry(3, Party, dn: "D3", lot: "L3", than: 7, month: Month)).Ok();
        using (var db = Open(factory)) await db.ExecuteAsync("UPDATE entries SET register_month = '2026-11', carried_over = 1 WHERE id = @again;", new { again });
        check = Assert.Single(await Bin(app)).GetProperty("restore");
        Assert.False(check.GetProperty("allowed").GetBoolean());
        Assert.Contains("same slip", Assert.Single(Texts(check.GetProperty("clashes"))), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Deleted_entry_follows_a_party_rename_and_needs_its_party_in_the_list()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var id = await NewEntry(app, 1);
        await Delete(app, id).Ok();
        await app.Post("/api/masters/party", Setup.Party("DELETE B", original: Party, discount: 0, gstin: "")).Ok();
        Assert.Equal("DELETE B", Assert.Single(await Bin(app)).GetProperty("party").GetString());
        Assert.Equal("DELETE B", (await Restore(app, id).Ok()).GetProperty("party").GetString());

        await Delete(app, id).Ok();
        using (var db = Open(factory)) await db.ExecuteAsync("UPDATE deleted_entries SET party = 'GONE PARTY' WHERE id = @id;", new { id });
        var clash = Assert.Single(await Restore(app, id).Refused());
        Assert.Contains("GONE PARTY", clash, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Importing_a_newer_workbook_keeps_an_app_deletion()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        using var folder = Make.Folder();
        const string April = "2026-04";
        SheetRow[] rows =
        [
            new(1, "2026-04-01", Party, "D1", "L1", 10),
            new(2, "2026-04-01", Party, "D2", "L2", 12),
        ];
        await Import(app, InwardWorkbook.Write(folder.File("apr-1.xlsx"), rows), April);
        var two = (await app.Get($"/api/entries?month={April}").Ok()).EnumerateArray().Single(e => e.GetProperty("inwardNo").GetInt32() == 2);
        var id = two.GetProperty("id").GetInt64();
        var deleted = await Delete(app, id).Ok();
        Assert.Contains(Texts(deleted.GetProperty("notes")), n => n.Contains("Excel workbook", StringComparison.Ordinal));

        SheetRow[] newer = [.. rows, new(3, "2026-04-02", Party, "D3", "L3", 8)];
        var report = await Import(app, InwardWorkbook.Write(folder.File("apr-2.xlsx"), newer, salt: "2"), April);
        Assert.Equal(1, report.GetProperty("entries").GetInt32());
        Assert.Contains(report.GetProperty("kept").EnumerateArray(), k => k.GetProperty("message").GetString()!.Contains("INW. NO. 2", StringComparison.Ordinal)
            && k.GetProperty("message").GetString()!.Contains("stays deleted", StringComparison.Ordinal));
        Assert.Equal([1, 3], (await app.Get($"/api/entries?month={April}").Ok()).EnumerateArray().Select(e => e.GetProperty("inwardNo").GetInt32()).Order());

        await Restore(app, id).Ok();
        Assert.Equal([1, 2, 3], (await app.Get($"/api/entries?month={April}").Ok()).EnumerateArray().Select(e => e.GetProperty("inwardNo").GetInt32()).Order());
        // Back with its workbook row: the next copy of the workbook sees it as unchanged.
        var again = await Import(app, InwardWorkbook.Write(folder.File("apr-3.xlsx"), newer, salt: "3"), April);
        Assert.True(again.GetProperty("upToDate").GetBoolean());
    }

    [Fact]
    public async Task A_later_month_carryover_row_of_a_deleted_entry_stays_out()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        using var folder = Make.Folder();
        await Import(app, InwardWorkbook.Write(folder.File("apr.xlsx"), [new SheetRow(7, "2026-04-20", Party, "D7", "L7", 10)]), "2026-04");
        var id = Assert.Single((await app.Get("/api/entries?month=2026-04").Ok()).EnumerateArray()).GetProperty("id").GetInt64();
        await Delete(app, id).Ok();

        SheetRow?[] may = [new SheetRow(1, "2026-05-02", Party, "D1", "L1", 5), null, new SheetRow(7, "2026-04-20", Party, "D7", "L7", 10).Sent((10, "G7", "2026-05-03"))];
        var report = await Import(app, InwardWorkbook.Write(folder.File("may.xlsx"), may), "2026-05");
        Assert.Equal(1, report.GetProperty("entries").GetInt32());
        Assert.Contains(report.GetProperty("kept").EnumerateArray(), k => k.GetProperty("message").GetString()!.Contains("stays deleted", StringComparison.Ordinal));
        Assert.Equal([1], (await app.Get("/api/entries").Ok()).EnumerateArray().Select(e => e.GetProperty("inwardNo").GetInt32()));
    }

    private static async Task<JsonElement> Import(HttpClient app, string path, string month)
    {
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(await File.ReadAllBytesAsync(path)), "file", Path.GetFileName(path));
        form.Add(new StringContent(month), "month");
        form.Add(new StringContent("true"), "commit");
        var report = await app.PostAsync(new Uri("/api/import", UriKind.Relative), form).Ok();
        Assert.Empty(report.GetProperty("errors").EnumerateArray());
        return report;
    }
}
