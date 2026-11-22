using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using MPHRegister.Shared.Configuration;
using static MPHRegister.UnitTests.Api.Http;

namespace MPHRegister.UnitTests.Api;

[Collection("api")]
public sealed class ApiFreshFolderTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task A_new_data_folder_starts_with_an_empty_skeleton_config_file()
    {
        var app = factory.App();
        var info = await app.Get("/api/info").Ok();
        Assert.Equal(factory.ConfigPath, info.GetProperty("configFile").GetString());
        Assert.Equal("environment", info.GetProperty("dataFolderSource").GetString());
        Assert.Equal("light", info.GetProperty("theme").GetString());
        Assert.Equal("en", info.GetProperty("language").GetString());
        Assert.True(info.GetProperty("showExcelImport").GetBoolean());
        Assert.False(info.GetProperty("showBillingStyles").GetBoolean());
        Assert.True(info.GetProperty("showPartywise").GetBoolean());
        Assert.True(info.GetProperty("showBills").GetBoolean());
        Assert.True(info.GetProperty("showColors").GetBoolean());
        var masters = await app.Get("/api/masters/full").Ok();
        Assert.Equal(0, masters.GetProperty("parties").GetArrayLength());
        Assert.Equal(0, masters.GetProperty("finishes").GetArrayLength());
        Assert.Equal(1, masters.GetProperty("styles").GetArrayLength());
        Assert.True(masters.GetProperty("colors").GetArrayLength() > 0);
        Assert.True(File.Exists(factory.ConfigPath));
        Assert.Empty(factory.ConfigOnDisk.Parties);
        var settings = await app.Get("/api/settings").Ok();
        Assert.False(settings.GetProperty("hasSignature").GetBoolean());
        Assert.Equal(25, settings.GetProperty("limits").GetProperty("templateRows").GetInt32());
    }
}

[Collection("api")]
public sealed class ApiBasicsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Writes_without_the_app_header_are_refused()
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("http://127.0.0.1") });
        var response = await client.PutAsJsonAsync("/api/settings", new { display = new { theme = "dark" } });
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var delete = await client.DeleteAsync(new Uri("/api/masters/color?name=black", UriKind.Relative));
        Assert.Equal(HttpStatusCode.Forbidden, delete.StatusCode);
    }

    [Fact]
    public async Task Other_host_names_are_refused()
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("http://evil.example") });
        var response = await client.GetAsync(new Uri("/api/info", UriKind.Relative));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Validation_errors_come_back_as_a_list()
    {
        var errors = await factory.App().Post("/api/entries", new { registerMonth = "2026-11", inwardNo = 1, entryDate = "2026-11-02", party = "NOT A PARTY", finish = "NOPE", than = 0, twoPart = 1 }).Refused();
        Assert.Contains("Party \"NOT A PARTY\" is not in the party list.", errors);
        Assert.Contains("Finish \"NOPE\" is not in the finish list.", errors);
        Assert.Contains("THAN + TP must be more than 0.", errors);
        await factory.App().Get("/api/entries/999999").Refused(HttpStatusCode.NotFound);
        var unreadable = await factory.App().Post("/api/masters/style", new { name = "S", gpnColumn = "sideways" }).Refused();
        Assert.Contains("\"gpnColumn\" has a value the app does not understand.", unreadable);
    }

    [Fact]
    public async Task Print_template_is_layout_only_and_the_print_page_fonts_are_served()
    {
        var app = factory.App();
        var template = await app.Get("/bill-template.json").Ok();
        Assert.Equal(7, template.GetProperty("columnsPx").GetArrayLength());
        Assert.Equal(25, template.GetProperty("lineRows").GetProperty("count").GetInt32());
        Assert.DoesNotContain(template.GetProperty("cells").EnumerateArray(), c => c.TryGetProperty("text", out _));
        Assert.Contains("print.js", await app.GetStringAsync(new Uri("/print.html", UriKind.Relative)), StringComparison.Ordinal);
        Assert.Contains("i18n.js", await app.GetStringAsync(new Uri("/print.html", UriKind.Relative)), StringComparison.Ordinal);
        Assert.Contains("i18n.js", await app.GetStringAsync(new Uri("/", UriKind.Relative)), StringComparison.Ordinal);
        using var font = await app.Get("/fonts/Carlito-Regular.woff2");
        Assert.Equal(HttpStatusCode.OK, font.StatusCode);
        Assert.Equal("font/woff2", font.Content.Headers.ContentType?.MediaType);
        Assert.Contains("SIL OPEN FONT LICENSE", (await app.GetStringAsync(new Uri("/fonts/Carlito-OFL.txt", UriKind.Relative))).ToUpperInvariant(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Ui_uses_custom_modals_and_never_calls_browser_dialogs()
    {
        var app = factory.App();
        Assert.Contains("id=\"appDialog\"", await app.GetStringAsync(new Uri("/", UriKind.Relative)), StringComparison.Ordinal);
        foreach (var script in new[] { "/app.js", "/bills.js", "/masters.js", "/i18n.js", "/print.js" })
        {
            var source = await app.GetStringAsync(new Uri(script, UriKind.Relative));
            Assert.DoesNotMatch(@"(?<!\w)(?:window\.)?(?:alert|confirm|prompt)\s*\(", source);
        }
    }

    [Fact]
    public async Task Entries_keep_the_spelling_of_the_lists_and_lower_case_json_values()
    {
        var app = factory.App();
        await Setup.Basics(app);
        await app.Post("/api/masters/party", Setup.Party("SPELLED PARTY")).Ok();
        var entry = await app.Post("/api/entries", new
        {
            registerMonth = "2026-12", inwardNo = 1, entryDate = "2026-12-02", party = "  spelled   party ", finish = "f1", than = 10,
            dispatches = new[] { new { qty = 4, gatePass = "G1", date = "2026-12-03" } },
        }).Ok();
        Assert.Equal("partial", entry.GetProperty("status").GetString());
        Assert.Equal("SPELLED PARTY", entry.GetProperty("party").GetString());
        Assert.Equal("F1", entry.GetProperty("finish").GetString());
        var duplicate = await app.Post("/api/entries", Setup.Entry(1, "SPELLED PARTY", month: "2026-12")).Refused();
        Assert.Contains(duplicate, e => e.Contains("already used this month", StringComparison.Ordinal));
        var nextDec = await app.Get("/api/next-inward?month=2026-12").Ok();
        Assert.Equal(("2026-12", 2), (nextDec.GetProperty("month").GetString(), nextDec.GetProperty("next").GetInt32()));
        var nextDefault = await app.Get("/api/next-inward").Ok();
        Assert.Equal(DateTime.Now.ToString("yyyy-MM", System.Globalization.CultureInfo.InvariantCulture), nextDefault.GetProperty("month").GetString());
        var info = await app.Get("/api/info").Ok();
        Assert.False(info.TryGetProperty("registerMonth", out _));
        Assert.DoesNotContain("id=\"registerMonth\"", await app.GetStringAsync(new Uri("/", UriKind.Relative)), StringComparison.Ordinal);
    }
}

[Collection("api")]
public sealed class ApiMastersTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private async Task<HttpClient> Ready()
    {
        var app = factory.App();
        if (!factory.ConfigOnDisk.Finishes.Any()) await Setup.Basics(app);
        return app;
    }

    private static JsonElement Find(JsonElement list, string name) =>
        list.EnumerateArray().Single(x => string.Equals(x.GetProperty("name").GetString(), name, StringComparison.OrdinalIgnoreCase));

    [Fact]
    public async Task Rates_are_added_edited_and_deleted_one_at_a_time_and_saved_in_the_config_file()
    {
        var app = await Ready();
        await app.Post("/api/masters/party", Setup.Party("RATE PARTY")).Ok();
        var added = await app.Put("/api/masters/party/rate", new { party = "rate party", finish = "f1", rate = 90.5m }).Ok();
        Assert.Equal(90.5m, added.GetProperty("rates").GetProperty("F1").GetDecimal());
        await app.Put("/api/masters/party/rate", new { party = "RATE PARTY", finish = "F2", rate = 50 }).Ok();
        var duplicate = await app.Put("/api/masters/party/rate", new { party = "RATE PARTY", finish = "F1", rate = 1 }).Refused();
        Assert.Contains(duplicate, e => e.Contains("already has a rate for F1; edit that row instead", StringComparison.Ordinal));
        var edited = await app.Put("/api/masters/party/rate", new { party = "RATE PARTY", finish = "F1", originalFinish = "F1", rate = 91 }).Ok();
        Assert.Equal(91, edited.GetProperty("rates").GetProperty("F1").GetDecimal());
        var moved = await app.Put("/api/masters/party/rate", new { party = "RATE PARTY", finish = "F3", originalFinish = "F1", rate = 92 }).Ok();
        Assert.Equal(["F3", "F2"], moved.GetProperty("rates").EnumerateObject().Select(p => p.Name));
        var deleted = await app.Delete($"/api/masters/party/rate?party={Q("RATE PARTY")}&finish=F2").Ok();
        Assert.Equal(["F3"], deleted.GetProperty("rates").EnumerateObject().Select(p => p.Name));
        await app.Delete($"/api/masters/party/rate?party={Q("RATE PARTY")}&finish=F2").Refused(HttpStatusCode.NotFound);
        Assert.Contains("must be more than 0", (await app.Put("/api/masters/party/rate", new { party = "RATE PARTY", finish = "F1", rate = 0 }).Refused())[0], StringComparison.Ordinal);
        Assert.Contains("not in the finish list", (await app.Put("/api/masters/party/rate", new { party = "RATE PARTY", finish = "NOPE", rate = 5 }).Refused())[0], StringComparison.Ordinal);
        var onDisk = factory.ConfigOnDisk.Parties.Single(p => p.Name == "RATE PARTY");
        Assert.Equal(new Dictionary<string, decimal> { ["F3"] = 92 }, onDisk.Rates.ToDictionary(kv => kv.Key, kv => kv.Value));
        var saveAgain = await app.Post("/api/masters/party", Setup.Party("RATE PARTY", original: "RATE PARTY", discount: 12)).Ok();
        Assert.Single(saveAgain.GetProperty("rates").EnumerateObject());
    }

    [Fact]
    public async Task Renaming_a_party_moves_its_entries_and_keeps_its_sister_group()
    {
        var app = await Ready();
        await app.Post("/api/masters/party", Setup.Party("OLD NAME", sisterGroup: "RENAME GROUP")).Ok();
        await app.Post("/api/masters/party", Setup.Party("CHILD OF OLD", sisterGroup: "RENAME GROUP")).Ok();
        await app.Put("/api/masters/party/rate", new { party = "OLD NAME", finish = "F1", rate = 10 }).Ok();
        var entry = await app.Post("/api/entries", Setup.Entry(501, "OLD NAME")).Ok();
        await app.Post("/api/masters/party", Setup.Party("NEW NAME", original: "OLD NAME")).Ok();
        var moved = await app.Get($"/api/entries/{entry.GetProperty("id").GetInt64()}").Ok();
        Assert.Equal("NEW NAME", moved.GetProperty("party").GetString());
        var config = factory.ConfigOnDisk;
        Assert.DoesNotContain(config.Parties, p => p.Name == "OLD NAME");
        Assert.Equal(["CHILD OF OLD"], ConfigIndex.For(config).SisterFirms("NEW NAME").Select(p => p.Name));
        Assert.Equal(10, config.Parties.Single(p => p.Name == "NEW NAME").Rates["F1"]);
        var clash = await app.Post("/api/masters/party", Setup.Party("NEW NAME", original: "CHILD OF OLD")).Refused();
        Assert.Contains(clash, e => e.Contains("already exists", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Legacy_bill_to_is_no_longer_editable_in_party_masters()
    {
        var app = await Ready();
        var party = await app.Post("/api/masters/party", new { name = "OLD CLIENT", active = true, billTo = "OTHER TOP" }).Ok();
        Assert.False(party.TryGetProperty("billTo", out _));
        Assert.Null(factory.ConfigOnDisk.Parties.Single(p => p.Name == "OLD CLIENT").BillTo);
    }

    [Fact]
    public async Task Renaming_a_finish_follows_it_into_entries_rates_bill_as_and_fallbacks()
    {
        var app = await Ready();
        await app.Post("/api/masters/finish", new { name = "OLDF", active = true, group = "G1", color = "black" }).Ok();
        await app.Post("/api/masters/finish", new { name = "FB", active = true, group = "", color = "black", fallback = new[] { "OLDF" } }).Ok();
        var party = Setup.Party("FINISH PARTY");
        await app.Post("/api/masters/party", party).Ok();
        await app.Post("/api/masters/party", new
        {
            originalName = "FINISH PARTY", name = "FINISH PARTY", active = true, color = "navy", billingStyle = "GATE PASS STYLE", billAs = new Dictionary<string, string> { ["OLDF"] = "F1", ["F2"] = "OLDF" },
        }).Ok();
        await app.Put("/api/masters/party/rate", new { party = "FINISH PARTY", finish = "OLDF", rate = 33 }).Ok();
        var entry = await app.Post("/api/entries", Setup.Entry(601, "FINISH PARTY", finish: "OLDF")).Ok();
        await app.Post("/api/masters/finish", new { originalName = "OLDF", name = "NEWF", active = true, group = "G1", color = "black" }).Ok();
        Assert.Equal("NEWF", (await app.Get($"/api/entries/{entry.GetProperty("id").GetInt64()}").Ok()).GetProperty("finish").GetString());
        var config = factory.ConfigOnDisk;
        var p = config.Parties.Single(x => x.Name == "FINISH PARTY");
        Assert.Equal(33, p.Rates["NEWF"]);
        Assert.Equal(("F1", "NEWF"), (p.BillAs["NEWF"], p.BillAs["F2"]));
        Assert.Equal(["NEWF"], config.Finishes.Single(f => f.Name == "FB").BillAsIfNoRate);
    }

    [Fact]
    public async Task Styles_are_shared_renamed_with_their_parties_and_kept_while_used()
    {
        var app = await Ready();
        var style = new { name = "SHARED", gpnColumn = "blank", dnColumn = "designNo", lotColumn = "blank", lines = "sameLot", order = "reference", showQuantityBreakdown = true, combineSmallEntries = true };
        await app.Post("/api/masters/style", style).Ok();
        await app.Post("/api/masters/party", Setup.Party("STYLE A", style: "shared")).Ok();
        await app.Post("/api/masters/party", Setup.Party("STYLE B", style: "SHARED")).Ok();
        var renamed = await app.Post("/api/masters/style", new { originalName = "SHARED", name = "SHARED 2", gpnColumn = "gatePass", dnColumn = "designNo", lotColumn = "blank", lines = "sameLot", order = "reference", showQuantityBreakdown = true, combineSmallEntries = true }).Ok();
        Assert.Equal(2, renamed.GetProperty("parties").GetInt32());
        var parties = (await app.Get("/api/masters/full").Ok()).GetProperty("parties");
        var a = Find(parties, "STYLE A");
        Assert.Equal("SHARED 2", a.GetProperty("billingStyle").GetString());
        Assert.Equal("gatePass", a.GetProperty("style").GetProperty("gpnColumn").GetString());
        var inUse = await app.Delete($"/api/masters/style?name={Q("SHARED 2")}").Refused();
        Assert.Contains(inUse, e => e.Contains("is used by STYLE A, STYLE B", StringComparison.Ordinal));
        Assert.Contains("Billing style \"NOPE\" is not in the list of billing styles.", await app.Post("/api/masters/party", Setup.Party("STYLE C", style: "NOPE")).Refused());
        await app.Post("/api/masters/style", new { name = "SPARE", gpnColumn = "blank", dnColumn = "designNo", lotColumn = "lotNo", lines = "onePerEntry", order = "inward" }).Ok();
        using (var gone = await app.Delete("/api/masters/style?name=SPARE")) Assert.Equal(HttpStatusCode.NoContent, gone.StatusCode);
        Assert.DoesNotContain(factory.ConfigOnDisk.BillingStyles, s => s.Name == "SPARE");
        var preview = await app.Post("/api/masters/style/preview", style).Ok();
        Assert.Contains(preview.EnumerateArray(), l => l.GetProperty("lot").GetString()!.Contains('+', StringComparison.Ordinal) || l.GetProperty("dn").GetString()!.Contains('+', StringComparison.Ordinal));
        Assert.Contains(preview.EnumerateArray(), l => l.GetProperty("kind").GetString() == "priced");
    }

    [Fact]
    public async Task Colours_are_renamed_everywhere_and_kept_while_used()
    {
        var app = await Ready();
        await app.Post("/api/masters/color", new { name = "plum", hex = "#8E4585" }).Ok();
        await app.Post("/api/masters/party", new { name = "COLOUR PARTY", active = true, color = "PLUM", billingStyle = "GATE PASS STYLE" }).Ok();
        await app.Post("/api/masters/finish", new { name = "COLOUR FINISH", active = true, group = "", color = "plum" }).Ok();
        var renamed = await app.Post("/api/masters/color", new { originalName = "plum", name = "deep plum", hex = "#8e4585" }).Ok();
        Assert.Equal((1, 1), (renamed.GetProperty("parties").GetInt32(), renamed.GetProperty("finishes").GetInt32()));
        var config = factory.ConfigOnDisk;
        Assert.Equal("deep plum", config.Parties.Single(p => p.Name == "COLOUR PARTY").Color);
        Assert.Equal("deep plum", config.Finishes.Single(f => f.Name == "COLOUR FINISH").Color);
        Assert.Contains(await app.Delete($"/api/masters/color?name={Q("deep plum")}").Refused(), e => e.Contains("COLOUR PARTY", StringComparison.Ordinal));
        Assert.Contains("Colour \"mauve\" is not in the colour list.", await app.Post("/api/masters/party", new { name = "X", active = true, color = "mauve" }).Refused());
        await app.Post("/api/masters/party", new { name = "HEX PARTY", active = true, color = "#123456" }).Ok();
    }

    [Fact]
    public async Task Groups_and_finishes_check_their_references()
    {
        var app = await Ready();
        Assert.Contains("Finish group \"NOGROUP\" is not in the group list.", await app.Post("/api/masters/finish", new { name = "FX", active = true, group = "NOGROUP", color = "black" }).Refused());
        Assert.Contains("Fallback finish \"NOPE\" is not in the finish list.", await app.Post("/api/masters/finish", new { name = "FX", active = true, color = "black", fallback = new[] { "NOPE" } }).Refused());
        await app.Post("/api/masters/group", new { name = "G-OLD", active = true }).Ok();
        await app.Post("/api/masters/finish", new { name = "FG", active = true, group = "g-old", color = "black" }).Ok();
        var renamed = await app.Post("/api/masters/group", new { originalName = "G-OLD", name = "G-NEW", active = false }).Ok();
        Assert.Equal(1, renamed.GetProperty("finishes").GetInt32());
        Assert.Equal("G-NEW", factory.ConfigOnDisk.Finishes.Single(f => f.Name == "FG").Group);
    }

    [Fact]
    public async Task Display_language_defaults_to_en_and_persists_in_config()
    {
        var app = await Ready();
        var info = await app.Get("/api/info").Ok();
        Assert.Equal("en", info.GetProperty("language").GetString());
        var saved = await app.Put("/api/settings", new { display = new { theme = "light", language = "hi", showExcelImport = true } }).Ok();
        Assert.Equal("hi", saved.GetProperty("display").GetProperty("language").GetString());
        Assert.Equal("hi", (await app.Get("/api/info").Ok()).GetProperty("language").GetString());
        Assert.Equal(MPHRegister.Shared.Enums.UiLanguage.Hi, factory.ConfigOnDisk.Display.Language);
        var bad = await app.Put("/api/settings", new { display = new { theme = "light", language = "fr", showExcelImport = true } }).Refused();
        Assert.Contains(bad, e => e.Contains("language", StringComparison.OrdinalIgnoreCase));
        await app.Put("/api/settings", new { display = new { theme = "light", language = "en", showExcelImport = true } }).Ok();
    }

    [Fact]
    public async Task Feature_visibility_settings_default_and_persist_in_config()
    {
        var app = await Ready();
        var html = await app.GetStringAsync(new Uri("/", UriKind.Relative));
        Assert.Contains("id=\"sideMenu\"", html, StringComparison.Ordinal);
        Assert.Contains("id=\"menuToggle\"", html, StringComparison.Ordinal);
        Assert.Contains("id=\"langSwitch\"", html, StringComparison.Ordinal);
        Assert.Contains("id=\"themeSwitch\"", html, StringComparison.Ordinal);
        Assert.Contains("id=\"menuSettings\"", html, StringComparison.Ordinal);
        Assert.Contains("id=\"view-settings\"", html, StringComparison.Ordinal);
        Assert.DoesNotContain("id=\"masters-firm\"", html, StringComparison.Ordinal);

        var initial = await app.Get("/api/info").Ok();
        Assert.False(initial.GetProperty("showBillingStyles").GetBoolean());
        Assert.True(initial.GetProperty("showPartywise").GetBoolean());
        Assert.True(initial.GetProperty("showBills").GetBoolean());
        Assert.True(initial.GetProperty("showColors").GetBoolean());

        var saved = await app.Put("/api/settings", new
        {
            display = new DisplaySettings
            {
                ShowBillingStyles = true,
                ShowColors = false,
                ShowPartywise = false,
                ShowBills = false,
                ShowExcelImport = false,
            },
        }).Ok();
        var display = saved.GetProperty("display");
        Assert.True(display.GetProperty("showBillingStyles").GetBoolean());
        Assert.False(display.GetProperty("showColors").GetBoolean());
        Assert.False(display.GetProperty("showPartywise").GetBoolean());
        Assert.False(display.GetProperty("showBills").GetBoolean());
        Assert.False(display.GetProperty("showExcelImport").GetBoolean());

        var updatedInfo = await app.Get("/api/info").Ok();
        Assert.True(updatedInfo.GetProperty("showBillingStyles").GetBoolean());
        Assert.False(updatedInfo.GetProperty("showColors").GetBoolean());
        Assert.False(updatedInfo.GetProperty("showPartywise").GetBoolean());
        Assert.False(updatedInfo.GetProperty("showBills").GetBoolean());
        Assert.False(updatedInfo.GetProperty("showExcelImport").GetBoolean());

        await app.Put("/api/settings", new { display = new DisplaySettings() }).Ok();
    }
}

[Collection("api")]
public sealed class ApiSisterGroupTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private async Task<HttpClient> Ready()
    {
        var app = factory.App();
        if (!factory.ConfigOnDisk.Finishes.Any()) await Setup.Basics(app);
        return app;
    }

    private static string? GroupOf(IEnumerable<PartyConfig> parties, string name) => parties.Single(p => p.Name == name).SisterGroup;

    [Fact]
    public async Task A_sister_group_is_made_renamed_changed_and_removed_as_a_whole()
    {
        var app = await Ready();
        foreach (var party in new[] { "SIS A", "SIS B", "SIS C", "SIS D" }) await app.Post("/api/masters/party", Setup.Party(party)).Ok();

        var made = await app.Post("/api/masters/sister-group", new { name = "  FAMILY  ", parties = new[] { "SIS A", "sis b", "SIS B" } }).Ok();
        Assert.Equal("FAMILY", made.GetProperty("name").GetString());
        Assert.Equal(["SIS A", "SIS B"], made.GetProperty("parties").EnumerateArray().Select(p => p.GetString()));
        Assert.Equal(["FAMILY", "FAMILY", string.Empty], new[] { "SIS A", "SIS B", "SIS C" }.Select(p => GroupOf(factory.ConfigOnDisk.Parties, p)));

        // Renaming and changing the members in one save: C joins, A leaves, and the other party fields stay as they were.
        await app.Post("/api/masters/sister-group", new { originalName = "family", name = "CLAN", parties = new[] { "SIS B", "SIS C" } }).Ok();
        var disk = factory.ConfigOnDisk.Parties;
        Assert.Equal([string.Empty, "CLAN", "CLAN", string.Empty], new[] { "SIS A", "SIS B", "SIS C", "SIS D" }.Select(p => GroupOf(disk, p)));
        Assert.Equal(10, disk.Single(p => p.Name == "SIS A").DiscountPercent);
        var parties = (await app.Get("/api/masters/full").Ok()).GetProperty("parties").EnumerateArray().Where(p => p.GetProperty("sisterGroup").GetString() == "CLAN");
        Assert.Equal(["SIS B", "SIS C"], parties.Select(p => p.GetProperty("name").GetString()).Order(StringComparer.Ordinal));

        // A party moved into another group leaves its old one.
        await app.Post("/api/masters/sister-group", new { name = "OTHERS", parties = new[] { "SIS D" } }).Ok();
        Assert.Contains(await app.Post("/api/masters/sister-group", new { originalName = "OTHERS", name = "clan", parties = new[] { "SIS D" } }).Refused(),
            e => e.Contains("already exists", StringComparison.Ordinal));

        await app.Delete("/api/masters/sister-group?name=clan").Ok();
        Assert.All(new[] { "SIS A", "SIS B", "SIS C" }, p => Assert.Equal(string.Empty, GroupOf(factory.ConfigOnDisk.Parties, p)));
        Assert.Equal("OTHERS", GroupOf(factory.ConfigOnDisk.Parties, "SIS D"));
        await app.Delete("/api/masters/sister-group?name=CLAN").Refused(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_sister_group_needs_a_name_known_parties_and_a_group_that_still_exists()
    {
        var app = await Ready();
        await app.Post("/api/masters/party", Setup.Party("SIS E")).Ok();
        Assert.Contains(await app.Post("/api/masters/sister-group", new { name = " ", parties = new[] { "SIS E" } }).Refused(), e => e.Contains("name is required", StringComparison.Ordinal));
        Assert.Contains(await app.Post("/api/masters/sister-group", new { name = "G", parties = Array.Empty<string>() }).Refused(), e => e.Contains("at least one party", StringComparison.Ordinal));
        Assert.Contains(await app.Post("/api/masters/sister-group", new { name = "G", parties = new[] { "NOBODY" } }).Refused(), e => e.Contains("not in the party list", StringComparison.Ordinal));
        Assert.Contains(await app.Post("/api/masters/sister-group", new { originalName = "GONE", name = "G", parties = new[] { "SIS E" } }).Refused(), e => e.Contains("no longer exists", StringComparison.Ordinal));
        Assert.Equal(string.Empty, GroupOf(factory.ConfigOnDisk.Parties, "SIS E"));
    }
}
