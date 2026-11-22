using System.Globalization;
using MPHRegister.Data.Entities;

namespace MPHRegister.Services.Imports.Inward;

/// <summary>Rows (indexes) and saved entries of one slip shared by several of them, still to be paired.</summary>
public sealed record SharedSlip(List<int> Rows, List<EntryEntity> Entries);

/// <summary>
/// Finds which saved entry of the month each row of a newer copy of the month's workbook is. Rows are first matched on
/// their slip (INW. NO., DATE and PARTY, the same as carryovers); rows left over are then matched on INW. NO. alone (the
/// date or party was corrected) and last on DATE, PARTY, D.N., LOT N. and THAN (the INW. NO. was corrected), each time
/// only where exactly one row and one entry share it. Results map a row's index in the list to its entry.
/// </summary>
public static class SavedEntryMatcher
{
    /// <summary>
    /// Rows sharing a slip with other rows (a blank INW. NO. is 0, or a number used twice) are paired on what they hold
    /// (as the entry's row was last imported, else as saved), then on D.N., LOT N. and THAN. What is left of such a slip
    /// comes back as <see cref="SharedSlip"/>: the loose matching may still find their entries elsewhere in the month (one
    /// given a number in the Register), and only then <see cref="InOrder"/> pairs the rest in workbook order.
    /// </summary>
    public static (Dictionary<int, EntryEntity> Matches, List<SharedSlip> Shared) BySlip(
        IReadOnlyList<InwardRow> rows, IReadOnlyList<EntryEntity> saved, IReadOnlyDictionary<long, SourceValues> lastRows)
    {
        ArgumentNullException.ThrowIfNull(rows);
        ArgumentNullException.ThrowIfNull(saved);
        ArgumentNullException.ThrowIfNull(lastRows);
        var pool = saved.OrderBy(e => e.SourceRow ?? int.MaxValue).ThenBy(e => e.Id)
            .GroupBy(e => Slip(e.InwardNo, e.EntryDate, e.Party), StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var matches = new Dictionary<int, EntryEntity>();
        var shared = new List<SharedSlip>();
        foreach (var group in Enumerable.Range(0, rows.Count).GroupBy(i => Slip(rows[i].InwardNo, rows[i].Date, rows[i].Party), StringComparer.Ordinal))
        {
            if (!pool.TryGetValue(group.Key, out var candidates)) continue;
            var open = group.ToList();
            var left = candidates.ToList();
            if (open.Count == 1 && left.Count == 1)
            {
                matches[open[0]] = left[0];
                continue;
            }
            PairOnContent(open, left, i => Full(rows[i]), e => lastRows.TryGetValue(e.Id, out var last) ? Full(last) : Full(e), matches);
            PairOnContent(open, left, i => Short(rows[i]), e => lastRows.TryGetValue(e.Id, out var last) ? Short(last) : Short(e), matches);
            if (open.Count > 0 && left.Count > 0) shared.Add(new SharedSlip(open, left));
        }
        return (matches, shared);
    }

    /// <summary>Pairs the rows and entries of each shared slip that are still open, in workbook order.</summary>
    public static void InOrder(IEnumerable<SharedSlip> shared, Dictionary<int, EntryEntity> matches)
    {
        ArgumentNullException.ThrowIfNull(shared);
        ArgumentNullException.ThrowIfNull(matches);
        var taken = matches.Values.Select(e => e.Id).ToHashSet();
        foreach (var slip in shared)
        {
            var open = slip.Rows.Where(i => !matches.ContainsKey(i)).ToList();
            var left = slip.Entries.Where(e => !taken.Contains(e.Id)).ToList();
            foreach (var (i, entry) in open.Zip(left))
            {
                matches[i] = entry;
                taken.Add(entry.Id);
            }
        }
    }

    public static Dictionary<int, EntryEntity> Loosely(IReadOnlyList<InwardRow> rows, IEnumerable<int> openRows, IEnumerable<EntryEntity> openEntries)
    {
        ArgumentNullException.ThrowIfNull(rows);
        var matches = new Dictionary<int, EntryEntity>();
        var rowsLeft = openRows.ToList();
        var entriesLeft = openEntries.ToList();
        Pair(r => r.InwardNo > 0 ? Key(r.InwardNo, r.AfterBlankRows) : null, e => e.InwardNo > 0 ? Key(e.InwardNo, e.CarriedOver) : null);
        Pair(r => Key(r.Date, Up(r.Party), Up(r.Design), Up(r.Lot), r.Than, r.AfterBlankRows), e => Key(e.EntryDate, Up(e.Party), Up(e.DesignNo), Up(e.LotNo), e.Than, e.CarriedOver));
        return matches;

        void Pair(Func<InwardRow, string?> rowKey, Func<EntryEntity, string?> entryKey)
        {
            var rowsByKey = Unique(rowsLeft, i => rowKey(rows[i]));
            var entriesByKey = Unique(entriesLeft, entryKey);
            foreach (var (key, i) in rowsByKey)
            {
                if (!entriesByKey.TryGetValue(key, out var entry)) continue;
                matches[i] = entry;
                rowsLeft.Remove(i);
                entriesLeft.RemoveAll(e => e.Id == entry.Id);
            }
        }
    }

    /// <summary>Each open row in order takes the first open entry holding the same; both leave the open lists.</summary>
    private static void PairOnContent(List<int> open, List<EntryEntity> left, Func<int, string> rowKey, Func<EntryEntity, string> entryKey, Dictionary<int, EntryEntity> matches)
    {
        foreach (var i in open.ToList())
        {
            var key = rowKey(i);
            var entry = left.FirstOrDefault(e => string.Equals(entryKey(e), key, StringComparison.Ordinal));
            if (entry is null) continue;
            matches[i] = entry;
            open.Remove(i);
            left.Remove(entry);
        }
    }

    private static string Full(InwardRow r) => Key(Up(r.Design), Up(r.Lot), r.Than, r.Tp, r.TwoPart, Up(r.Finish));

    private static string Full(SourceValues v) => Key(Up(v.Design), Up(v.Lot), v.Than, v.Tp, v.TwoPart, Up(v.Finish));

    private static string Full(EntryEntity e) => Key(Up(e.DesignNo), Up(e.LotNo), e.Than, e.Tp, e.TwoPart, Up(e.Finish));

    private static string Short(InwardRow r) => Key(Up(r.Design), Up(r.Lot), r.Than);

    private static string Short(SourceValues v) => Key(Up(v.Design), Up(v.Lot), v.Than);

    private static string Short(EntryEntity e) => Key(Up(e.DesignNo), Up(e.LotNo), e.Than);

    private static Dictionary<string, T> Unique<T>(IEnumerable<T> items, Func<T, string?> key) => items
        .Select(item => (Item: item, Key: key(item)))
        .Where(x => x.Key is not null)
        .GroupBy(x => x.Key!, StringComparer.Ordinal)
        .Where(g => g.Count() == 1)
        .ToDictionary(g => g.Key, g => g.Single().Item, StringComparer.Ordinal);

    internal static string Slip(int inwardNo, string date, string party) => Key(inwardNo, date, Up(party));

    private static string Key(params object[] parts) => string.Join("|", parts.Select(p => Convert.ToString(p, CultureInfo.InvariantCulture)));

    private static string Up(string text) => text.ToUpperInvariant();
}
