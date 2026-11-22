using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using MPHRegister.Api.Configuration;
using MPHRegister.Data.Database;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Json;

namespace MPHRegister.UnitTests.Api;

[CollectionDefinition("api", DisableParallelization = true)]
public sealed class ApiTestGroup;

/// <summary>The real app (controllers, middleware, services, SQLite, config file) on its own empty data folder.</summary>
public class ApiFactory : WebApplicationFactory<Program>
{
    public ApiFactory()
    {
        // Program reads these at start-up; a port nobody uses keeps the single-instance check away from the real app on 5151.
        Environment.SetEnvironmentVariable("MPH_PORT", "5199");
        Environment.SetEnvironmentVariable("MPH_DATA_DIR", DataDirectory);
        Environment.SetEnvironmentVariable("MPH_NO_BROWSER", "1");
    }

    public string DataDirectory { get; } = Directory.CreateTempSubdirectory("mph-api-").FullName;

    public string ConfigPath => Path.Combine(DataDirectory, "mph-config.json");

    public AppConfig ConfigOnDisk => ConfigJson.Deserialize(File.ReadAllText(ConfigPath));

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.ConfigureServices(services =>
        {
            services.AddSingleton(new AppOptions { Port = 5199, DataDirectory = DataDirectory, OpenBrowser = false });
            services.AddSingleton(new DataOptions { DataDirectory = DataDirectory });
        });
        builder.ConfigureTestServices(AddTestServices);
    }

    /// <summary>Replaces app services for one test class (for example the clock); runs after the app registered its own.</summary>
    protected virtual void AddTestServices(IServiceCollection services)
    {
    }

    public HttpClient App()
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("http://127.0.0.1") });
        client.DefaultRequestHeaders.Add("X-MPH-Request", "1");
        return client;
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        SqliteConnection.ClearAllPools();
        try
        {
            Directory.Delete(DataDirectory, recursive: true);
        }
        catch (IOException)
        {
            // Best-effort temp directory cleanup.
        }
    }
}

internal static class Http
{
    public static async Task<JsonElement> Ok(this Task<HttpResponseMessage> call)
    {
        using var response = await call;
        var text = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode} {response.RequestMessage?.RequestUri}: {text}");
        return text.Length == 0 ? default : JsonDocument.Parse(text).RootElement.Clone();
    }

    public static async Task<T> Ok<T>(this Task<HttpResponseMessage> call)
    {
        var json = await call.Ok();
        return json.Deserialize<T>(JsonDefaults.Options)!;
    }

    public static async Task<List<string>> Refused(this Task<HttpResponseMessage> call, HttpStatusCode status = HttpStatusCode.BadRequest)
    {
        using var response = await call;
        var text = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == status, $"expected {(int)status}, got {(int)response.StatusCode}: {text}");
        return JsonDocument.Parse(text).RootElement.GetProperty("errors").EnumerateArray().Select(e => e.GetString()!).ToList();
    }

    public static Task<HttpResponseMessage> Post(this HttpClient client, string url, object body) => client.PostAsJsonAsync(new Uri(url, UriKind.Relative), body, JsonDefaults.Options);

    public static Task<HttpResponseMessage> Put(this HttpClient client, string url, object body) => client.PutAsJsonAsync(new Uri(url, UriKind.Relative), body, JsonDefaults.Options);

    public static Task<HttpResponseMessage> Get(this HttpClient client, string url) => client.GetAsync(new Uri(url, UriKind.Relative));

    public static Task<HttpResponseMessage> Delete(this HttpClient client, string url) => client.DeleteAsync(new Uri(url, UriKind.Relative));

    public static string Q(string value) => Uri.EscapeDataString(value);
}

/// <summary>Made-up lists created through the API, the same way the Masters screens do.</summary>
internal static class Setup
{
    public static async Task Basics(HttpClient app)
    {
        await app.Post("/api/masters/color", new { name = "navy", hex = "#000080" }).Ok();
        await app.Post("/api/masters/group", new { name = "G1", active = true }).Ok();
        foreach (var finish in new[] { "F1", "F2", "F3" }) await app.Post("/api/masters/finish", new { name = finish, active = true, group = "G1", color = "black" }).Ok();
        await app.Post("/api/masters/style", new
        {
            name = "GATE PASS STYLE", description = "made up", gpnColumn = "gatePass", dnColumn = "designNo", lotColumn = "lotNo",
            lines = "onePerEntry", order = "inward", showQuantityBreakdown = false, combineSmallEntries = false,
        }).Ok();
    }

    public static object Party(string name, string style = "GATE PASS STYLE", string? sisterGroup = null, bool beforeDispatch = false, string? original = null, decimal? discount = 10, string gstin = "08TESTF9001J1ZJ", bool noBill = false) => new
    {
        originalName = original, name, active = true, address = "ADDR", state = "(HOME STATE)", gstin, discount, color = "navy",
        sisterGroup, billingStyle = style, billBeforeDispatch = beforeDispatch, noBillNeeded = noBill, billAs = new Dictionary<string, string>(),
    };

    public static object Entry(int inward, string party, string finish = "F1", int than = 10, string dn = "", string lot = "", bool dispatched = true, string gatePass = "G1", string month = "2026-10") => new
    {
        registerMonth = month, inwardNo = inward, entryDate = $"{month}-02", party, designNo = dn, lotNo = lot, repair = false, than, tp = 0, twoPart = 0, finish,
        dispatches = dispatched ? new DispatchBody[] { new(than, gatePass, $"{month}-03") } : [],
    };
}

internal sealed record DispatchBody(int Qty, string GatePass, string Date);

/// <summary>A clock stopped at one moment, so date-based figures (days waiting, this month) are the same on every run.</summary>
internal sealed class FixedClock(DateTimeOffset now) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => now;

    public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;
}
