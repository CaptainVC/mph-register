using System.Globalization;
using System.Text.Json;
using Dapper;
using Microsoft.Data.Sqlite;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Data.Config;

/// <summary>
/// Moves a v0.4 data file's parties, finishes, groups, rates, bill styles, firm details and signature into a config file.
/// Each party's own bill style becomes one of a few named billing styles shared by every party that billed the same way.
/// </summary>
internal static class LegacyMastersExporter
{
    /// <summary>The colour names v0.4 knew (the bill workbook's ColorNameToRGB macro), so migrated colours keep their look.</summary>
    private static readonly (string Name, string Hex)[] LegacyPalette =
    [
        ("red", "#ff0000"), ("blue", "#0000ff"), ("green", "#008000"), ("yellow", "#ffff00"), ("orange", "#ffa500"), ("black", "#000000"),
        ("purple", "#800080"), ("pink", "#ff69b4"), ("light red", "#ff6666"), ("light blue", "#add8e6"), ("light green", "#90ee90"),
        ("light yellow", "#ffffe0"), ("light orange", "#ffc87c"), ("light purple", "#dda0dd"), ("light pink", "#ffb6c1"), ("light cyan", "#e0ffff"),
        ("light magenta", "#ff99ff"), ("light gray", "#d3d3d3"), ("light teal", "#afeeee"), ("light olive", "#c0c080"), ("light brown", "#d2b48c"),
        ("light gold", "#ffec8b"), ("light coral", "#f08080"), ("dark red", "#8b0000"), ("dark blue", "#00008b"), ("dark green", "#006400"),
        ("dark yellow", "#cccc00"), ("dark orange", "#ff8c00"), ("dark purple", "#4b0082"), ("dark pink", "#e75480"), ("dark cyan", "#008b8b"),
        ("dark magenta", "#8b008b"), ("dark gray", "#696969"),
    ];

    private static readonly JsonSerializerOptions Json = CreateJson();

    /// <summary>True when the data file still has v0.4 lists with anything in them.</summary>
    public static bool HasAny(SqliteConnection connection, SqliteTransaction? transaction) =>
        (TableExists(connection, transaction, "parties") && connection.ExecuteScalar<long>("SELECT COUNT(*) FROM parties;", transaction: transaction) > 0)
        || (TableExists(connection, transaction, "finishes") && connection.ExecuteScalar<long>("SELECT COUNT(*) FROM finishes;", transaction: transaction) > 0)
        || (TableExists(connection, transaction, "settings")
            && connection.ExecuteScalar<long>("SELECT COUNT(*) FROM settings WHERE key = @key;", new { key = SettingKeys.LegacyFirm }, transaction) > 0);

    public static AppConfig Export(SqliteConnection connection, SqliteTransaction? transaction)
    {
        if (!HasAny(connection, transaction)) return DefaultConfig.Skeleton();
        var firm = ReadFirm(connection, transaction);
        var groups = TableExists(connection, transaction, "finish_groups")
            ? connection.Query<GroupRow>("SELECT name, active FROM finish_groups ORDER BY rowid;", transaction: transaction)
                .Select(g => new FinishGroupConfig { Name = g.Name, Active = g.Active }).ToList()
            : [];
        var finishColumns = Columns(connection, transaction, "finishes");
        // Column names come from Pick() using fixed literals; SQL identifiers cannot be bound as parameters.
#pragma warning disable S2077
        var finishes = connection.Query<FinishRow>(
                $"SELECT name, active, {Pick(finishColumns, "finish_group")} AS finish_group, {Pick(finishColumns, "color")} AS color, {Pick(finishColumns, "fallback")} AS fallback FROM finishes ORDER BY rowid;",
                transaction: transaction)
#pragma warning restore S2077
            .Select(f => new FinishConfig
            {
                Name = f.Name,
                Active = f.Active,
                Group = f.FinishGroup ?? string.Empty,
                Color = f.Color ?? "black",
                BillAsIfNoRate = (f.Fallback ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
            })
            .ToList();
        var rates = TableExists(connection, transaction, "rates")
            ? connection.Query<RateRow>("SELECT party, finish, rate FROM rates;", transaction: transaction)
                .GroupBy(r => r.Party.NormalizeName(), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.ToDictionary(r => r.Finish, r => Convert.ToDecimal(r.Rate, CultureInfo.InvariantCulture), StringComparer.OrdinalIgnoreCase), StringComparer.OrdinalIgnoreCase)
            : [];
        var partyColumns = Columns(connection, transaction, "parties");
        // Column names come from Pick() using fixed literals; SQL identifiers cannot be bound as parameters.
#pragma warning disable S2077
        var rows = connection.Query<PartyRow>(
            $"""
            SELECT name, active, {Pick(partyColumns, "address")} AS address, {Pick(partyColumns, "state")} AS state, {Pick(partyColumns, "gstin")} AS gstin,
                {Pick(partyColumns, "discount", "NULL")} AS discount, {Pick(partyColumns, "color")} AS color, {Pick(partyColumns, "bill_to")} AS bill_to,
                {Pick(partyColumns, "bill_style", "'{}'")} AS bill_style
            FROM parties ORDER BY rowid;
            """,
            transaction: transaction).ToList();
#pragma warning restore S2077

        var legacyStyles = rows.Select(r => ParseStyle(r.BillStyle)).ToList();
        var styles = legacyStyles
            .GroupBy(s => s.Style)
            .OrderByDescending(g => g.Count())
            .ThenBy(g => NameOf(g.Key), StringComparer.Ordinal)
            .Select(g => g.Key with { Name = NameOf(g.Key), Description = DescriptionOf(g.Key) })
            .ToList();
        if (styles.Count == 0) styles.Add(DefaultConfig.StandardStyle);
        var styleName = styles.ToDictionary(s => s with { Name = string.Empty, Description = string.Empty }, s => s.Name);

        var parties = rows.Select((r, i) => new PartyConfig
        {
            Name = r.Name,
            Active = r.Active,
            Address = r.Address ?? string.Empty,
            State = r.State ?? string.Empty,
            Gstin = r.Gstin ?? string.Empty,
            DiscountPercent = r.Discount is { } d ? Math.Round(Convert.ToDecimal(d, CultureInfo.InvariantCulture), 2) : null,
            Color = r.Color ?? "black",
            BillTo = r.BillTo ?? string.Empty,
            BillingStyle = styleName[legacyStyles[i].Style],
            BillBeforeDispatch = legacyStyles[i].BillBeforeDispatch,
            BillAs = legacyStyles[i].FinishMap,
            Rates = rates.GetValueOrDefault(r.Name.NormalizeName()) ?? new Dictionary<string, decimal>(),
        }).ToList();

        return new AppConfig
        {
            Firm = firm.Firm,
            BillRules = firm.Rules,
            PrintedTexts = firm.Texts,
            Print = firm.Print,
            Colors = LegacyPalette.Select(c => new NamedColor { Name = c.Name, Hex = c.Hex }).ToList(),
            BillingStyles = styles,
            FinishGroups = groups,
            Finishes = finishes,
            Parties = parties,
            Signature = ReadSignature(connection, transaction),
        };
    }

    /// <summary>A short name saying what the style does, e.g. "G.P.N. + D.N. + LOT, sorted by number".</summary>
    internal static string NameOf(BillingStyle s)
    {
        static string Column(ColumnContent content, string header) => content switch
        {
            ColumnContent.GatePass => header == "G.P.N." ? "G.P.N." : $"G.P.N. in {header} column",
            ColumnContent.DesignNo => header == "D.N." ? "D.N." : $"D.N. in {header} column",
            ColumnContent.LotNo => header == "LOT" ? "LOT" : $"LOT in {header} column",
            _ => string.Empty,
        };
        var columns = new[] { Column(s.GpnColumn, "G.P.N."), Column(s.DnColumn, "D.N."), Column(s.LotColumn, "LOT") }.Where(c => c.Length > 0);
        var name = string.Join(" + ", columns);
        if (s.Lines == LineGrouping.SameLot) name += ", same lot on one line";
        if (s.Lines == LineGrouping.SameGatePass) name += ", same gate pass on one line";
        if (s.ShowQuantityBreakdown) name += " (15+28)";
        if (s.Order == LineOrder.Reference) name += ", sorted by number";
        if (s.Order == LineOrder.InwardDate) name += ", by inward date";
        if (!s.CombineSmallEntries) name += ", small entries apart";
        return name;
    }

    internal static string DescriptionOf(BillingStyle s)
    {
        static string Shows(ColumnContent content) => content switch
        {
            ColumnContent.GatePass => "gate pass numbers",
            ColumnContent.DesignNo => "design number",
            ColumnContent.LotNo => "lot number",
            _ => "nothing",
        };
        var lines = s.Lines switch
        {
            LineGrouping.SameLot => "Entries with the same lot share a line",
            LineGrouping.SameGatePass => "Entries sent on the same gate pass share a line",
            _ => "One line per inward entry",
        };
        var order = s.Order switch
        {
            LineOrder.Reference => "sorted by the number shown",
            LineOrder.InwardDate => "in inward date order",
            _ => "in inward order",
        };
        return $"G.P.N. column: {Shows(s.GpnColumn)}; D.N. column: {Shows(s.DnColumn)}; LOT NO. column: {Shows(s.LotColumn)}. {lines}, {order}."
            + (s.ShowQuantityBreakdown ? " Shared lines also show each THAN, like (15+28)." : string.Empty)
            + (s.CombineSmallEntries ? " Small entries are combined." : " Small entries are not combined.");
    }

    private static (FirmProfile Firm, BillRules Rules, PrintedTexts Texts, PrintSettings Print) ReadFirm(SqliteConnection connection, SqliteTransaction? transaction)
    {
        var json = TableExists(connection, transaction, "settings")
            ? connection.QueryFirstOrDefault<string>("SELECT value FROM settings WHERE key = @key;", new { key = SettingKeys.LegacyFirm }, transaction)
            : null;
        LegacyFirm? f = null;
        try
        {
            f = json is null ? null : JsonSerializer.Deserialize<LegacyFirm>(json, Json);
        }
        catch (JsonException)
        {
            // Fall back to default legacy firm settings when stored JSON is malformed.
        }
        f ??= new LegacyFirm();
        var firm = new FirmProfile
        {
            Name = f.FirmName ?? string.Empty,
            Gstin = f.Gstin ?? string.Empty,
            AddressLine1 = f.AddressLine1 ?? string.Empty,
            AddressLine2 = f.AddressLine2 ?? string.Empty,
            PhoneLine = f.PhoneLine ?? string.Empty,
            MsmeLine = f.MsmeLine ?? string.Empty,
            HomeStateCode = f.HomeStateCode ?? string.Empty,
            HomeStateName = f.HomeStateName ?? string.Empty,
        };
        var rules = new BillRules
        {
            NumberPrefix = string.IsNullOrWhiteSpace(f.InvoicePrefix) ? new BillRules().NumberPrefix : f.InvoicePrefix,
            TotalMustStayBelow = f.InvoiceLimit,
            RowsPerBill = f.RowsPerInvoice > 0 ? f.RowsPerInvoice : 25,
            CombineSmallBelowThan = f.SmallThanBelow,
            CombineUpTo = f.CombineMax > 1 ? f.CombineMax : 4,
            CgstPercent = f.CgstRate,
            SgstPercent = f.SgstRate,
            IgstPercent = f.IgstRate,
        };
        var texts = new PrintedTexts
        {
            CopyLabel = f.CopyLabel ?? new PrintedTexts().CopyLabel,
            InvoiceKind = f.InvoiceTitle ?? string.Empty,
            SacLine = f.SacLine ?? string.Empty,
            BankLine1 = f.BankLine1 ?? string.Empty,
            BankLine2 = f.BankLine2 ?? string.Empty,
            PaymentLine = f.PaymentLine ?? string.Empty,
            Terms = (f.Terms ?? string.Empty).Split('\n').Select(t => t.TrimEnd('\r')).Where(t => t.Length > 0).ToList(),
            Signatory = f.Signatory ?? string.Empty,
            SignatureLabel = f.SignatureLabel ?? new PrintedTexts().SignatureLabel,
            CheckedByLabel = f.CheckedByLabel ?? string.Empty,
        };
        var print = new PrintSettings { PaperSize = f.PaperSize, IndianDigitGrouping = f.IndianNumbers };
        return (firm, rules, texts, print);
    }

    private static string? ReadSignature(SqliteConnection connection, SqliteTransaction? transaction)
    {
        if (!TableExists(connection, transaction, "settings")) return null;
        var stored = connection.QueryFirstOrDefault<string>("SELECT value FROM settings WHERE key = @key;", new { key = SettingKeys.LegacySignature }, transaction);
        if (string.IsNullOrWhiteSpace(stored)) return null;
        try
        {
            var bytes = Convert.FromBase64String(stored);
            return SignatureImage.ContentType(bytes) is null ? null : SignatureImage.Encode(bytes);
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static (BillingStyle Style, bool BillBeforeDispatch, Dictionary<string, string> FinishMap) ParseStyle(string? json)
    {
        JsonElement root = default;
        JsonDocument? doc = null;
        try
        {
            doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json);
            root = doc.RootElement;
        }
        catch (JsonException)
        {
            // Fall back to default style when stored JSON is malformed.
        }
        using (doc)
        {
            string Text(string name, string fallback) =>
                root.ValueKind == JsonValueKind.Object && root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
                    ? (v.GetString() ?? fallback).ToLowerInvariant()
                    : fallback;
            bool Flag(string name, bool fallback) =>
                root.ValueKind == JsonValueKind.Object && root.TryGetProperty(name, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False
                    ? v.GetBoolean()
                    : fallback;
            var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("finishMap", out var m) && m.ValueKind == JsonValueKind.Object)
            {
                foreach (var p in m.EnumerateObject())
                {
                    if (p.Value.ValueKind == JsonValueKind.String && p.Value.GetString() is { Length: > 0 } to) map[p.Name] = to;
                }
            }
            var lot = Text("lot", "lot");
            var style = new BillingStyle
            {
                GpnColumn = Text("gpn", "none") == "gatepass" ? ColumnContent.GatePass : ColumnContent.Blank,
                DnColumn = Text("dn", "dn") == "dn" ? ColumnContent.DesignNo : ColumnContent.Blank,
                LotColumn = lot switch
                {
                    "lot" => ColumnContent.LotNo,
                    "dn" => ColumnContent.DesignNo,
                    _ => ColumnContent.Blank,
                },
                Lines = Text("group", "entry") switch
                {
                    "lot" => LineGrouping.SameLot,
                    "gatepass" => LineGrouping.SameGatePass,
                    _ => LineGrouping.OnePerEntry,
                },
                Order = Text("sort", "inward") switch
                {
                    "ref" => LineOrder.Reference,
                    "date" => LineOrder.InwardDate,
                    _ => LineOrder.Inward,
                },
                ShowQuantityBreakdown = Flag("breakdown", false),
                CombineSmallEntries = Flag("combineSmall", true),
            };
            if (style is { GpnColumn: ColumnContent.Blank, DnColumn: ColumnContent.Blank, LotColumn: ColumnContent.Blank })
                style = style with { DnColumn = ColumnContent.DesignNo };
            return (style, Text("include", "dispatched") == "all", map);
        }
    }

    private static bool TableExists(SqliteConnection connection, SqliteTransaction? transaction, string table) =>
        connection.ExecuteScalar<long>("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = @table;", new { table }, transaction) > 0;

    private static HashSet<string> Columns(SqliteConnection connection, SqliteTransaction? transaction, string table) =>
        connection.Query<string>("SELECT name FROM pragma_table_info(@table);", new { table }, transaction: transaction).ToHashSet(StringComparer.OrdinalIgnoreCase);

    private static string Pick(HashSet<string> columns, string column, string missing = "''") => columns.Contains(column) ? column : missing;

    private static JsonSerializerOptions CreateJson()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return options;
    }

    // Private DTO properties below are populated via reflection by Dapper and System.Text.Json.
#pragma warning disable S1144
    private sealed record GroupRow
    {
        public string Name { get; init; } = string.Empty;

        public bool Active { get; init; }
    }

    private sealed record FinishRow
    {
        public string Name { get; init; } = string.Empty;

        public bool Active { get; init; }

        public string? FinishGroup { get; init; }

        public string? Color { get; init; }

        public string? Fallback { get; init; }
    }

    private sealed record RateRow
    {
        public string Party { get; init; } = string.Empty;

        public string Finish { get; init; } = string.Empty;

        public double Rate { get; init; }
    }

    private sealed record PartyRow
    {
        public string Name { get; init; } = string.Empty;

        public bool Active { get; init; }

        public string? Address { get; init; }

        public string? State { get; init; }

        public string? Gstin { get; init; }

        public double? Discount { get; init; }

        public string? Color { get; init; }

        public string? BillTo { get; init; }

        public string? BillStyle { get; init; }
    }

    /// <summary>The v0.4 firm settings JSON (settings key "firm").</summary>
    private sealed record LegacyFirm
    {
        public string? FirmName { get; init; }

        public string? Gstin { get; init; }

        public string? AddressLine1 { get; init; }

        public string? AddressLine2 { get; init; }

        public string? PhoneLine { get; init; }

        public string? MsmeLine { get; init; }

        public string? InvoiceTitle { get; init; }

        public string? SacLine { get; init; }

        public string? CopyLabel { get; init; }

        public string? BankLine1 { get; init; }

        public string? BankLine2 { get; init; }

        public string? PaymentLine { get; init; }

        public string? Terms { get; init; }

        public string? Signatory { get; init; }

        public string? SignatureLabel { get; init; }

        public string? CheckedByLabel { get; init; }

        public string? HomeStateCode { get; init; }

        public string? HomeStateName { get; init; }

        public decimal CgstRate { get; init; }

        public decimal SgstRate { get; init; }

        public decimal IgstRate { get; init; }

        public decimal InvoiceLimit { get; init; }

        public int RowsPerInvoice { get; init; } = 25;

        public string? InvoicePrefix { get; init; }

        public int SmallThanBelow { get; init; }

        public int CombineMax { get; init; } = 4;

        public PaperSize PaperSize { get; init; } = PaperSize.Letter;

        public bool IndianNumbers { get; init; } = true;
    }
#pragma warning restore S1144
}
