namespace MPHRegister.Shared.Configuration;

internal static class SisterGroupMigration
{
    internal static List<PartyConfig> Apply(List<PartyConfig> parties, List<string> notices)
    {
        var legacy = parties.Where(p => !string.IsNullOrEmpty(p.BillTo)).ToList();
        if (legacy.Count == 0) return parties;
        var comparer = StringComparer.OrdinalIgnoreCase;
        var byName = parties.ToDictionary(p => p.Name, comparer);
        var parents = parties.ToDictionary(p => p.Name, p => p.Name, comparer);

        string Root(string name)
        {
            while (!comparer.Equals(name, parents[name])) name = parents[name];
            return name;
        }

        var existing = parties.Where(p => p.SisterGroup.Length > 0).ToLookup(p => p.SisterGroup, comparer);
        var reserved = existing.Select(g => g.Key).ToHashSet(comparer);
        foreach (var group in existing)
        {
            var first = group.First().Name;
            foreach (var member in group) parents[member.Name] = first;
        }

        var links = new List<(string Source, string Target)>();
        foreach (var source in legacy)
        {
            if (!byName.TryGetValue(source.BillTo!, out var target) || comparer.Equals(source.Name, target.Name))
            {
                notices.Add($"Could not migrate the old bill-to setting on \"{source.Name}\": \"{source.BillTo}\" is not another known party.");
                continue;
            }
            parents[Root(source.Name)] = Root(target.Name);
            links.Add((source.Name, target.Name));
        }

        var assignments = new Dictionary<string, string>(comparer);
        var affected = links.ToLookup(l => Root(l.Target), comparer);
        foreach (var component in parties.ToLookup(p => Root(p.Name), comparer))
        {
            var related = affected[component.Key].ToList();
            if (related.Count == 0) continue;
            var groupNames = component.Select(p => p.SisterGroup).Where(g => g.Length > 0).Distinct(comparer).Order(comparer).ToList();
            var target = related[0].Target;
            var groupName = groupNames.FirstOrDefault() ?? AvailableName(target, reserved);
            if (groupNames.Count > 1) notices.Add($"Merged sister-firm groups {string.Join(", ", groupNames)} into \"{groupName}\" to retain old bill-to links.");
            foreach (var party in component) assignments[party.Name] = groupName;
        }
        if (links.Count > 0) notices.Add($"Moved {links.Count} old bill-to setting(s) into sister-firm groups. Choose the bill recipient on each draft.");
        return parties.Select(p => p with { BillTo = null, SisterGroup = assignments.GetValueOrDefault(p.Name, p.SisterGroup) }).ToList();
    }

    private static string AvailableName(string target, HashSet<string> reserved)
    {
        var name = target;
        var suffix = 2;
        while (!reserved.Add(name))
        {
            var ending = $" ({suffix++})";
            name = target[..Math.Min(target.Length, Constants.Limits.PartyNameMax - ending.Length)] + ending;
        }
        return name;
    }
}
