using System.Runtime.CompilerServices;
using MPHRegister.Shared.Extensions;

namespace MPHRegister.Shared.Configuration;

/// <summary>Name lookups on one config snapshot (case and extra spaces ignored), built once per snapshot.</summary>
public sealed class ConfigIndex
{
    private static readonly ConditionalWeakTable<AppConfig, ConfigIndex> Cache = new();

    private readonly Dictionary<string, PartyConfig> parties;
    private readonly Dictionary<string, FinishConfig> finishes;
    private readonly Dictionary<string, FinishGroupConfig> groups;
    private readonly Dictionary<string, BillingStyle> styles;
    private readonly Dictionary<string, NamedColor> colors;

    private ConfigIndex(AppConfig config)
    {
        Config = config;
        parties = ToMap(config.Parties, p => p.Name);
        finishes = ToMap(config.Finishes, f => f.Name);
        groups = ToMap(config.FinishGroups, g => g.Name);
        styles = ToMap(config.BillingStyles, s => s.Name);
        colors = ToMap(config.Colors, c => c.Name);
    }

    public AppConfig Config { get; }

    public BillingStyle FallbackStyle => Config.BillingStyles.Count > 0 ? Config.BillingStyles[0] : DefaultConfig.StandardStyle;

    public static ConfigIndex For(AppConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);
        return Cache.GetValue(config, c => new ConfigIndex(c));
    }

    public PartyConfig? Party(string? name) => Find(parties, name);

    public FinishConfig? Finish(string? name) => Find(finishes, name);

    public FinishGroupConfig? Group(string? name) => Find(groups, name);

    public BillingStyle? Style(string? name) => Find(styles, name);

    public NamedColor? Color(string? name) => Find(colors, name);

    /// <summary>The party's billing style, or the first style when its style is missing.</summary>
    public BillingStyle StyleOf(PartyConfig party)
    {
        ArgumentNullException.ThrowIfNull(party);
        return Style(party.BillingStyle) ?? FallbackStyle;
    }

    /// <summary>The other parties with the same sister-firm group (none when the party has no group).</summary>
    public IReadOnlyList<PartyConfig> SisterFirms(string name)
    {
        var party = Party(name);
        if (party is null || party.SisterGroup.Length == 0) return [];
        return Config.Parties.Where(p => !ReferenceEquals(p, party) && string.Equals(p.SisterGroup, party.SisterGroup, StringComparison.OrdinalIgnoreCase)).ToList();
    }

    /// <summary>#rrggbb for a colour name or #rrggbb value; null when unknown.</summary>
    public string? Hex(string? color)
    {
        var value = ConfigNormalizer.ColorReference(color);
        return ConfigNormalizer.IsHexColor(value) ? value : Color(value)?.Hex;
    }

    public bool IsKnownColor(string? color) => Hex(color) is not null;

    private static Dictionary<string, T> ToMap<T>(IEnumerable<T> items, Func<T, string> name)
    {
        var map = new Dictionary<string, T>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in items) map.TryAdd(name(item).NormalizeName(), item);
        return map;
    }

    private static T? Find<T>(Dictionary<string, T> map, string? name)
        where T : class => string.IsNullOrWhiteSpace(name) ? null : map.GetValueOrDefault(name.NormalizeName());
}
