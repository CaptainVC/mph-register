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
public static partial class BillLineMatcher
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
}
