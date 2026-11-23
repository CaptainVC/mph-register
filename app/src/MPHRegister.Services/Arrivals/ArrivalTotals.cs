using MPHRegister.Contracts.Arrivals;
using MPHRegister.Data.Entities;
using MPHRegister.Shared.Configuration;

namespace MPHRegister.Services.Arrivals;

/// <summary>NAG per party (or sister-firm group) and per lorry wala over a period: the workbook's Total sheet, for any dates.</summary>
public static class ArrivalTotals
{
    public const string ByNag = "nag";
    public const string FirstArrival = "first";

    /// <param name="rows">The period's arrivals in date order (then Aawak NO), as the workbook lists them.</param>
    public static ArrivalTotalsDto Compute(IReadOnlyList<ArrivalEntity> rows, ConfigIndex index, bool groupSisters, string? order, string from, string to)
    {
        ArgumentNullException.ThrowIfNull(rows);
        ArgumentNullException.ThrowIfNull(index);
        var sort = order == FirstArrival ? FirstArrival : ByNag;
        string Key(ArrivalEntity a) => groupSisters ? index.GroupOf(a.Party) : index.Party(a.Party)?.Name ?? a.Party;

        var parties = Lines(rows, Key, sort, key =>
        {
            var members = rows.Where(a => Same(Key(a), key)).Select(a => index.Party(a.Party)?.Name ?? a.Party).Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.OrdinalIgnoreCase).ToList();
            var isGroup = groupSisters && index.Party(key) is null && members.Count > 0 && !(members.Count == 1 && Same(members[0], key));
            return (isGroup, isGroup ? members : []);
        });
        var transporters = Lines(rows, a => index.Transporter(a.Transporter)?.Name ?? a.Transporter, sort, _ => (false, []));
        var days = rows.GroupBy(a => a.ArrivalDate).OrderBy(g => g.Key, StringComparer.Ordinal)
            .Select(g => new ArrivalDayTotal(g.Key, g.Count(), g.Sum(a => a.Nag))).ToList();
        var matrix = rows.GroupBy(a => (Transporter: index.Transporter(a.Transporter)?.Name ?? a.Transporter, Party: Key(a)))
            .Select(g => new ArrivalMatrixCell(g.Key.Transporter, g.Key.Party, g.Sum(a => a.Nag)))
            .OrderBy(c => c.Transporter, StringComparer.OrdinalIgnoreCase).ThenBy(c => c.Party, StringComparer.OrdinalIgnoreCase).ToList();
        return new ArrivalTotalsDto(from, to, groupSisters, sort, rows.Count, rows.Sum(a => a.Nag), parties, transporters, days, matrix);
    }

    private static List<ArrivalTotalLine> Lines(IReadOnlyList<ArrivalEntity> rows, Func<ArrivalEntity, string> key, string sort,
        Func<string, (bool IsGroup, List<string> Members)> describe)
    {
        var order = new List<string>();
        var sums = new Dictionary<string, (int Arrivals, int Nag)>(StringComparer.OrdinalIgnoreCase);
        foreach (var arrival in rows)
        {
            var name = key(arrival);
            if (name.Trim().Length == 0) continue;
            if (!sums.TryGetValue(name, out var sum))
            {
                order.Add(name);
                sum = (0, 0);
            }
            sums[name] = (sum.Arrivals + 1, sum.Nag + arrival.Nag);
        }
        var lines = order.Select(name =>
        {
            var (isGroup, members) = describe(name);
            return new ArrivalTotalLine(name, isGroup, members, sums[name].Arrivals, sums[name].Nag);
        });
        return (sort == FirstArrival ? lines : lines.OrderByDescending(l => l.Nag).ThenBy(l => l.Name, StringComparer.OrdinalIgnoreCase)).ToList();
    }

    private static bool Same(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
}
