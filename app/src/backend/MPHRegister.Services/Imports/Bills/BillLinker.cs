using MPHRegister.Contracts.Billing;
using MPHRegister.Contracts.Entries;
using MPHRegister.Contracts.Imports;
using MPHRegister.Services.Billing;

namespace MPHRegister.Services.Imports.Bills;

/// <summary>One Excel bill to link: its lines, its period and the parties whose inward entries it carries.</summary>
public sealed record LinkBill(string InvoiceNo, string PartyName, DateOnly From, DateOnly To, IReadOnlyList<LineDto> Lines, IReadOnlySet<string> Own, FinishResolver Finishes);

/// <param name="Lines">Per bill, its lines with the entries found for each.</param>
/// <param name="Matched">Per bill, the lines linked to at least one entry.</param>
/// <param name="Missed">Per bill, the lines that bill inward work but were not linked.</param>
/// <param name="Conflicts">Lines whose entries are on a bill made in the app already (importing would bill them twice).</param>
/// <param name="Notes">Lines and entries whose THAN do not quite agree, and lines whose entries are on an earlier bill.</param>
/// <param name="Used">Entry id → the bill (first bill when split over continuation bills) it is linked to.</param>
public sealed record LinkOutcome(
    IReadOnlyList<IReadOnlyList<LineDto>> Lines,
    IReadOnlyList<int> Matched,
    IReadOnlyList<int> Missed,
    IReadOnlyList<BillImportLine> Unmatched,
    IReadOnlyList<BillLinkSuggestion> Suggestions,
    IReadOnlyList<string> Conflicts,
    IReadOnlyList<string> Notes,
    IReadOnlyDictionary<long, string> Used);

/// <summary>
/// Links the bills of one party (with its sister firms) to inward entries, then explains the lines left over: their entries
/// are on a bill already, or they look like the entries of another party (a suggestion to put the two in one sister-firm group).
/// </summary>
public static class BillLinker
{
    /// <param name="pool">Unbilled entries of the parties the bills carry.</param>
    /// <param name="billed">Entries of those parties already billed, with <see cref="EntryDto.BilledIn"/> naming the bill.</param>
    /// <param name="onAppBills">Entries on bills made in the app.</param>
    /// <param name="others">Unbilled entries of other parties, for suggestions.</param>
    public static LinkOutcome Link(IReadOnlyList<LinkBill> bills, IReadOnlyList<EntryDto> pool, IReadOnlyList<EntryDto> billed, IReadOnlySet<long> onAppBills, IReadOnlyList<EntryDto> others)
    {
        ArgumentNullException.ThrowIfNull(bills);
        ArgumentNullException.ThrowIfNull(pool);
        ArgumentNullException.ThrowIfNull(billed);
        ArgumentNullException.ThrowIfNull(onAppBills);
        ArgumentNullException.ThrowIfNull(others);
        var places = new List<(int Bill, int Line)>();
        var lines = new List<MatchLine>();
        for (var b = 0; b < bills.Count; b++)
        {
            var bill = bills[b];
            foreach (var (index, finish) in BillLineMatcher.Billable(bill.Lines))
            {
                lines.Add(new MatchLine(places.Count, bill.Lines[index], finish, bill.From, bill.To, bill.Own, bill.Finishes, b));
                places.Add((b, index));
            }
        }
        var found = BillLineMatcher.Match(lines, pool, MatchMode.Full, billed);
        var notes = new List<string>();
        var conflicts = new List<string>();
        string Where(MatchLine line) => $"{bills[places[line.Key].Bill].InvoiceNo} row {places[line.Key].Line + 1}";

        var lost = lines.Where(l => !found.Links.ContainsKey(l.Key)).ToList();
        var onBills = BillLineMatcher.Match(lost, billed, MatchMode.NumbersOnly);
        var billedById = billed.ToDictionary(e => e.Id);
        foreach (var line in lost.Where(l => onBills.Links.ContainsKey(l.Key) && !onBills.Missing.ContainsKey(l.Key)))
        {
            var entries = onBills.Links[line.Key].Select(id => billedById[id]).ToList();
            var text = $"INW. NO. {string.Join(", ", entries.Select(e => e.InwardNo))} ({string.Join(", ", entries.Select(e => e.BilledIn).Distinct())})";
            if (entries.Any(e => onAppBills.Contains(e.Id))) conflicts.Add($"{Where(line)}: {text} is already billed in the app. Importing would bill it twice — cancel that app bill first.");
            else notes.Add($"{Where(line)}: its entries are on an earlier bill already, {text}; not linked again.");
        }
        var unexplained = lost.Where(l => !onBills.Links.ContainsKey(l.Key) || onBills.Missing.ContainsKey(l.Key)).ToList();
        var suggestions = Suggest(unexplained, others, bills, places);
        notes.AddRange(lines.Where(l => found.Slips.ContainsKey(l.Key)).Select(l =>
            $"{Where(l)}: {string.Join(", ", found.Slips[l.Key])} read as a typing slip (the THAN agree exactly)."));
        var poolById = pool.ToDictionary(e => e.Id);
        foreach (var line in lines.Where(l => found.QuantityLabels.ContainsKey(l.Key)))
        {
            var entry = poolById[found.QuantityLabels[line.Key]];
            notes.Add($"{Where(line)}: LOT {line.Line.Lot} read as received THAN for INW. NO. {entry.InwardNo} ({entry.RegisterMonth}); {line.Line.Qty} THAN billed.");
        }
        // A lone plain slip on a row without numbers is the usual one-slip row; rows with numbers or several slips are noted.
        foreach (var line in lines.Where(l => found.Plain.TryGetValue(l.Key, out var ids) && (ids.Count > 1 || found.Links[l.Key].Count > 1 || HasNumbers(l.Line))))
        {
            var ids = found.Plain[line.Key];
            var text = string.Join(", ", ids.Select(id => $"{poolById[id].InwardNo} ({poolById[id].RegisterMonth}, {poolById[id].NettThan} THAN)"));
            notes.Add($"{Where(line)}: INW. NO. {text} {(ids.Count > 1 ? "have" : "has")} no design or lot; taken on this row because the THAN fill it exactly.");
        }
        notes.AddRange(ShortLines(lines, found, Where));
        notes.AddRange(ShortEntries(pool, found));
        return Outcome(bills, new Matched(lines, places, found), lost, unexplained, suggestions, conflicts, notes);
    }

    /// <summary>Lines that match the entries of a party outside this bill's parties exactly (every entry whole, same THAN).</summary>
    private static List<BillLinkSuggestion> Suggest(List<MatchLine> lines, IReadOnlyList<EntryDto> others, IReadOnlyList<LinkBill> bills, List<(int Bill, int Line)> places)
    {
        if (lines.Count == 0 || others.Count == 0) return [];
        var byId = others.ToDictionary(e => e.Id);
        var found = BillLineMatcher.Match(lines, others, MatchMode.NumbersOnly);
        var suggestions = new List<BillLinkSuggestion>();
        foreach (var line in lines.Where(l => found.Links.ContainsKey(l.Key) && !found.Missing.ContainsKey(l.Key)))
        {
            var entries = found.Links[line.Key].Select(id => byId[id]).ToList();
            if (entries.Any(e => found.Used[e.Id] != e.NettThan) || entries.Select(e => e.Party).Distinct(StringComparer.OrdinalIgnoreCase).Count() != 1) continue;
            var (bill, index) = places[line.Key];
            suggestions.Add(new BillLinkSuggestion(bills[bill].InvoiceNo, index + 1, bills[bill].PartyName, entries[0].Party, entries[0].RegisterMonth,
                entries.Select(e => e.InwardNo).ToList(), line.Line.Qty ?? 0));
        }
        return suggestions;
    }

    private static bool HasNumbers(LineDto line) => !RefTokens.Union([RefTokens.Parse(line.Gpn), RefTokens.Parse(line.Dn), RefTokens.Parse(line.Lot)]).IsEmpty;

    private static IEnumerable<string> ShortLines(List<MatchLine> lines, MatchResult found, Func<MatchLine, string> where)
    {
        foreach (var line in lines.Where(l => found.Links.ContainsKey(l.Key) && found.Missing.ContainsKey(l.Key)))
        {
            var qty = line.Line.Qty ?? 0;
            var missing = found.Missing[line.Key];
            if (missing > BillLineMatcher.Tolerance(qty)) yield return $"{where(line)}: {qty} THAN billed but only {qty - missing} found in the inward register for its numbers.";
        }
    }

    private static IEnumerable<string> ShortEntries(IReadOnlyList<EntryDto> pool, MatchResult found)
    {
        foreach (var entry in pool.Where(e => found.Used.ContainsKey(e.Id)))
        {
            var used = found.Used[entry.Id];
            if (entry.NettThan - used > BillLineMatcher.Tolerance(entry.NettThan))
                yield return $"INW. NO. {entry.InwardNo} ({entry.RegisterMonth}, {entry.Party}) received {entry.NettThan} THAN but these bills show {used}; linked — the rest is taken as returned unfinished or billed elsewhere.";
        }
    }

    private static LinkOutcome Outcome(IReadOnlyList<LinkBill> bills, Matched matched, List<MatchLine> lost, List<MatchLine> unexplained,
        List<BillLinkSuggestion> suggestions, List<string> conflicts, List<string> notes)
    {
        var (lines, places, found) = matched;
        // Lines that bill nothing (memo rows, =SUM rows) carry no entries, even if an older import linked them.
        var result = bills.Select(b => b.Lines.Select(l => (l.EntryIds?.Count ?? 0) > 0 ? l with { EntryIds = [] } : l).ToList()).ToList();
        var linked = new int[bills.Count];
        var missed = new int[bills.Count];
        var used = new Dictionary<long, string>();
        foreach (var key in lines.Select(l => l.Key))
        {
            var (bill, index) = places[key];
            var ids = found.Links.GetValueOrDefault(key) ?? [];
            result[bill][index] = result[bill][index] with { EntryIds = ids };
            if (ids.Count > 0) linked[bill]++;
            foreach (var id in ids) used.TryAdd(id, bills[bill].InvoiceNo);
        }
        foreach (var key in lost.Select(l => l.Key)) missed[places[key].Bill]++;
        var unmatched = unexplained.Select(l =>
        {
            var (bill, index) = places[l.Key];
            return new BillImportLine(bills[bill].InvoiceNo, index + 1, bills[bill].PartyName, l.Line.Gpn ?? string.Empty, l.Line.Dn ?? string.Empty,
                l.Line.Lot ?? string.Empty, l.Finish, l.Line.Qty ?? 0);
        }).ToList();
        return new LinkOutcome(result.Select(r => (IReadOnlyList<LineDto>)r).ToList(), linked, missed, unmatched, suggestions, conflicts, notes, used);
    }

    private sealed record Matched(List<MatchLine> Lines, List<(int Bill, int Line)> Places, MatchResult Found);
}
