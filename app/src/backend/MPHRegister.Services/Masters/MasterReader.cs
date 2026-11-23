using MPHRegister.Contracts.Masters;
using MPHRegister.Data.Config;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Services.Interfaces;
using MPHRegister.Services.Mapping;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Extensions;

namespace MPHRegister.Services.Masters;

public sealed class MasterReader(IConfigStore config, IMasterUsageRepository usage) : IMasterReader
{
    public AppConfig Config => config.Current;

    public IReadOnlyList<PartyDto> Parties()
    {
        var current = config.Current;
        var index = ConfigIndex.For(current);
        var counts = Counts(usage.PartyEntryCounts());
        return current.Parties
            .Select(p => PartyMapper.ToDto(p, index, counts.GetValueOrDefault(p.Name)))
            .OrderByDescending(p => p.Active).ThenBy(p => p.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public PartyDto? Party(string? name, bool withCounts = true)
    {
        var index = ConfigIndex.For(config.Current);
        var party = index.Party(name);
        if (party is null) return null;
        return PartyMapper.ToDto(party, index, withCounts ? Counts(usage.PartyEntryCounts()).GetValueOrDefault(party.Name) : 0);
    }

    public IReadOnlyList<FinishDto> Finishes()
    {
        var current = config.Current;
        var counts = Counts(usage.FinishEntryCounts());
        return current.Finishes
            .Select(f => PartyMapper.ToDto(f, counts.GetValueOrDefault(f.Name), current.Parties.Count(p => p.Rates.ContainsKey(f.Name))))
            .OrderByDescending(f => f.Active).ThenBy(f => f.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public IReadOnlyList<GroupDto> Groups()
    {
        var current = config.Current;
        return current.FinishGroups
            .Select(g => new GroupDto(g.Name, g.Active, current.Finishes.Count(f => string.Equals(f.Group, g.Name, StringComparison.OrdinalIgnoreCase))))
            .OrderByDescending(g => g.Active).ThenBy(g => g.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public IReadOnlyList<StyleDto> Styles()
    {
        var current = config.Current;
        var index = ConfigIndex.For(current);
        return current.BillingStyles
            .Select(s => PartyMapper.ToDto(s, current.Parties.Count(p => ReferenceEquals(index.Style(p.BillingStyle), s))))
            .ToList();
    }

    public IReadOnlyList<ColorDto> Colors()
    {
        var current = config.Current;
        return current.Colors
            .Select(c => new ColorDto(c.Name, c.Hex,
                current.Parties.Count(p => string.Equals(p.Color, c.Name, StringComparison.OrdinalIgnoreCase)),
                current.Finishes.Count(f => string.Equals(f.Color, c.Name, StringComparison.OrdinalIgnoreCase))))
            .ToList();
    }

    public IReadOnlyDictionary<string, IReadOnlyList<string>> FinishFallbacks() => config.Current.Finishes
        .Where(f => f.BillAsIfNoRate.Count > 0)
        .ToDictionary(f => f.Name, f => f.BillAsIfNoRate, StringComparer.OrdinalIgnoreCase);

    public IReadOnlyList<string> BillRecipients(string? party)
    {
        var index = ConfigIndex.For(config.Current);
        var found = index.Party(party);
        if (found is null) return [];
        return [found.Name, .. index.SisterFirms(found.Name).Select(p => p.Name).Order(StringComparer.OrdinalIgnoreCase)];
    }

    private static Dictionary<string, int> Counts(IEnumerable<Data.Entities.NameCount> rows)
    {
        var map = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in rows)
        {
            var key = row.Name.NormalizeName();
            map[key] = map.GetValueOrDefault(key) + row.Count;
        }
        return map;
    }
}
