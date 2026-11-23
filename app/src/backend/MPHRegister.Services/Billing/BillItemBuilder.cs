using MPHRegister.Contracts.Entries;
using MPHRegister.Contracts.Settings;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Billing;

/// <summary>Turns ticked entries into bill rows following the party's billing style.</summary>
public static class BillItemBuilder
{
    public static List<BillItem> Build(IReadOnlyList<EntryDto> entries, BillingStyle style, FirmSettings rules, FinishResolver finishes)
    {
        ArgumentNullException.ThrowIfNull(entries);
        ArgumentNullException.ThrowIfNull(style);
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(finishes);
        var ordered = style.Order == LineOrder.InwardDate
            ? entries.OrderBy(e => e.EntryDate, StringComparer.Ordinal).ThenBy(e => e.RegisterMonth, StringComparer.Ordinal).ThenBy(e => e.InwardNo).ThenBy(e => e.Id)
            : entries.OrderBy(e => e.RegisterMonth, StringComparer.Ordinal).ThenBy(e => e.CarriedOver ? 0 : 1).ThenBy(e => e.InwardNo).ThenBy(e => e.Id);

        var position = 0;
        var items = new List<BillItem>();
        var groups = new Dictionary<string, BillItem>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in ordered)
        {
            var finish = finishes.Resolve(e.Finish);
            var groupKey = style.Lines switch
            {
                LineGrouping.SameLot => LotNumbers.Key(e.LotNo),
                LineGrouping.SameGatePass => BillItem.GatePasses(e),
                _ => string.Empty,
            };
            var key = $"{finish}\u0001{groupKey}";
            if (groupKey.Length > 0 && groups.TryGetValue(key, out var existing))
            {
                existing.Entries.Add(e);
                continue;
            }
            var item = new BillItem { Entries = [e], Finish = finish, Position = position++ };
            items.Add(item);
            if (groupKey.Length > 0) groups[key] = item;
        }
        foreach (var item in items) FillRefs(item, style);

        if (style.Order == LineOrder.Reference)
        {
            items = items.OrderBy(i => i.PrimaryRef, NaturalComparer.Instance).ThenBy(i => i.Position).ToList();
            for (var i = 0; i < items.Count; i++) items[i].Position = i;
        }
        return style.CombineSmallEntries && rules.SmallThanBelow > 0 && rules.CombineMax > 1 ? CombineSmall(items, style, rules) : items;
    }

    private static List<BillItem> CombineSmall(List<BillItem> items, BillingStyle style, FirmSettings rules)
    {
        var result = new List<BillItem>();
        foreach (var finishItems in items.GroupBy(i => i.Finish, StringComparer.OrdinalIgnoreCase))
        {
            var merged = new HashSet<BillItem>();
            foreach (var chunk in finishItems.Where(i => i.Qty < rules.SmallThanBelow).Chunk(rules.CombineMax).Where(c => c.Length > 1))
            {
                var head = chunk[0];
                foreach (var other in chunk.Skip(1))
                {
                    head.Entries.AddRange(other.Entries);
                    merged.Add(other);
                }
                FillRefs(head, style);
            }
            result.AddRange(finishItems.Where(i => !merged.Contains(i)));
        }
        return result.OrderBy(i => i.Position).ToList();
    }

    private static void FillRefs(BillItem item, BillingStyle style)
    {
        var gp = JoinDistinct(item.Entries.Select(BillItem.GatePasses));
        var dn = JoinDistinct(item.Entries.Select(e => e.DesignNo));
        var lot = item.Entries.Count > 1
            ? string.Join(",", item.Entries.SelectMany(e => LotNumbers.Split(e.LotNo)).Distinct())
            : item.Entries[0].LotNo.Trim();
        string Show(ColumnContent content) => content switch
        {
            ColumnContent.GatePass => gp,
            ColumnContent.DesignNo => dn,
            ColumnContent.LotNo => lot,
            _ => string.Empty,
        };
        item.Gpn = Show(style.GpnColumn);
        item.Dn = Show(style.DnColumn);
        item.Lot = Show(style.LotColumn);
        if (style.ShowQuantityBreakdown && item.Entries.Count > 1)
        {
            var breakdown = $"({string.Join("+", item.Entries.Select(e => e.NettThan))})";
            if (style.DnColumn == ColumnContent.Blank) item.Dn = breakdown;
            else if (style.LotColumn == ColumnContent.Blank) item.Lot = breakdown;
            else item.Lot = $"{item.Lot} {breakdown}".Trim();
        }
    }

    private static string JoinDistinct(IEnumerable<string> values) => string.Join(",",
        values.SelectMany(v => v.Split(',')).Select(v => v.Trim()).Where(v => v.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase));
}
