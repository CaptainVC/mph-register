using MPHRegister.Contracts.Entries;
using MPHRegister.Services.Billing;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Imports.Bills;

/// <summary>What is tried once the numbers are used up: typing slips, THAN written as a label, and lines without numbers.</summary>
public static partial class BillLineMatcher
{
    /// <summary>
    /// Lines still short of THAN: the unbilled entries one digit off (or with two neighbouring digits swapped) from a number on
    /// the line are linked only when the line is then complete and the entry's THAN all used. First the numbers that no entry
    /// near the bill has as written. Then, on a line clearly short, the numbers billed as written already, on this line or on
    /// others: two rows were combined into one on the bill and only one number was written ("13565" for 1 THAN of 13565 and
    /// 40 of 13665); then only whole entries sent in or close to the bill period are taken.
    /// </summary>
    private static void TypingSlips(List<Want> wants, List<Candidate> candidates, List<Candidate> register)
    {
        var free = Index(candidates.Where(c => c.Left > 0));
        var pooled = Index(candidates);
        var billed = Index(register);
        var edges = new List<(Edge Edge, Slip Slip)>();
        foreach (var want in wants.Where(w => w.Need > 0))
        {
            var clearlyShort = want.Need > Tolerance(want.Line.Line.Qty ?? 0);
            foreach (var token in want.All.Strong.Where(t => t.Length >= CrossTokenLength && t.All(char.IsAsciiDigit)))
            {
                bool Near(Candidate c) => Distance(want.Line, c) is not null;
                if (free.GetValueOrDefault(token, []).Any(Near)) continue;
                var onLine = want.Taken.Keys.Any(c => c.All.Strong.Contains(token));
                // A slip billed a month or more before this bill's period is not what the bill means.
                if (!onLine && billed.GetValueOrDefault(token, []).Any(c => Near(c) && c.When >= want.Line.From.AddDays(-DaysBilledBeforePeriod))) continue;
                var joined = onLine || pooled.GetValueOrDefault(token, []).Any(Near);
                if (joined && !clearlyShort) continue;
                foreach (var (near, candidate) in Neighbours(token).SelectMany(n => free.GetValueOrDefault(n, []).Select(c => (n, c))))
                {
                    if (Distance(want.Line, candidate) is not { } days) continue;
                    if (joined && !CloseToPeriod(want.Line, candidate)) continue;
                    var own = want.Line.Own.Contains(candidate.Entry.Party);
                    edges.Add((new Edge(want, candidate, Tier.Slip, Math.Min(days, 120) + (own ? 0 : 60)), new Slip(token, near, joined)));
                }
            }
        }
        var exact = new HashSet<Edge>();
        foreach (var joined in new[] { false, true })
        {
            var unique = edges.Where(e => e.Slip.Joined == joined).Select(e => e.Edge).Distinct().ToList();
            foreach (var group in unique.GroupBy(e => e.Want))
            {
                if (ExactSubset(group.ToList(), group.Key.Need) is not { } subset) continue;
                foreach (var edge in subset) edge.Want.Take(edge.Candidate, edge.Candidate.Left);
                exact.UnionWith(subset);
            }
            exact.UnionWith(Exact(unique.Where(e => e.Want.Need > 0 && e.Candidate.Left > 0).ToList()));
        }
        // An entry reached both ways is noted once, as the plain typing slip.
        foreach (var pair in edges.Where(e => exact.Contains(e.Edge)).GroupBy(e => (e.Edge.Want, e.Edge.Candidate)))
        {
            var plain = pair.Where(e => !e.Slip.Joined).ToList();
            foreach (var (edge, slip) in plain.Count > 0 ? plain : [.. pair]) edge.Want.Slips.Add(slip);
        }
    }

    /// <summary>
    /// A whole entry of this bill's register month or earlier, sent in the bill period or just before it: the only kind of
    /// entry a combined row is read to carry.
    /// </summary>
    private static bool CloseToPeriod(MatchLine line, Candidate candidate) =>
        candidate.Left == candidate.Entry.NettThan && candidate.When <= line.To && candidate.When >= line.From.AddDays(-DaysJoinedBeforePeriod)
        && string.CompareOrdinal(candidate.Entry.RegisterMonth, Dates.Iso(line.To)[..7]) <= 0;

    /// <summary>The entries (fewest, then cheapest) whose THAN left add up to exactly what one line still needs.</summary>
    private static List<Edge>? ExactSubset(List<Edge> edges, int need)
    {
        const int MaxEntries = 6;
        var options = edges.Where(e => e.Candidate.Left > 0 && e.Candidate.Left <= need).GroupBy(e => e.Candidate).Select(g => g.MinBy(e => e.Cost)!)
            .OrderBy(e => e.Cost).Take(16).ToList();
        List<Edge>? best = null;
        var chosen = new List<Edge>();
        void Search(int start, int left)
        {
            if (left == 0)
            {
                if (best is null || chosen.Count < best.Count || (chosen.Count == best.Count && chosen.Sum(e => e.Cost) < best.Sum(e => e.Cost))) best = [.. chosen];
                return;
            }
            if (chosen.Count == MaxEntries) return;
            for (var i = start; i < options.Count; i++)
            {
                if (options[i].Candidate.Left > left) continue;
                chosen.Add(options[i]);
                Search(i + 1, left - options[i].Candidate.Left);
                chosen.RemoveAt(chosen.Count - 1);
            }
        }
        if (need > 0) Search(0, need);
        return best;
    }

    /// <summary>
    /// Flows over the arcs, then gives back what went to a line left short or to an entry not used up, and flows again
    /// without them, until every line and entry that took part agrees exactly. Returns the arcs that stayed.
    /// </summary>
    private static HashSet<Edge> Exact(List<Edge> edges)
    {
        var before = edges.Select(e => (e.Want, e.Candidate)).Distinct().ToDictionary(p => p, p => p.Want.Taken.GetValueOrDefault(p.Candidate));
        bool Took(Edge e) => e.Want.Taken.GetValueOrDefault(e.Candidate) > before[(e.Want, e.Candidate)];
        var active = edges;
        while (active.Count > 0)
        {
            Flow(active);
            var taking = active.Where(Took).ToList();
            var shortWants = taking.Select(e => e.Want).Where(w => w.Need > 0).ToHashSet();
            var leftOver = taking.Select(e => e.Candidate).Where(c => c.Left > 0).ToHashSet();
            if (shortWants.Count == 0 && leftOver.Count == 0) return taking.ToHashSet();
            foreach (var edge in taking.Where(Took)) edge.Want.GiveBack(edge.Candidate, before[(edge.Want, edge.Candidate)]);
            active = active.Where(e => !shortWants.Contains(e.Want) && !leftOver.Contains(e.Candidate)).ToList();
        }
        return [];
    }

    private static Dictionary<string, List<Candidate>> Index(IEnumerable<Candidate> candidates)
    {
        var index = new Dictionary<string, List<Candidate>>(StringComparer.Ordinal);
        foreach (var candidate in candidates)
        {
            foreach (var token in candidate.All.Strong) Bucket(index, token).Add(candidate);
        }
        return index;
    }

    /// <summary>Numbers one digit off, or with two neighbouring digits swapped.</summary>
    private static IEnumerable<string> Neighbours(string number)
    {
        var digits = number.ToCharArray();
        for (var i = 0; i < digits.Length; i++)
        {
            var kept = digits[i];
            for (var d = '0'; d <= '9'; d++)
            {
                if (d == kept || (i == 0 && d == '0')) continue;
                digits[i] = d;
                yield return new string(digits);
            }
            digits[i] = kept;
        }
        for (var i = 0; i + 1 < digits.Length; i++)
        {
            if (digits[i] == digits[i + 1] || (i == 0 && digits[1] == '0')) continue;
            (digits[i], digits[i + 1]) = (digits[i + 1], digits[i]);
            yield return new string(digits);
            (digits[i], digits[i + 1]) = (digits[i + 1], digits[i]);
        }
    }

    /// <summary>
    /// Slips with no design or lot at all (blank or "MIX") are often billed inside a row of other slips of the same finish, which
    /// then bills more THAN than its numbers have (MAPLE MILLS JOB\77 row 17: designs 3215 and 2287 plus the plain slip on their gate
    /// pass), or on a "MIX" row of their own. A line clearly short, or with no number, takes whole such entries of its finish sent in
    /// the bill period only when they add up to exactly what it still needs, and only when no other such entry of the same THAN
    /// could have been taken instead. Entries on the gate pass of the line's other slips are the only ones tried when there are any.
    /// </summary>
    private static void Unnumbered(List<Want> wants, List<Candidate> candidates)
    {
        var plain = candidates.Where(c => c.Numbers.IsEmpty).ToList();
        if (plain.Count == 0) return;
        var edges = new List<Edge>();
        foreach (var want in wants.Where(w => w.Need > 0 && (w.All.IsEmpty || w.Need > Tolerance(w.Line.Line.Qty ?? 0))))
        {
            var fit = plain.Where(c => CloseToPeriod(want.Line, c) && SameFinish(want.Line.Finishes, c.Entry, want.Line.Finish)).ToList();
            var gates = want.Taken.Keys.SelectMany(c => c.Gate.Strong).ToHashSet(StringComparer.Ordinal);
            var sameGate = fit.Where(c => c.Gate.Strong.Overlaps(gates)).ToList();
            foreach (var candidate in sameGate.Count > 0 ? sameGate : fit)
            {
                if (Distance(want.Line, candidate) is not { } days) continue;
                var own = want.Line.Own.Contains(candidate.Entry.Party);
                edges.Add(new Edge(want, candidate, Tier.Slip, days + (own ? 0 : 60)));
            }
        }
        var taken = new List<Edge>();
        foreach (var group in edges.GroupBy(e => e.Want))
        {
            if (ExactSubset(group.ToList(), group.Key.Need) is not { } subset || Interchangeable(group, subset)) continue;
            foreach (var edge in subset) edge.Want.Take(edge.Candidate, edge.Candidate.Left);
            taken.AddRange(subset);
        }
        var rest = edges.Where(e => e.Want.Need > 0 && e.Candidate.Left > 0).ToList();
        var joint = Exact(rest);
        if (joint.GroupBy(e => e.Want).Any(g => Interchangeable(rest.Where(e => e.Want == g.Key), g)))
        {
            foreach (var edge in joint) edge.Want.GiveBack(edge.Candidate);
        }
        else
        {
            taken.AddRange(joint);
        }
        foreach (var edge in taken) edge.Want.Plain.Add(edge.Candidate);
    }

    /// <summary>An entry left free that has the THAN of one taken: which of the two the line bills cannot be told.</summary>
    private static bool Interchangeable(IEnumerable<Edge> edges, IEnumerable<Edge> taken)
    {
        var chosen = taken.Select(e => e.Candidate).ToHashSet();
        var than = chosen.Select(c => c.Entry.NettThan).ToHashSet();
        return edges.Any(e => !chosen.Contains(e.Candidate) && e.Candidate.Left == e.Candidate.Entry.NettThan && than.Contains(e.Candidate.Entry.NettThan));
    }

    /// <summary>
    /// A following finish block can abbreviate the previous priced row's lots by writing each slip's original THAN in LOT.
    /// Require an entire block of at least two rows to resolve uniquely against those named lots, not just a coincidental quantity.
    /// </summary>
    private static void QuantityLabels(List<Want> wants, List<Candidate> candidates, List<Candidate> billed)
    {
        var references = Index(candidates.Concat(billed));
        foreach (var bill in wants.Where(w => w.Line.BillGroup is not null).GroupBy(w => w.Line.BillGroup))
        {
            var rows = bill.ToList();
            for (var i = 0; i < rows.Count; i++)
            {
                var anchor = rows[i];
                if (anchor.Line.Line.Kind != LineKind.Priced || anchor.Need != 0 || anchor.Lot.Strong.Count < 2
                    || !anchor.Lot.Strong.All(lot => lot.All(char.IsAsciiDigit))
                    || !anchor.Taken.Keys.Any(c => c.Lot.Strong.SetEquals(anchor.Lot.Strong))) continue;
                var block = rows.Skip(i + 1).TakeWhile(w => w.Line.Line.Kind == LineKind.Detail).ToList();
                if (block.Count < 2 || string.IsNullOrWhiteSpace(block[0].Line.Finish)
                    || string.Equals(anchor.Line.Finish, block[0].Line.Finish, StringComparison.OrdinalIgnoreCase)) continue;
                var matches = new Dictionary<Want, Candidate>();
                foreach (var want in block)
                {
                    if (!string.Equals(want.Line.Finish, block[0].Line.Finish, StringComparison.OrdinalIgnoreCase)
                        || want.Taken.Count != 0 || !want.Gpn.IsEmpty || !want.Dn.IsEmpty || want.Lot.Strong.Count != 1) break;
                    var label = want.Lot.Strong.Single();
                    if (!string.Equals(want.Line.Line.Lot?.Trim(), label, StringComparison.Ordinal)
                        || !int.TryParse(label, out var received) || received < want.Need || received - want.Need > 5
                        || references.GetValueOrDefault(label, []).Any(c => Distance(want.Line, c) == 0)) break;
                    var options = candidates.Where(c => c.Left == received && c.Entry.NettThan == received
                        && c.Lot.Strong.Count > 0 && c.Lot.Strong.IsSubsetOf(anchor.Lot.Strong)
                        && want.Line.Own.Contains(c.Entry.Party) && c.When >= want.Line.From && c.When <= want.Line.To
                        && c.Entry.Dispatches.Sum(d => (long)d.Qty) >= c.Entry.Nag
                        && SameFinish(want.Line.Finishes, c.Entry, want.Line.Finish)).Take(2).ToList();
                    if (options.Count != 1 || matches.ContainsValue(options[0])) break;
                    matches.Add(want, options[0]);
                }
                if (matches.Count != block.Count) continue;
                foreach (var (want, candidate) in matches)
                {
                    want.QuantityLabel = candidate.Entry.Id;
                    want.Take(candidate, want.Need);
                }
            }
        }
    }

    /// <summary>A line with no number at all: the one entry of that THAN and finish sent in the bill period.</summary>
    private static void ByQuantity(List<Want> wants, List<Candidate> candidates)
    {
        foreach (var want in wants.Where(w => w.All.IsEmpty && w.Need > 0 && w.Taken.Count == 0))
        {
            var same = candidates.Where(c => c.Left == c.Entry.NettThan && c.Entry.NettThan == want.Need
                && Distance(want.Line, c) == 0 && SameFinish(want.Line.Finishes, c.Entry, want.Line.Finish)).Take(2).ToList();
            if (same.Count == 1) want.Take(same[0], want.Need);
        }
    }

    private static bool SameFinish(FinishResolver finishes, EntryDto entry, string finish) =>
        string.Equals(finishes.Resolve(entry.Finish), finish, StringComparison.OrdinalIgnoreCase)
        || string.Equals(entry.Finish, finish, StringComparison.OrdinalIgnoreCase);
}
