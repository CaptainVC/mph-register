using MPHRegister.Contracts.Entries;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Imports.Bills;

/// <summary>The lines, entries and links the matcher works with.</summary>
public static partial class BillLineMatcher
{
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
