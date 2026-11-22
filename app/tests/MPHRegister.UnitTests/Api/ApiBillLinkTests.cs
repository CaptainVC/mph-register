using System.Text.Json;
using Dapper;
using Microsoft.Data.Sqlite;
using MPHRegister.UnitTests.TestSupport;

namespace MPHRegister.UnitTests.Api;

/// <summary>Re-checking the links of bills imported from Excel, sister-firm groups, and carryover rows with a mistyped date.</summary>
[Collection("api")]
public sealed class ApiBillLinkTests(DashboardApiFactory factory) : IClassFixture<DashboardApiFactory>, IDisposable
{
    private readonly TempFolder folder = Make.Folder();

    public void Dispose() => folder.Dispose();

    private async Task<HttpClient> Ready()
    {
        var app = factory.App();
        if (factory.ConfigOnDisk.Finishes.Count != 0) return app;
        await Setup.Basics(app);
        foreach (var party in new[] { "LINK A", "LINK B", "LINK C", "SLIP PARTY", "WAIT PARTY" }) await app.Post("/api/masters/party", Setup.Party(party)).Ok();
        return app;
    }

    private static async Task<long> Add(HttpClient app, object entry) => (await app.Post("/api/entries", entry).Ok()).GetProperty("id").GetInt64();

    private static object Entry(int inward, string party, int than, string dn = "", string lot = "", string gatePass = "G1") => Setup.Entry(inward, party, than: than, dn: dn, lot: lot, gatePass: gatePass);

    private SqliteConnection Open()
    {
        var connection = new SqliteConnection($"Data Source={Path.Combine(factory.DataDirectory, "mph-data.db")};Pooling=False");
        connection.Open();
        return connection;
    }

    /// <summary>An October bill of LINK A as the Excel import saved it, with no line linked.</summary>
    private long ExcelBill(params (string Gpn, string Dn, string Lot, int Qty)[] lines) => ExcelBill(900, lines);

    private long ExcelBill(int serial, params (string Gpn, string Dn, string Lot, int Qty)[] lines)
    {
        using var c = Open();
        var id = c.ExecuteScalar<long>(
            """
            INSERT INTO invoices(invoice_no, fy, serial, party, party_name, address, state, gstin, bill_date, bill_month, period_from, period_to,
                discount_pct, tax_mode, cgst_rate, sgst_rate, igst_rate, gross, discount, taxable, cgst, sgst, igst, total, status, source, firm, notes, created_at, updated_at)
            VALUES ('26-27\JOB\' || @serial, '26-27', @serial, 'LINK A', 'LINK A', 'ADDR', '(HOME STATE)', '', '2026-10-31', '2026-10', '2026-10-01', '2026-10-31',
                0, 'intra', 2.5, 2.5, 5, 0, 0, 0, 0, 0, 0, 0, 'saved', 'excel', '{}', '', '2026-11-01 10:00:00', '2026-11-01 10:00:00')
            RETURNING id;
            """,
            new { serial });
        var seq = 0;
        foreach (var (gpn, dn, lot, qty) in lines)
        {
            c.Execute("INSERT INTO invoice_lines(invoice_id, seq, kind, gpn, dn, lot, finish, qty) VALUES (@id, @seq, 'detail', @gpn, @dn, @lot, '', @qty);",
                new { id, seq = ++seq, gpn, dn, lot, qty });
        }
        c.Execute("INSERT INTO invoice_lines(invoice_id, seq, kind, finish, qty, rate, amount, auto_sum) VALUES (@id, @seq, 'priced', 'F1', @qty, 10, @amount, 1);",
            new { id, seq = seq + 1, qty = lines.Sum(l => l.Qty), amount = lines.Sum(l => l.Qty) * 10 });
        return id;
    }

    private List<long> Linked(long invoiceId)
    {
        using var c = Open();
        return c.Query<long>("SELECT entry_id FROM invoice_entries WHERE invoice_id = @invoiceId ORDER BY entry_id;", new { invoiceId }).ToList();
    }

    private static async Task<JsonElement> Relink(HttpClient app, bool commit) => await app.Post("/api/billing/relink", new { commit }).Ok();

    private static List<string> Parties(JsonElement report) =>
        report.GetProperty("suggestions").EnumerateArray().Select(s => s.GetProperty("entryParty").GetString()!).Distinct().Order(StringComparer.Ordinal).ToList();

    [Fact]
    public async Task Imported_bills_are_linked_again_and_sister_firms_share_their_entries()
    {
        var app = await Ready();
        var lot650 = await Add(app, Entry(1, "LINK A", 129, lot: "650,651"));
        var lot651 = await Add(app, Entry(2, "LINK A", 40, lot: "650,651"));
        var sister = await Add(app, Entry(3, "LINK B", 24, dn: "247", gatePass: "443"));
        var other = await Add(app, Entry(4, "LINK C", 112, lot: "5129", gatePass: "3022"));
        var bill = ExcelBill(("", "", "650", 80), ("", "", "651", 89), ("443", "247", "", 24), ("3022", "", "5129", 112));

        // Other tests of this class add their own bills; only this bill's changes are counted here.
        var check = await Relink(app, commit: false);
        var before = check.GetProperty("linkedBefore").GetInt32();
        Assert.Equal((false, 1, before + 2), (check.GetProperty("saved").GetBoolean(), check.GetProperty("changedBills").GetInt32(), check.GetProperty("linkedAfter").GetInt32()));
        Assert.Equal(["LINK B", "LINK C"], Parties(check));
        Assert.Empty(Linked(bill));

        var a = (await app.Get("/api/masters/full").Ok()).GetProperty("parties").EnumerateArray().Single(p => p.GetProperty("name").GetString() == "LINK A");
        Assert.Equal(string.Empty, a.GetProperty("sisterGroup").GetString());
        foreach (var party in new[] { "LINK A", "LINK B" })
        {
            var saved = await app.Post("/api/masters/party", WithGroup(Setup.Party(party, original: party), "LINKS")).Ok();
            Assert.Equal("LINKS", saved.GetProperty("sisterGroup").GetString());
        }
        await app.Post("/api/masters/party", Setup.Party("LINK B", original: "LINK B")).Ok();
        Assert.Equal("LINKS", factory.ConfigOnDisk.Parties.Single(p => p.Name == "LINK B").SisterGroup);

        var saveIt = await Relink(app, commit: true);
        Assert.True(saveIt.GetProperty("saved").GetBoolean());
        Assert.Equal(before + 3, saveIt.GetProperty("linkedAfter").GetInt32());
        Assert.Equal(["LINK C"], Parties(saveIt));
        Assert.Equal([lot650, lot651, sister], Linked(bill));
        Assert.DoesNotContain(other, Linked(bill));
        Assert.Equal(0, (await Relink(app, commit: false)).GetProperty("changedBills").GetInt32());
        Assert.Contains(Directory.GetFiles(Path.Combine(factory.DataDirectory, "backups")), f => f.Contains("before-relink", StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_repair_memo_row_below_the_bill_loses_a_link_an_older_import_gave_it()
    {
        var app = await Ready();
        var billed = await Add(app, Entry(11, "LINK A", 10, lot: "88"));
        var memo = await Add(app, Entry(12, "LINK A", 5, lot: "77"));
        var bill = ExcelBill(901, ("", "", "88", 10));
        await using (var c = Open())
        {
            await c.ExecuteAsync("INSERT INTO invoice_lines(invoice_id, seq, kind, lot, qty, entry_ids) VALUES (@bill, 3, 'detail', 'R,77', 5, @ids);", new { bill, ids = $"[{memo}]" });
            await c.ExecuteAsync("INSERT INTO invoice_entries(invoice_id, entry_id) VALUES (@bill, @memo);", new { bill, memo });
        }

        var report = await Relink(app, commit: true);
        Assert.Contains(billed, Linked(bill));
        Assert.DoesNotContain(memo, Linked(bill));
        Assert.Contains(report.GetProperty("noLongerLinked").EnumerateArray(), e => e.GetProperty("entryId").GetInt64() == memo);
    }

    private static Dictionary<string, object?> WithGroup(object party, string group)
    {
        var fields = JsonSerializer.SerializeToElement(party, Shared.Json.JsonDefaults.Options).EnumerateObject()
            .ToDictionary(p => p.Name, p => (object?)p.Value.Clone());
        fields["sisterGroup"] = group;
        return fields;
    }

    [Fact]
    public async Task A_carryover_row_with_a_mistyped_date_merges_into_its_slip()
    {
        var app = await Ready();
        var june = InwardWorkbook.Write(folder.File("jun.xlsx"), [new SheetRow(396, "2026-06-13", "SLIP PARTY", Lot: "34", Than: 64) { Dispatches = [(64, "3036", "2026-06-15")] }]);
        await Import(app, june, "2026-06");
        SheetRow?[] julyRows = [new SheetRow(1, "2026-07-01", "SLIP PARTY", Lot: "40", Than: 10), null, new SheetRow(396, "2026-06-08", "SLIP PARTY", Lot: "34", Than: 64) { Dispatches = [(64, "3036", "2026-06-15")] }];
        var july = await Import(app, InwardWorkbook.Write(folder.File("jul.xlsx"), julyRows), "2026-07");
        Assert.Equal(1, july.GetProperty("entries").GetInt32());
        Assert.Contains(july.GetProperty("warnings").EnumerateArray(), w => w.GetProperty("message").GetString()!.Contains("in everything but the date", StringComparison.Ordinal));
        var all = (await app.Get("/api/entries?month=2026-06").Ok()).EnumerateArray().Concat((await app.Get("/api/entries?month=2026-07").Ok()).EnumerateArray())
            .Where(e => e.GetProperty("party").GetString() == "SLIP PARTY" && e.GetProperty("inwardNo").GetInt32() == 396).ToList();
        Assert.Equal(["2026-06-13"], all.Select(e => e.GetProperty("entryDate").GetString()));
    }

    private static async Task<JsonElement> Import(HttpClient app, string path, string month)
    {
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(await File.ReadAllBytesAsync(path)), "file", Path.GetFileName(path));
        form.Add(new StringContent(month), "month");
        form.Add(new StringContent("true"), "commit");
        return await app.PostAsync(new Uri("/api/import", UriKind.Relative), form).Ok();
    }

    [Fact]
    public async Task Work_whose_dispatch_is_dated_before_the_inward_date_waits_from_the_inward_date()
    {
        var app = await Ready();
        // Only a workbook can bring such a slip in; the entry screen refuses it. 04.01.26 was typed for 04.11.26.
        SheetRow[] rows = [new(278, "2026-11-02", "WAIT PARTY", "13761", "543", 38) { Dispatches = [(38, "5080", "2026-01-04")] }];
        await Import(app, InwardWorkbook.Write(folder.File("nov.xlsx"), rows), "2026-11");
        var dashboard = await app.Get("/api/dashboard").Ok();
        var party = dashboard.GetProperty("unbilledParties").EnumerateArray().Single(p => p.GetProperty("party").GetString() == "WAIT PARTY");
        Assert.Equal(19, party.GetProperty("daysWaiting").GetInt32());
    }
}
