using MPHRegister.Contracts.Entries;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Imports.Bills;

/// <summary>Linking lines to entries on their own numbers: how strong the evidence is, and moving THAN over the strongest links first.</summary>
public static partial class BillLineMatcher
{
    private static List<Edge> Edges(List<Want> wants, List<Candidate> candidates)
    {
        var index = new Dictionary<string, List<Candidate>>(StringComparer.Ordinal);
        foreach (var candidate in candidates)
        {
            foreach (var token in candidate.All.Strong.Concat(candidate.All.Weak)) Bucket(index, token).Add(candidate);
        }
        var edges = new List<Edge>();
        foreach (var want in wants)
        {
            var seen = new HashSet<Candidate>();
            foreach (var token in want.All.Strong.Concat(want.All.Weak))
            {
                if (!index.TryGetValue(token, out var found)) continue;
                seen.UnionWith(found);
            }
            foreach (var candidate in seen.OrderBy(c => c.Order))
            {
                if (EdgeFor(want, candidate) is { } edge) edges.Add(edge);
            }
        }
        return edges;
    }

    private static List<Candidate> Bucket(Dictionary<string, List<Candidate>> index, string token)
    {
        if (!index.TryGetValue(token, out var list)) index[token] = list = [];
        return list;
    }

    private static Edge? EdgeFor(Want want, Candidate candidate)
    {
        var distance = Distance(want.Line, candidate);
        if (distance is null) return null;
        var (tier, score) = Evidence(want, candidate);
        if (tier == Tier.None) return null;
        var exact = want.Line.Line.Qty == candidate.Entry.NettThan;
        var own = want.Line.Own.Contains(candidate.Entry.Party);
        // A near-period slip naming only the billed lot has better evidence than a mixed-lot slip.
        var specificLot = tier == Tier.Own && own && distance.Value <= 7 && candidate.When <= want.Line.To
            && want.Gpn.IsEmpty && want.Dn.IsEmpty && want.Lot.Strong.Count == 1
            && candidate.Lot.Strong.SetEquals(want.Lot.Strong)
            && string.Equals(want.Line.Finish, candidate.Entry.Finish, StringComparison.OrdinalIgnoreCase);
        var cost = ((12 - score) * 20L) + Math.Min(distance.Value, 120) + (exact ? 0 : 15) + (own ? 0 : 60) - (specificLot ? 8 : 0);
        return new Edge(want, candidate, tier, cost);
    }

    /// <summary>How strongly the line's numbers point at the entry, and a score to choose among entries of the same strength.</summary>
    private static (Tier Tier, int Score) Evidence(Want want, Candidate candidate)
    {
        var gatePass = want.Gpn.Strong.Overlaps(candidate.Gate.Strong);
        var design = want.Dn.Strong.Overlaps(candidate.Design.Strong);
        var lot = want.Lot.Strong.Overlaps(candidate.Lot.Strong);
        var crossed = Crossed(want, candidate);
        var score = (gatePass ? 4 : 0) + (design ? 3 : 0) + (lot ? 2 : 0) + (crossed ? 1 : 0);
        if ((gatePass && (design || lot || (want.Dn.IsEmpty && want.Lot.IsEmpty))) || (design && lot)) return (Tier.Strong, score);
        if (gatePass || design || lot) return (Tier.Own, score);
        if (crossed || Shortened(want, candidate)) return (Tier.Crossed, score);
        return (Tier.None, 0);
    }

    /// <summary>
    /// A number of three or more characters written in another column (designs spread over G.P.N., D.N. and LOT), or a
    /// letter label (A, B, O) that is the entry's whole design or lot.
    /// </summary>
    private static bool Crossed(Want want, Candidate candidate)
    {
        foreach (var token in want.All.Strong)
        {
            if (!candidate.All.Strong.Contains(token) || (token.Length < CrossTokenLength && !candidate.Labels.Contains(token))) continue;
            var typed = (want.Gpn.Strong.Contains(token) && candidate.Gate.Strong.Contains(token))
                || (want.Dn.Strong.Contains(token) && candidate.Design.Strong.Contains(token))
                || (want.Lot.Strong.Contains(token) && candidate.Lot.Strong.Contains(token));
            if (!typed) return true;
        }
        return false;
    }

    private static bool Shortened(Want want, Candidate candidate) =>
        want.All.Weak.Overlaps(candidate.Numbers.Strong) || want.All.Strong.Overlaps(candidate.Numbers.Weak);

    /// <summary>Days the entry was sent outside the bill period; null when it cannot be on this bill.</summary>
    private static int? Distance(MatchLine line, Candidate candidate)
    {
        if (candidate.Date > line.To.AddDays(DaysEntryAfterPeriod)) return null;
        var when = candidate.When;
        if (when < line.From.AddDays(-DaysBeforePeriod)) return null;
        if (when > line.To.AddDays(DaysSentAfterPeriod))
        {
            // A dispatch dated long after the bill is usually a typing slip; only the exact THAN is trusted then.
            return line.Line.Qty == candidate.Entry.NettThan ? when.DayNumber - line.To.DayNumber : null;
        }
        if (when < line.From) return line.From.DayNumber - when.DayNumber;
        return when > line.To ? when.DayNumber - line.To.DayNumber : 0;
    }

    /// <summary>Moves as much THAN as possible from entries to lines over these arcs, cheapest arcs first.</summary>
    private static void Flow(List<Edge> edges)
    {
        var active = edges.Where(e => e.Want.Need > 0 && e.Candidate.Left > 0).ToList();
        if (active.Count == 0) return;
        var wants = active.Select(e => e.Want).Distinct().ToList();
        var candidates = active.Select(e => e.Candidate).Distinct().ToList();
        var wantNode = wants.Select((w, i) => (w, i)).ToDictionary(x => x.w, x => x.i + 2);
        var candidateNode = candidates.Select((c, i) => (c, i)).ToDictionary(x => x.c, x => x.i + 2 + wants.Count);
        var graph = new MinCostFlow(2 + wants.Count + candidates.Count);
        foreach (var want in wants) graph.Add(0, wantNode[want], want.Need, 0);
        foreach (var candidate in candidates) graph.Add(candidateNode[candidate], 1, candidate.Left, 0);
        var arcs = active.Select(e => (Edge: e, Arc: graph.Add(wantNode[e.Want], candidateNode[e.Candidate], e.Want.Need, e.Cost))).ToList();
        graph.Run(0, 1);
        foreach (var (edge, arc) in arcs)
        {
            var qty = graph.FlowOn(arc);
            if (qty > 0) edge.Want.Take(edge.Candidate, qty);
        }
    }

    /// <summary>
    /// A small part of an entry sent after the bills' period (1 of 122 THAN) is usually next month's bill: that bill should get
    /// the whole entry. Such parts are given back and the entry is left for later bills.
    /// </summary>
    private static bool DropFragments(List<Want> wants)
    {
        var holders = wants.SelectMany(w => w.Taken.Keys.Select(c => (Want: w, Candidate: c))).GroupBy(x => x.Candidate, x => x.Want).ToList();
        var dropped = false;
        foreach (var holder in holders)
        {
            var candidate = holder.Key;
            var used = candidate.Entry.NettThan - candidate.Left;
            if (used * 2 >= candidate.Entry.NettThan || candidate.When <= holder.Max(w => w.Line.To)) continue;
            foreach (var want in holder) want.GiveBack(candidate);
            candidate.Left = 0;
            dropped = true;
        }
        return dropped;
    }

    /// <summary>
    /// A line that lists several numbers bills an entry of each ("6948 / 6894" is one slip of each design, rows combined on the
    /// bill). When one of its numbers has no entry on the line yet, but a free entry has it, that entry takes the place of an entry
    /// of the same THAN whose numbers the line has through its other entries: the stronger match of one number must not leave
    /// the slip of another unbilled (MAPLE MILLS JOB\77, ARNOLD JOB\41 with a second design in the G.P.N. column).
    /// </summary>
    private static bool CoverEveryNumber(List<Edge> edges)
    {
        var changed = false;
        foreach (var group in edges.GroupBy(e => e.Want))
        {
            var want = group.Key;
            if (want.Taken.Count == 0) continue;
            foreach (var token in want.All.Strong.Where(t => t.Length >= CrossTokenLength && t.All(char.IsAsciiDigit)).Order(StringComparer.Ordinal))
            {
                if (want.Taken.Keys.Any(c => c.All.Strong.Contains(token))) continue;
                foreach (var found in group.Where(e => e.Candidate.Left > 0 && e.Candidate.All.Strong.Contains(token) && CloseToPeriod(want.Line, e.Candidate))
                    .OrderBy(e => e.Cost).ThenBy(e => e.Candidate.Order).Select(e => e.Candidate))
                {
                    var qty = found.Left;
                    // An entry of the line gives up as many THAN: all of them if the line has its numbers through other entries.
                    var spare = group.Where(e => want.Taken.GetValueOrDefault(e.Candidate) > qty || (want.Taken.GetValueOrDefault(e.Candidate) == qty && Spare(want, e.Candidate)))
                        .OrderByDescending(e => e.Tier).ThenByDescending(e => e.Cost).Select(e => e.Candidate).FirstOrDefault();
                    if (spare is null) continue;
                    want.GiveBack(spare, want.Taken[spare] - qty);
                    want.Take(found, qty);
                    changed = true;
                    break;
                }
            }
        }
        return changed;
    }

    /// <summary>Every number of the line the entry has is also on another entry of the line.</summary>
    private static bool Spare(Want want, Candidate candidate) =>
        want.All.Strong.Where(candidate.All.Strong.Contains).All(t => want.Taken.Keys.Any(o => o != candidate && o.All.Strong.Contains(t)));
}
