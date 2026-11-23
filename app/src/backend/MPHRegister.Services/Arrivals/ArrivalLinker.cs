using MPHRegister.Data.Config;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Arrivals;

/// <summary>
/// Finds the inward entries an Aawak row carries. A slip number is looked up among the entries dated within a few days of the
/// arrival (whatever register month they are in: imported months end on about the 25th, Aawak months on the last day), and is
/// linked only when one entry of the same firm or a sister firm is clearly the best. When the numbers can be read more than
/// one way ("237-24"), the reading whose slips add up to the arrival's NAG wins. Manual links are never changed here.
/// </summary>
public sealed class ArrivalLinker(IArrivalRepository arrivals, IConfigStore config, TimeProvider clock)
{
    private const int SamePartyScore = 4;
    private const int SisterFirmScore = 3;
    private const int OtherFirmScore = -5;
    private const int SameDayScore = 2;
    private const int NextDayScore = 1;
    private const int FreeSlipScore = 1;
    private const int ClearLead = 2;

    public sealed record Choice(int InwardNo, IReadOnlyList<SlipEntity> Entries);

    /// <param name="Numbers">The reading used.</param>
    /// <param name="Reading">Its position among the readings (0 is the numbers as typed).</param>
    public sealed record Plan(IReadOnlyList<int> Numbers, IReadOnlyList<SlipEntity> Found, IReadOnlyList<int> Missing, IReadOnlyList<Choice> Choices, int SlipsNag, int Reading);

    public int WindowDays => config.Current.Aawak.LinkWindowDays;

    /// <param name="covered">Numbers already linked by hand, with their NAG.</param>
    public Plan PlanFor(string date, string party, int nag, string inwardText, long arrivalId, IReadOnlySet<int> covered, int coveredNag)
    {
        var readings = InwardNumbers.Read(inwardText).Readings;
        if (readings.Count == 0) return new Plan([], [], [], [], coveredNag, 0);
        var day = Dates.ParseIsoOrDefault(date);
        var (from, to) = Window(day, day);
        var numbers = readings.SelectMany(r => r).Where(n => !covered.Contains(n)).Distinct().ToList();
        var slips = arrivals.Slips(numbers, from, to);
        var taken = arrivals.LinksOfEntries(slips.Select(s => s.Id).ToList()).Where(l => l.ArrivalId != arrivalId).Select(l => l.EntryId).ToHashSet();
        var index = ConfigIndex.For(config.Current);

        Plan? best = null;
        (bool, int, int) bestScore = default;
        for (var i = 0; i < readings.Count; i++)
        {
            var found = new List<SlipEntity>();
            var missing = new List<int>();
            var choices = new List<Choice>();
            foreach (var number in readings[i].Where(n => !covered.Contains(n)))
            {
                var candidates = slips.Where(s => s.InwardNo == number)
                    .Select(s => (Slip: s, Score: Score(s, day, party, index, taken)))
                    .OrderByDescending(c => c.Score).ThenBy(c => c.Slip.Id).ToList();
                if (candidates.Count == 0)
                {
                    missing.Add(number);
                    continue;
                }
                var top = candidates[0];
                if (top.Score > 0 && (candidates.Count == 1 || top.Score - candidates[1].Score >= ClearLead))
                {
                    found.Add(top.Slip);
                }
                else
                {
                    missing.Add(number);
                    choices.Add(new Choice(number, candidates.Select(c => c.Slip).ToList()));
                }
            }
            // A slip filed under a firm that is not a sister firm (a mixed load) is taken only when it is the one slip with its
            // number around the date and the whole consignment's NAG then adds up exactly.
            var lone = choices.Where(c => c.Entries.Count == 1 && !index.SameFamily(c.Entries[0].Party, party)).ToList();
            if (lone.Count > 0 && coveredNag + found.Sum(s => s.Nag) + lone.Sum(c => c.Entries[0].Nag) == nag && found.Count + lone.Count == readings[i].Count(n => !covered.Contains(n)))
            {
                found.AddRange(lone.Select(c => c.Entries[0]));
                missing.RemoveAll(n => lone.Any(c => c.InwardNo == n));
                choices.RemoveAll(lone.Contains);
            }
            var slipsNag = coveredNag + found.Sum(s => s.Nag);
            var score = (slipsNag == nag, found.Count, -i);
            if (best is null || score.CompareTo(bestScore) > 0)
            {
                best = new Plan(readings[i], found, missing, choices, slipsNag, i);
                bestScore = score;
            }
        }
        return best!;
    }

    /// <summary>Links the arrival again from its INW NO text (refs and automatic links are replaced).</summary>
    public void Link(ArrivalEntity arrival)
    {
        ArgumentNullException.ThrowIfNull(arrival);
        var existing = arrivals.Links([arrival.Id]);
        var manual = existing.Where(l => l.How == ArrivalLinkHow.Manual).ToList();
        var manualSlips = arrivals.SlipsByIds(manual.Select(l => l.EntryId).ToList()).Where(s => !s.Deleted).ToList();
        var covered = manualSlips.Select(s => s.InwardNo).ToHashSet();
        var coveredNag = manual.Sum(l => l.Nag ?? manualSlips.FirstOrDefault(s => s.Id == l.EntryId)?.Nag ?? 0);
        var plan = PlanFor(arrival.ArrivalDate, arrival.Party, arrival.Nag, arrival.InwardText, arrival.Id, covered, coveredNag);
        arrivals.ReplaceRefs(arrival.Id, plan.Numbers.Concat(covered).Distinct().ToList());
        var now = Dates.Timestamp(clock.GetLocalNow());
        var manualIds = manual.Select(m => m.EntryId).ToHashSet();
        arrivals.ReplaceAutoLinks(arrival.Id, plan.Found.Where(s => !manualIds.Contains(s.Id))
            .Select(s => new ArrivalLinkEntity { ArrivalId = arrival.Id, EntryId = s.Id, CreatedAt = now }).ToList());
        Shares(existing.Select(l => l.EntryId).Concat(plan.Found.Select(s => s.Id)).Distinct().ToList());
    }

    public void Link(IEnumerable<ArrivalEntity> list)
    {
        ArgumentNullException.ThrowIfNull(list);
        foreach (var arrival in list) Link(arrival);
    }

    /// <summary>Links again the arrivals that name these slip numbers around these dates, or are linked to these entries.</summary>
    public void LinkAround(IReadOnlyCollection<long> entryIds, IReadOnlyCollection<int> numbers, string firstDate, string lastDate)
    {
        ArgumentNullException.ThrowIfNull(entryIds);
        ArgumentNullException.ThrowIfNull(numbers);
        var (from, to) = Window(Dates.ParseIsoOrDefault(firstDate), Dates.ParseIsoOrDefault(lastDate));
        var ids = arrivals.Naming(numbers.Where(n => n > 0).Distinct().ToList(), from, to)
            .Concat(arrivals.LinksOfEntries(entryIds).Select(l => l.ArrivalId)).Distinct().ToList();
        Link(arrivals.ByIds(ids));
    }

    /// <summary>
    /// A slip that came in two (or more) loads: when every arrival linked to it names only that slip and their NAG adds up to the
    /// slip's NAG, each link carries its arrival's NAG as its share. Otherwise automatic links carry no share.
    /// </summary>
    public void Shares(IReadOnlyCollection<long> entryIds)
    {
        ArgumentNullException.ThrowIfNull(entryIds);
        if (entryIds.Count == 0) return;
        var links = arrivals.LinksOfEntries(entryIds);
        var slips = arrivals.SlipsByIds(entryIds).ToDictionary(s => s.Id);
        var owners = arrivals.ByIds(links.Select(l => l.ArrivalId).Distinct().ToList()).ToDictionary(a => a.Id);
        var refs = arrivals.Refs(owners.Keys.ToList());
        foreach (var group in links.GroupBy(l => l.EntryId))
        {
            var list = group.ToList();
            var split = list.Count > 1 && slips.TryGetValue(group.Key, out var slip)
                && list.All(l => owners.ContainsKey(l.ArrivalId) && refs.GetValueOrDefault(l.ArrivalId)?.Count == 1)
                && list.Sum(l => owners[l.ArrivalId].Nag) == slip.Nag;
            foreach (var link in list.Where(l => l.How == ArrivalLinkHow.Auto))
            {
                int? share = split ? owners[link.ArrivalId].Nag : null;
                if (link.Nag != share) arrivals.SetShare(link.ArrivalId, link.EntryId, share);
            }
        }
    }

    public (string From, string To) Window(DateOnly first, DateOnly last)
    {
        var days = WindowDays;
        return (Dates.Iso(first.AddDays(-days)), Dates.Iso(last.AddDays(days)));
    }

    private static int Score(SlipEntity slip, DateOnly day, string party, ConfigIndex index, HashSet<long> taken)
    {
        int score;
        if (string.Equals(slip.Party, party, StringComparison.OrdinalIgnoreCase)) score = SamePartyScore;
        else score = index.SameFamily(slip.Party, party) ? SisterFirmScore : OtherFirmScore;
        var apart = Math.Abs(Dates.ParseIsoOrDefault(slip.EntryDate).DayNumber - day.DayNumber);
        score += apart switch { 0 => SameDayScore, 1 => NextDayScore, _ => 0 };
        if (!taken.Contains(slip.Id)) score += FreeSlipScore;
        return score;
    }
}
