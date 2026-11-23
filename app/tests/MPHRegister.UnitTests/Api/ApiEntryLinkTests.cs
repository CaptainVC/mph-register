using System.Text.Json;
using static MPHRegister.UnitTests.Api.Http;

namespace MPHRegister.UnitTests.Api;

[Collection("api")]
public sealed class ApiEntryLinkTests
{
    private static async Task<HttpClient> Ready(ApiFactory factory)
    {
        var app = factory.App();
        await Setup.Basics(app);
        await app.Post("/api/masters/party", Setup.Party("LINK A", sisterGroup: "LINK FAMILY")).Ok();
        await app.Post("/api/masters/party", Setup.Party("LINK A SISTER", sisterGroup: "LINK FAMILY")).Ok();
        await app.Post("/api/masters/party", Setup.Party("LINK B")).Ok();
        return app;
    }

    private static async Task<JsonElement> Add(HttpClient app, string month, int inward, string party, int than, string dn = "") =>
        await app.Post("/api/entries", new
        {
            registerMonth = month, inwardNo = inward, entryDate = $"{month}-24", party, designNo = dn, lotNo = "", repair = false, than, tp = 0, twoPart = 0,
            finish = than > 0 ? "F1" : "", dispatches = Array.Empty<DispatchBody>(),
        }).Ok();

    private static async Task<JsonElement> Read(HttpClient app, long id) => await app.Get($"/api/entries/{id}").Ok();

    private static JsonElement[] Links(JsonElement entry) =>
        entry.TryGetProperty("links", out var links) && links.ValueKind == JsonValueKind.Array ? links.EnumerateArray().ToArray() : [];

    [Fact]
    public async Task All_zero_slip_links_to_the_earlier_entry_its_DN_names_and_the_entry_links_back()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var original = await Add(app, "2026-06", 547, "LINK A", 48, "D-1");
        var zero = await Add(app, "2026-07", 3, "LINK A", 0, "INW NO 547");

        var forward = Assert.Single(Links(await Read(app, zero.GetProperty("id").GetInt64())));
        Assert.Equal("earlier", forward.GetProperty("direction").GetString());
        Assert.Equal("found", forward.GetProperty("state").GetString());
        Assert.Equal(original.GetProperty("id").GetInt64(), forward.GetProperty("entryId").GetInt64());
        Assert.Equal("2026-06", forward.GetProperty("registerMonth").GetString());
        Assert.Equal(48, forward.GetProperty("than").GetInt32());

        var back = Assert.Single(Links(await Read(app, original.GetProperty("id").GetInt64())));
        Assert.Equal("later", back.GetProperty("direction").GetString());
        Assert.Equal(zero.GetProperty("id").GetInt64(), back.GetProperty("entryId").GetInt64());
        Assert.Equal(3, back.GetProperty("inwardNo").GetInt32());
        Assert.Equal("2026-07", back.GetProperty("registerMonth").GetString());
    }

    [Theory]
    [InlineData("INW NO 547")]
    [InlineData("INW NO,547")]
    [InlineData("INW NO ,547")]
    [InlineData("inw no 547")]
    public async Task The_ways_the_DN_is_written_are_all_read(string dn)
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        await Add(app, "2026-06", 547, "LINK A", 48);
        var zero = await Add(app, "2026-07", 3, "LINK A", 0, dn);
        Assert.Equal("found", Assert.Single(Links(await Read(app, zero.GetProperty("id").GetInt64()))).GetProperty("state").GetString());
    }

    [Fact]
    public async Task A_DN_that_is_a_design_number_or_an_entry_with_THAN_gets_no_link()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        await Add(app, "2026-06", 547, "LINK A", 48);
        var design = await Add(app, "2026-07", 3, "LINK A", 0, "D-547");
        var normal = await Add(app, "2026-07", 4, "LINK A", 10, "INW NO 547");
        Assert.Empty(Links(await Read(app, design.GetProperty("id").GetInt64())));
        Assert.Empty(Links(await Read(app, normal.GetProperty("id").GetInt64())));
    }

    [Fact]
    public async Task A_slip_of_the_same_month_or_a_later_month_is_not_an_earlier_entry()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        await Add(app, "2026-07", 547, "LINK A", 48);
        await Add(app, "2026-08", 547, "LINK A", 48);
        var zero = await Add(app, "2026-07", 3, "LINK A", 0, "INW NO 547");
        var link = Assert.Single(Links(await Read(app, zero.GetProperty("id").GetInt64())));
        Assert.Equal("notFound", link.GetProperty("state").GetString());
        Assert.Equal(547, link.GetProperty("inwardNo").GetInt32());
        Assert.Equal(JsonValueKind.Null, link.GetProperty("entryId").ValueKind);
    }

    [Fact]
    public async Task The_same_party_wins_over_a_nearer_month_of_another_party_and_a_sister_firm_counts_as_the_same()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var sister = await Add(app, "2026-05", 547, "LINK A SISTER", 20);
        await Add(app, "2026-06", 547, "LINK B", 48);
        var zero = await Add(app, "2026-07", 3, "LINK A", 0, "INW NO 547");
        var link = Assert.Single(Links(await Read(app, zero.GetProperty("id").GetInt64())));
        Assert.Equal("found", link.GetProperty("state").GetString());
        Assert.Equal(sister.GetProperty("id").GetInt64(), link.GetProperty("entryId").GetInt64());
    }

    [Fact]
    public async Task Another_party_is_flagged_not_trusted_and_the_nearest_month_is_taken()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        await Add(app, "2026-05", 553, "LINK B", 20);
        var june = await Add(app, "2026-06", 553, "LINK B", 30);
        var zero = await Add(app, "2026-07", 20, "LINK A", 0, "INW NO,553");
        var link = Assert.Single(Links(await Read(app, zero.GetProperty("id").GetInt64())));
        Assert.Equal("otherParty", link.GetProperty("state").GetString());
        Assert.Equal(june.GetProperty("id").GetInt64(), link.GetProperty("entryId").GetInt64());
        Assert.Equal("LINK B", link.GetProperty("party").GetString());
        Assert.Equal("otherParty", Assert.Single(Links(await Read(app, june.GetProperty("id").GetInt64()))).GetProperty("state").GetString());
    }

    [Fact]
    public async Task A_DN_naming_several_slips_links_each_of_them()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        await Add(app, "2026-06", 547, "LINK A", 48);
        await Add(app, "2026-06", 548, "LINK A", 36);
        var zero = await Add(app, "2026-07", 3, "LINK A", 0, "INW NO 547, 548, 999");
        var links = Links(await Read(app, zero.GetProperty("id").GetInt64()));
        Assert.Equal([547, 548, 999], links.Select(l => l.GetProperty("inwardNo").GetInt32()).ToArray());
        Assert.Equal(["found", "found", "notFound"], links.Select(l => l.GetProperty("state").GetString()!).ToArray());
    }

    [Fact]
    public async Task The_register_list_carries_the_links_and_a_corrected_DN_changes_them()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        await Add(app, "2026-06", 547, "LINK A", 48);
        var zero = await Add(app, "2026-07", 3, "LINK A", 0, "INW NO 999");
        var id = zero.GetProperty("id").GetInt64();
        var row = (await app.Get("/api/entries?month=2026-07").Ok()).EnumerateArray().Single();
        Assert.Equal("notFound", Assert.Single(Links(row)).GetProperty("state").GetString());

        await app.Put($"/api/entries/{id}", new
        {
            registerMonth = "2026-07", inwardNo = 3, entryDate = "2026-07-24", party = "LINK A", designNo = "INW NO 547", lotNo = "", repair = false,
            than = 0, tp = 0, twoPart = 0, finish = "", dispatches = Array.Empty<DispatchBody>(),
        }).Ok();
        Assert.Equal("found", Assert.Single(Links(await Read(app, id))).GetProperty("state").GetString());
    }

    [Fact]
    public async Task The_entry_form_can_ask_what_a_DN_would_link_to_before_the_entry_is_saved()
    {
        using var factory = new ApiFactory();
        using var app = await Ready(factory);
        var original = await Add(app, "2026-06", 547, "LINK A", 48);

        var found = Assert.Single((await app.Get($"/api/entries/links?month=2026-07&party={Q("LINK A")}&designNo={Q("INW NO 547")}").Ok()).EnumerateArray());
        Assert.Equal("found", found.GetProperty("state").GetString());
        Assert.Equal(original.GetProperty("id").GetInt64(), found.GetProperty("entryId").GetInt64());

        Assert.Empty((await app.Get($"/api/entries/links?month=2026-07&party={Q("LINK A")}&designNo={Q("D-547")}").Ok()).EnumerateArray());
        Assert.Empty((await app.Get($"/api/entries/links?month=bad&party={Q("LINK A")}&designNo={Q("INW NO 547")}").Ok()).EnumerateArray());
    }
}
