using System.Text.Json;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Enums;

namespace MPHRegister.UnitTests.Configuration;

public sealed class ConfigNormalizerTests
{
    private static AppConfig Clean(AppConfig config, out List<string> notices)
    {
        notices = [];
        return ConfigNormalizer.Normalize(config, notices);
    }

    [Fact]
    public void Empty_config_gets_every_section_and_one_billing_style()
    {
        var c = Clean(new AppConfig(), out var notices);
        Assert.NotNull(c.Firm);
        Assert.Equal(25, c.BillRules.RowsPerBill);
        Assert.Equal(PaperSize.Letter, c.Print.PaperSize);
        Assert.Equal(UiLanguage.En, c.Display.Language);
        Assert.True(c.Display.ShowExcelImport);
        Assert.False(c.Display.ShowBillingStyles);
        Assert.True(c.Display.ShowPartywise);
        Assert.True(c.Display.ShowBills);
        Assert.True(c.Display.ShowColors);
        Assert.Single(c.BillingStyles);
        Assert.Empty(notices);
        Assert.Equal(AppConfig.CurrentVersion, c.ConfigVersion);
    }

    [Fact]
    public void Nulls_from_hand_edits_become_defaults()
    {
        const string Json = """{ "firm": null, "billRules": null, "printedTexts": { "title": null, "terms": null }, "parties": [ null, { "name": "  A   B  ", "address": null, "rates": null, "billAs": null } ] }""";
        var c = Clean(ConfigJson.Deserialize(Json), out _);
        Assert.Equal(string.Empty, c.Firm.Name);
        Assert.Equal("TAX INVOICE", c.PrintedTexts.Title);
        Assert.Empty(c.PrintedTexts.Terms);
        var party = Assert.Single(c.Parties);
        Assert.Equal("A B", party.Name);
        Assert.Equal(string.Empty, party.Address);
        Assert.Empty(party.Rates);
    }

    [Fact]
    public void Duplicate_and_nameless_items_are_dropped_with_a_notice()
    {
        var c = Clean(new AppConfig
        {
            Parties = [new() { Name = "P1" }, new() { Name = " p1 " }, new() { Name = "" }],
            Finishes = [new() { Name = "F1" }, new() { Name = "f1" }],
            Colors = [new() { Name = "Red", Hex = "#FF0000" }, new() { Name = "red", Hex = "#00ff00" }],
        }, out var notices);
        Assert.Single(c.Parties);
        Assert.Single(c.Finishes);
        Assert.Equal(("red", "#ff0000"), (c.Colors.Single().Name, c.Colors.Single().Hex));
        Assert.Contains(notices, n => n.Contains("Party \"p1\" is listed twice", StringComparison.Ordinal));
        Assert.Contains(notices, n => n.Contains("without a name", StringComparison.Ordinal));
    }

    [Fact]
    public void Impossible_rates_and_discounts_are_fixed_and_reported()
    {
        var c = Clean(new AppConfig
        {
            Parties = [new() { Name = "P", DiscountPercent = 150, Rates = new Dictionary<string, decimal> { ["F1"] = -5, ["F2"] = 90.005m, ["F3"] = 77.50m, [" "] = 1 } }],
        }, out var notices);
        var p = c.Parties.Single();
        Assert.Equal(100, p.DiscountPercent);
        Assert.False(p.Rates.ContainsKey("F1"));
        Assert.Equal(90.01m, p.Rates["F2"]);
        Assert.Equal("77.5", p.Rates["f3"].ToString(System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal(2, p.Rates.Count);
        Assert.Contains(notices, n => n.Contains("discount 150%", StringComparison.Ordinal));
    }

    [Fact]
    public void Rules_outside_their_range_are_clamped()
    {
        var c = Clean(new AppConfig { BillRules = new() { RowsPerBill = 500, CombineUpTo = 1, CgstPercent = 99, TotalMustStayBelow = -1 } }, out var notices);
        Assert.Equal(60, c.BillRules.RowsPerBill);
        Assert.Equal(2, c.BillRules.CombineUpTo);
        Assert.Equal(28, c.BillRules.CgstPercent);
        Assert.Equal(0, c.BillRules.TotalMustStayBelow);
        Assert.Equal(4, notices.Count);
    }

    [Fact]
    public void A_style_that_shows_nothing_gets_the_design_number_back()
    {
        var c = Clean(new AppConfig { BillingStyles = [new() { Name = "S", GpnColumn = ColumnContent.Blank, DnColumn = ColumnContent.Blank, LotColumn = ColumnContent.Blank }] }, out var notices);
        Assert.Equal(ColumnContent.DesignNo, c.BillingStyles.Single().DnColumn);
        Assert.Single(notices);
    }

    [Fact]
    public void Names_references_and_lists_are_tidied()
    {
        var c = Clean(new AppConfig
        {
            Finishes = [new() { Name = "F1", Color = "", BillAsIfNoRate = ["F1", "f2", "F2", " F3 "] }],
            Parties = [new() { Name = "P", Gstin = " 08abc ", Color = "Dark  Blue", BillAs = new Dictionary<string, string> { ["F1"] = "f1", ["F2"] = "F3", ["X"] = "" } }],
            PrintedTexts = new() { Terms = ["1", "2", "3", "4", "5"] },
        }, out _);
        Assert.Equal(["f2", "F3"], c.Finishes.Single().BillAsIfNoRate);
        Assert.Equal("black", c.Finishes.Single().Color);
        var p = c.Parties.Single();
        Assert.Equal("08ABC", p.Gstin);
        Assert.Equal("dark  blue", p.Color);
        Assert.Equal(new Dictionary<string, string> { ["F2"] = "F3" }, p.BillAs);
        Assert.Equal(4, c.PrintedTexts.Terms.Count);
    }

    [Fact]
    public void A_signature_that_is_not_a_picture_is_dropped()
    {
        var c = Clean(new AppConfig { Signature = "data:image/png;base64,bm90IGFuIGltYWdl" }, out var notices);
        Assert.Null(c.Signature);
        Assert.Single(notices);
    }

    [Theory]
    [InlineData(77.50, "77.5")]
    [InlineData(90.00, "90")]
    [InlineData(2.5, "2.5")]
    public void Decimals_are_written_without_trailing_zeros(double value, string expected) =>
        Assert.Equal(expected, ConfigNormalizer.Tidy((decimal)value).ToString(System.Globalization.CultureInfo.InvariantCulture));
}

public sealed class ConfigJsonTests
{
    [Fact]
    public void Round_trip_keeps_every_value()
    {
        var config = ConfigNormalizer.Normalize(new AppConfig
        {
            Firm = new() { Name = "F", HomeStateCode = "08" },
            BillRules = new() { RowsPerBill = 30, TotalMustStayBelow = 200000, CgstPercent = 2.5m },
            Display = new() { Theme = UiTheme.Dark },
            Colors = DefaultConfig.BasicColors,
            BillingStyles = [new() { Name = "S", GpnColumn = ColumnContent.GatePass, Lines = LineGrouping.SameGatePass, Order = LineOrder.InwardDate }],
            Parties = [new() { Name = "₹ PARTY", DiscountPercent = 13.5m, BillingStyle = "S", BillBeforeDispatch = true, Rates = new Dictionary<string, decimal> { ["F1"] = 77 } }],
        }, []);
        var json = ConfigJson.Serialize(config);
        var back = ConfigNormalizer.Normalize(ConfigJson.Deserialize(json), []);
        Assert.Equal(json, ConfigJson.Serialize(back));
        Assert.Contains("\"₹ PARTY\"", json, StringComparison.Ordinal);
        Assert.Contains("\"gpnColumn\": \"gatePass\"", json, StringComparison.Ordinal);
        Assert.Contains("\"theme\": \"dark\"", json, StringComparison.Ordinal);
        Assert.Contains("\"F1\": 77", json, StringComparison.Ordinal);
    }

    [Fact]
    public void Comments_and_trailing_commas_from_hand_edits_are_accepted()
    {
        var c = ConfigJson.Deserialize("""
            {
              // edited in Notepad
              "billRules": { "rowsPerBill": 30, },
              "parties": [ { "name": "P", }, ],
            }
            """);
        Assert.Equal(30, c.BillRules.RowsPerBill);
        Assert.Single(c.Parties);
    }

    [Theory]
    [InlineData("""{ "display": { "theme": "purple" } }""")]
    [InlineData("""{ "display": { "theme": 1 } }""")]
    [InlineData("""{ "billRules": { "rowsPerBill": "many" } }""")]
    [InlineData("""{ "parties": [ { "name": "P" } """)]
    public void Unknown_words_wrong_types_and_broken_json_are_rejected(string json) =>
        Assert.ThrowsAny<JsonException>(() => ConfigJson.Deserialize(json));

    [Fact]
    public void Enum_words_are_read_ignoring_case() =>
        Assert.Equal(UiTheme.Dark, ConfigJson.Deserialize("""{ "display": { "theme": "DARK" } }""").Display.Theme);
}

public sealed class ConfigIndexTests
{
    private static readonly AppConfig Config = ConfigNormalizer.Normalize(new AppConfig
    {
        Colors = [new() { Name = "navy", Hex = "#000080" }],
        BillingStyles = [new() { Name = "First" }, new() { Name = "Second" }],
        Finishes = [new() { Name = "F1" }],
        FinishGroups = [new() { Name = "G1" }],
        Parties =
        [
            new() { Name = "MAIN PARTY", BillingStyle = "second" },
            new() { Name = "CHILD ONE", BillTo = "main  party" },
            new() { Name = "CHILD TWO", BillTo = "MAIN PARTY", BillingStyle = "gone" },
        ],
    }, []);

    [Fact]
    public void Lookups_ignore_case_and_extra_spaces()
    {
        var index = ConfigIndex.For(Config);
        Assert.Equal("MAIN PARTY", index.Party("  main   party ")!.Name);
        Assert.NotNull(index.Finish("f1"));
        Assert.NotNull(index.Group("g1"));
        Assert.Null(index.Party(null));
        Assert.Null(index.Party("nobody"));
    }

    [Fact]
    public void Bill_to_links_are_migrated_to_sister_firms()
    {
        var children = ConfigIndex.For(Config).SisterFirms("Main Party").Select(p => p.Name).Order();
        Assert.Equal(["CHILD ONE", "CHILD TWO"], children);
        Assert.All(Config.Parties, p => Assert.Null(p.BillTo));
    }

    [Fact]
    public void A_missing_style_falls_back_to_the_first_one()
    {
        var index = ConfigIndex.For(Config);
        Assert.Equal("Second", index.StyleOf(index.Party("MAIN PARTY")!).Name);
        Assert.Equal("First", index.StyleOf(index.Party("CHILD TWO")!).Name);
    }

    [Fact]
    public void Colours_resolve_by_name_or_as_hex_values()
    {
        var index = ConfigIndex.For(Config);
        Assert.Equal("#000080", index.Hex("NAVY"));
        Assert.Equal("#123456", index.Hex("#123456"));
        Assert.Null(index.Hex("plum"));
        Assert.False(index.IsKnownColor("plum"));
    }

    [Fact]
    public void The_index_is_built_once_per_snapshot() => Assert.Same(ConfigIndex.For(Config), ConfigIndex.For(Config));
}
