using MPHRegister.Contracts.Billing;
using MPHRegister.Contracts.Entries;
using MPHRegister.Services.Billing;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Imports.Bills;

/// <param name="Key">The caller's id for the line.</param>
/// <param name="Finish">The finish the line is billed as (a detail row takes the finish of the priced row below it).</param>
/// <param name="From">First day of the bill period.</param>
/// <param name="To">Last day of the bill period.</param>
/// <param name="Own">Parties whose entries this bill carries; entries of other parties in the pool (sister firms) cost more.</param>
/// <param name="Finishes">The bill party's finish names, to compare a line without numbers with an entry's finish.</param>
/// <param name="BillGroup">The bill containing this row, for rules that need evidence from nearby rows of the same bill.</param>
public sealed record MatchLine(int Key, LineDto Line, string Finish, DateOnly From, DateOnly To, IReadOnlySet<string> Own, FinishResolver Finishes, int? BillGroup = null);

/// <param name="Links">Line key → the entries found for it, in register order.</param>
/// <param name="Missing">Line key → THAN on the line that no entry was found for (only lines short of THAN).</param>
/// <param name="Used">Entry id → THAN of the entry found on the lines.</param>
/// <param name="Slips">Line key → numbers on the line read as typing slips ("344 as 354"), for lines linked that way.</param>
/// <param name="Plain">Line key → entries with no design or lot taken on the line because their THAN fill it exactly.</param>
/// <param name="QuantityLabels">Line key → inward slip whose received THAN was written in the LOT column.</param>
public sealed record MatchResult(IReadOnlyDictionary<int, IReadOnlyList<long>> Links, IReadOnlyDictionary<int, int> Missing, IReadOnlyDictionary<long, int> Used,
    IReadOnlyDictionary<int, IReadOnlyList<string>> Slips, IReadOnlyDictionary<int, IReadOnlyList<long>> Plain, IReadOnlyDictionary<int, long> QuantityLabels);

public enum MatchMode
{
    /// <summary>Every level of evidence, and lines without any number matched by THAN and finish alone.</summary>
    Full,

    /// <summary>Only lines whose own numbers (gate pass, design or lot) match; used to look for suggestions and conflicts.</summary>
    NumbersOnly,
}

/// <summary>
/// Finds the inward entries the lines of Excel bills were made from. All lines of a party's bills are matched together,
/// as THAN flowing from entries to lines: a line may take several entries (all six designs of one gate pass), an entry may
/// be split over several lines (its lots billed one by one), and lots may be mixed both ways. The strongest evidence is
/// used first — the line's gate pass and design or lot both match — then any of its own numbers, then numbers written in
/// another column. Among equal evidence the entry sent nearest to the bill period wins, so a gate-pass book that started
/// again from 1 does not link October lines to April entries. A line with numbers is never linked on THAN alone.
/// A line that lists several numbers gets an entry of each where one is free (rows combined on the bill). Then a number that
/// no entry near the bill has, but that is one digit off (or two digits swapped) from an unbilled entry, is read as a typing
/// slip — only when the THAN then agree exactly (the lines' missing THAN are the entries' whole THAN); on a line clearly short,
/// so is a number billed as written already (a second row combined into it under one number). Last, entries with no design
/// or lot fill lines short by exactly their THAN.
/// </summary>
public static class BillLineMatcher
{
    private const int DaysBeforePeriod = 100;
    private const int DaysEntryAfterPeriod = 7;
    private const int DaysSentAfterPeriod = 15;
    private const int CrossTokenLength = 3;
    private const int MaxLabelLength = 3;
    private const int DaysBilledBeforePeriod = 31;
    private const int DaysJoinedBeforePeriod = 15;
    private const int MaxCoverRounds = 10;

    /// <summary>A few THAN either way is usual (a piece returned, a TP billed); more is worth a look.</summary>
    public static int Tolerance(int than) => Math.Max(2, than / 20);

    /// <summary>The lines of a bill that bill inward entries: not blank, not the Excel =SUM row, and not the repair memo rows below the last priced row.</summary>
    public static IEnumerable<(int Index, string Finish)> Billable(IReadOnlyList<LineDto> lines)
    {
        ArgumentNullException.ThrowIfNull(lines);
        return BillableLines(lines);
    }

    private static IEnumerable<(int Index, string Finish)> BillableLines(IReadOnlyList<LineDto> lines)
    {
        var lastPriced = -1;
        for (var i = 0; i < lines.Count; i++)
        {
            if (lines[i].Kind == LineKind.Priced) lastPriced = i;
        }
        for (var i = 0; i < lines.Count; i++)
        {
            var line = lines[i];
            if (line.Kind == LineKind.Blank || line.AutoSum || (line.Qty ?? 0) <= 0) continue;
            if (line.Kind == LineKind.Detail && i > lastPriced) continue;
            yield return (i, line.Kind == LineKind.Priced ? line.Finish ?? string.Empty : NextFinish(lines, i));
        }
    }

    public static MatchResult Match(IReadOnlyList<MatchLine> lines, IReadOnlyList<EntryDto> pool, MatchMode mode) => Match(lines, pool, mode, []);

    /// <param name="register">Entries that are billed already: not linked, but their numbers are not typing slips.</param>
    public static MatchResult Match(IReadOnlyList<MatchLine> lines, IReadOnlyList<EntryDto> pool, MatchMode mode, IReadOnlyList<EntryDto> register)
    {
        ArgumentNullException.ThrowIfNull(lines);
        ArgumentNullException.ThrowIfNull(pool);
        ArgumentNullException.ThrowIfNull(register);
        var wants = lines.Select(l => new Want(l)).ToList();
        var candidates = pool.Where(e => e.NettThan > 0).Select((e, i) => new Candidate(e, i)).ToList();
        var edges = Edges(wants, candidates);
        var lastTier = mode == MatchMode.Full ? Tier.Crossed : Tier.Own;
        void FlowTiers()
        {
            for (var tier = Tier.Strong; tier <= lastTier; tier++) Flow(edges.Where(e => e.Tier == tier).ToList());
        }
        FlowTiers();
        if (DropFragments(wants)) FlowTiers();
        var numbered = edges.Where(e => e.Tier <= lastTier).ToList();
        for (var round = 0; round < MaxCoverRounds && CoverEveryNumber(numbered); round++) FlowTiers();
        if (mode == MatchMode.Full)
        {
            var billed = register.Where(e => e.NettThan > 0).Select((e, i) => new Candidate(e, candidates.Count + i)).ToList();
            TypingSlips(wants, candidates, billed);
            QuantityLabels(wants, candidates, billed);
            Unnumbered(wants, candidates);
            ByQuantity(wants, candidates);
        }
        return Result(wants);
    }

    private static string NextFinish(IReadOnlyList<LineDto> lines, int index)
    {
        for (var i = index + 1; i < lines.Count; i++)
        {
            if (lines[i].Kind == LineKind.Priced) return lines[i].Finish ?? string.Empty;
        }
        return string.Empty;
    }

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

    private static MatchResult Result(List<Want> wants)
    {
        var links = new Dictionary<int, IReadOnlyList<long>>();
        var missing = new Dictionary<int, int>();
        var used = new Dictionary<long, int>();
        var slips = new Dictionary<int, IReadOnlyList<string>>();
        foreach (var want in wants)
        {
            if (want.Slips.Count > 0 && want.Taken.Count > 0)
            {
                slips[want.Line.Key] = want.Slips.GroupBy(s => (s.Written, s.Joined))
                    .Select(g => $"{g.Key.Written} {(g.Key.Joined ? "also " : string.Empty)}as {string.Join("/", g.Select(s => s.Read).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal))}"
                        + (g.Key.Joined ? " (rows combined)" : string.Empty)).ToList();
            }
            if (want.Taken.Count > 0) links[want.Line.Key] = want.Taken.Keys.OrderBy(c => c.Order).Select(c => c.Entry.Id).ToList();
            if (want.Need > 0) missing[want.Line.Key] = want.Need;
            foreach (var (candidate, qty) in want.Taken) used[candidate.Entry.Id] = used.GetValueOrDefault(candidate.Entry.Id) + qty;
        }
        var plain = wants.Where(w => w.Plain.Count > 0).ToDictionary(w => w.Line.Key, w => (IReadOnlyList<long>)w.Plain.OrderBy(c => c.Order).Select(c => c.Entry.Id).ToList());
        var quantityLabels = wants.Where(w => w.QuantityLabel.HasValue).ToDictionary(w => w.Line.Key, w => w.QuantityLabel!.Value);
        return new MatchResult(links, missing, used, slips, plain, quantityLabels);
    }

    private enum Tier
    {
        Strong = 1,
        Own = 2,
        Crossed = 3,
        Slip = 4,
        None = 9,
    }

    private sealed class Want(MatchLine line)
    {
        public MatchLine Line { get; } = line;

        public RefTokens Gpn { get; } = RefTokens.Parse(line.Line.Gpn);

        public RefTokens Dn { get; } = RefTokens.Parse(line.Line.Dn);

        public RefTokens Lot { get; } = RefTokens.Parse(line.Line.Lot);

        public RefTokens All => field ??= RefTokens.Union([Gpn, Dn, Lot]);

        public int Need { get; private set; } = line.Line.Qty ?? 0;

        public Dictionary<Candidate, int> Taken { get; } = [];

        public List<Slip> Slips { get; } = [];

        public List<Candidate> Plain { get; } = [];

        public long? QuantityLabel { get; set; }

        public void Take(Candidate candidate, int qty)
        {
            Taken[candidate] = Taken.GetValueOrDefault(candidate) + qty;
            Need -= qty;
            candidate.Left -= qty;
        }

        public void GiveBack(Candidate candidate) => GiveBack(candidate, 0);

        /// <summary>Gives back what was taken from the entry beyond <paramref name="keep"/> THAN.</summary>
        public void GiveBack(Candidate candidate, int keep)
        {
            var qty = Taken.GetValueOrDefault(candidate) - keep;
            if (qty <= 0) return;
            if (keep == 0) Taken.Remove(candidate);
            else Taken[candidate] = keep;
            Need += qty;
            candidate.Left += qty;
        }
    }

    private sealed class Candidate(EntryDto entry, int order)
    {
        public EntryDto Entry { get; } = entry;

        public int Order { get; } = order;

        public RefTokens Gate { get; } = RefTokens.Union(entry.Dispatches.Select(d => RefTokens.Parse(d.GatePass)));

        public RefTokens Design { get; } = RefTokens.Parse(entry.DesignNo);

        public RefTokens Lot { get; } = RefTokens.Parse(entry.LotNo);

        public RefTokens Numbers => field ??= RefTokens.Union([Design, Lot]);

        /// <summary>A design or lot that is only a short letter label, like A, B or O.</summary>
        public IReadOnlySet<string> Labels => field ??= new[] { Entry.DesignNo, Entry.LotNo }
            .Select(t => (t ?? string.Empty).Trim().ToUpperInvariant())
            .Where(t => t.Length is > 0 and <= MaxLabelLength && t.All(char.IsAsciiLetterUpper))
            .ToHashSet(StringComparer.Ordinal);

        public RefTokens All => field ??= RefTokens.Union([Gate, Design, Lot]);

        public DateOnly Date { get; } = Dates.ParseIsoOrDefault(entry.EntryDate);

        /// <summary>The last dispatch date, or the inward date when nothing was sent or the dispatch is dated before it.</summary>
        public DateOnly When { get; } = Later(entry.Dispatches.Select(d => Dates.ParseIsoOrDefault(d.Date)).DefaultIfEmpty().Max(), Dates.ParseIsoOrDefault(entry.EntryDate));

        public int Left { get; set; } = entry.NettThan;

        private static DateOnly Later(DateOnly a, DateOnly b) => a > b ? a : b;
    }

    private sealed record Edge(Want Want, Candidate Candidate, Tier Tier, long Cost);

    /// <param name="Joined">The number as written is billed on the line too, or on other lines (two rows combined into one).</param>
    private sealed record Slip(string Written, string Read, bool Joined);
}
