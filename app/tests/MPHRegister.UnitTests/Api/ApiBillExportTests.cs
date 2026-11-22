using System.Net;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using MPHRegister.Services.Imports.Bills;
using MPHRegister.UnitTests.TestSupport;

namespace MPHRegister.UnitTests.Api;

/// <summary>Writing saved bills into an uploaded bill workbook, and importing that workbook again afterwards.</summary>
[Collection("api")]
public sealed class ApiBillExportTests
{
    private static async Task<HttpClient> Ready(ApiFactory factory)
    {
        var app = factory.App();
        await Setup.Basics(app);
        await app.Put("/api/settings", new { fy = "26-27", nextSerial = 279 }).Ok();
        var config = factory.ConfigOnDisk;
        await app.Put("/api/settings", new
        {
            firm = config.Firm with { Name = "TEST FIRM", HomeStateCode = "08", HomeStateName = "HOME STATE" },
            billRules = config.BillRules with { NumberPrefix = "{FY}\\JOB\\", CgstPercent = 2.5m, SgstPercent = 2.5m, IgstPercent = 5m },
        }).Ok();
        await app.Post("/api/masters/party", Setup.Party("EXP A")).Ok();
        await app.Put("/api/masters/party/rate", new { party = "EXP A", finish = "F1", rate = 100 }).Ok();
        return app;
    }

    private static async Task<JsonElement> SavedBill(HttpClient app, int inward)
    {
        var entry = await app.Post("/api/entries", Setup.Entry(inward, "EXP A", month: "2026-11")).Ok();
        var drafts = await app.Post("/api/billing/build", new
        {
            party = "EXP A", month = "2026-11", entryIds = new[] { entry.GetProperty("id").GetInt64() },
            billDate = "2026-11-30", periodFrom = "2026-11-01", periodTo = "2026-11-30",
        }).Ok();
        return Assert.Single((await app.Post("/api/billing/save", new { invoices = drafts.EnumerateArray().ToArray() }).Ok()).EnumerateArray());
    }

    private static MultipartFormDataContent Form(byte[] workbook, object request, string fileName = "MPH BILL--NOV.-26-27.xlsm")
    {
        var form = new MultipartFormDataContent
        {
            { new ByteArrayContent(workbook), "file", fileName },
            { new StringContent(JsonSerializer.Serialize(request, MPHRegister.Shared.Json.JsonDefaults.Options)), "request" },
        };
        return form;
    }

    private static byte[] Workbook() => BillWorkbookBuilder.Build([new DetailsParty("EXP A") { Rates = new Dictionary<string, decimal> { ["F1"] = 100 } }]);

    /// <summary>Every reading of the clock is a second later, so a bill edited right after it was written has a newer time.</summary>
    private sealed class SteppingClockFactory : ApiFactory
    {
        protected override void AddTestServices(IServiceCollection services) => services.AddSingleton<TimeProvider>(new SteppingClock());
    }

    private sealed class SteppingClock : TimeProvider
    {
        private long ticks = new DateTimeOffset(2026, 11, 30, 10, 0, 0, TimeSpan.Zero).Ticks;

        public override DateTimeOffset GetUtcNow() => new(Interlocked.Add(ref ticks, TimeSpan.TicksPerSecond), TimeSpan.Zero);

        public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;
    }

    [Fact]
    public async Task Saved_bills_come_back_written_into_the_workbook_and_the_list_says_so()
    {
        using var factory = new SteppingClockFactory();
        using var app = await Ready(factory);
        var bill = await SavedBill(app, 1);
        var id = bill.GetProperty("id").GetInt64();
        Assert.Equal("26-27\\JOB\\279", bill.GetProperty("invoiceNo").GetString());

        using var previewForm = Form(Workbook(), new { ids = new[] { id } });
        var preview = await app.PostAsync(new Uri("/api/billing/excel/preview", UriKind.Relative), previewForm).Ok();
        var row = Assert.Single(preview.GetProperty("bills").EnumerateArray());
        Assert.True(row.GetProperty("status").GetString() == "write", row.ToString());
        Assert.Equal("column 1, bill 1 (A1:G49)", row.GetProperty("place").GetString());
        Assert.Equal(1, preview.GetProperty("toWrite").GetInt32());
        Assert.Contains("26-27\\JOB\\279", preview.GetProperty("notes")[0].GetString(), StringComparison.Ordinal);
        Assert.Equal(JsonValueKind.Null, (await app.Get("/api/invoices").Ok())[0].GetProperty("exportedAt").ValueKind);

        using var exportForm = Form(Workbook(), new { ids = new[] { id } });
        using var response = await app.PostAsync(new Uri("/api/billing/excel/export", UriKind.Relative), exportForm);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/vnd.ms-excel.sheet.macroEnabled.12", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("MPH BILL--NOV.-26-27.xlsm", response.Content.Headers.ContentDisposition?.FileNameStar);
        var filled = await response.Content.ReadAsByteArrayAsync();
        var path = Path.Combine(factory.DataDirectory, "filled.xlsm");
        await File.WriteAllBytesAsync(path, filled);
        var written = Assert.Single(BillSheetReader.Read(path)!.Bills);
        Assert.Equal("26-27\\JOB\\279", written.InvoiceNo);
        Assert.Equal(bill.GetProperty("total").GetInt64(), written.Total);

        var listed = (await app.Get("/api/invoices").Ok())[0];
        Assert.Equal("MPH BILL--NOV.-26-27.xlsm", listed.GetProperty("exportedTo").GetString());
        Assert.NotEqual(JsonValueKind.Null, listed.GetProperty("exportedAt").ValueKind);
        Assert.False(listed.GetProperty("changedSinceExport").GetBoolean());

        await app.Put($"/api/invoices/{id}", new
        {
            billDate = "2026-11-29", periodFrom = "2026-11-01", periodTo = "2026-11-29", notes = "", refreshParty = false,
            lines = bill.GetProperty("lines"),
        }).Ok();
        Assert.True((await app.Get("/api/invoices").Ok())[0].GetProperty("changedSinceExport").GetBoolean());

        using var importForm = new MultipartFormDataContent
        {
            { new ByteArrayContent(filled), "file", "MPH BILL--NOV.-26-27.xlsm" },
            { new StringContent("false"), "commit" },
        };
        var import = await app.PostAsync(new Uri("/api/billing/import", UriKind.Relative), importForm).Ok();
        Assert.Contains(import.GetProperty("errors").EnumerateArray(), e => e.GetString()!.StartsWith("Bill 26-27\\JOB\\279 is already in the app but differs", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Importing_the_filled_workbook_skips_the_bills_the_app_already_has()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var id = (await SavedBill(app, 1)).GetProperty("id").GetInt64();
        using var exportForm = Form(Workbook(), new { ids = new[] { id } });
        using var response = await app.PostAsync(new Uri("/api/billing/excel/export", UriKind.Relative), exportForm);
        var filled = await response.Content.ReadAsByteArrayAsync();

        using var importForm = new MultipartFormDataContent
        {
            { new ByteArrayContent(filled), "file", "MPH BILL--NOV.-26-27.xlsm" },
            { new StringContent("true"), "commit" },
        };
        var import = await app.PostAsync(new Uri("/api/billing/import", UriKind.Relative), importForm).Ok();
        Assert.Empty(import.GetProperty("errors").EnumerateArray());
        Assert.Equal(1, import.GetProperty("alreadyInApp").GetInt32());
        Assert.Equal(0, import.GetProperty("invoices").GetInt32());
        Assert.False(import.GetProperty("imported").GetBoolean());
        Assert.Contains(import.GetProperty("warnings").EnumerateArray(), w => w.GetString()!.StartsWith("Nothing new to import", StringComparison.Ordinal));
        Assert.Single((await app.Get("/api/invoices").Ok()).EnumerateArray());
    }

    [Fact]
    public async Task Export_needs_ticked_bills_and_a_workbook_it_can_write()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var id = (await SavedBill(app, 1)).GetProperty("id").GetInt64();

        using var none = Form(Workbook(), new { ids = Array.Empty<long>() });
        Assert.Equal(["Tick the bills to write to Excel."], await app.PostAsync(new Uri("/api/billing/excel/preview", UriKind.Relative), none).Refused());

        using var xls = Form(Workbook(), new { ids = new[] { id } }, "old.xls");
        Assert.Contains("only be written into an .xlsm or .xlsx", (await app.PostAsync(new Uri("/api/billing/excel/export", UriKind.Relative), xls).Refused())[0], StringComparison.Ordinal);

        using var unknown = Form(Workbook(), new { ids = new[] { id + 99 } });
        await app.PostAsync(new Uri("/api/billing/excel/preview", UriKind.Relative), unknown).Refused(HttpStatusCode.NotFound);

        var first = Workbook();
        using var once = Form(first, new { ids = new[] { id } });
        using var written = await app.PostAsync(new Uri("/api/billing/excel/export", UriKind.Relative), once);
        using var again = Form(await written.Content.ReadAsByteArrayAsync(), new { ids = new[] { id } });
        var nothing = await app.PostAsync(new Uri("/api/billing/excel/export", UriKind.Relative), again).Refused();
        Assert.StartsWith("Nothing to write: the workbook already has", nothing[0], StringComparison.Ordinal);
    }
}
