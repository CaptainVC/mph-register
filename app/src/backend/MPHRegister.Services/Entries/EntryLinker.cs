using MPHRegister.Contracts.Entries;
using MPHRegister.Data.Database;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Services.Interfaces;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Entries;

/// <summary>
/// An all-zero slip's D.N. says which inward slip its THAN were entered under ("INW NO 547"). The slip is looked up in the
/// registers before its own month: one of the same firm or a sister firm wins (the nearest month first); one found only
/// under another party is flagged, as it is most likely a typing mistake. Nothing is stored: a corrected D.N. or entry
/// changes the link by itself.
/// </summary>
public sealed class EntryLinker(IEntryRepository entries, IMasterReader masters, IDbSession session, DataRevision revision, ZeroSlipCache cache) : IEntryLinker
{
    public IReadOnlyDictionary<long, IReadOnlyList<EntryLinkDto>> For(IReadOnlyList<EntryEntity> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);
        var none = new Dictionary<long, IReadOnlyList<EntryLinkDto>>();
        if (rows.Count == 0) return none;
        var wanted = rows.Select(r => r.Id).ToHashSet();
        var numbers = rows.Select(r => r.InwardNo).ToHashSet();
        // Only the zero slips among the rows, or naming the number of one of them, can give the rows a link.
        var zeroSlips = ZeroSlips().Where(z => wanted.Contains(z.Slip.Id) || z.Numbers.Any(numbers.Contains)).ToList();
        if (zeroSlips.Count == 0) return none;

        var candidates = entries.SlipsWithNumbers(zeroSlips.SelectMany(z => z.Numbers).ToHashSet()).ToLookup(c => c.InwardNo);
        var index = ConfigIndex.For(masters.Config);
        var links = new Dictionary<long, List<EntryLinkDto>>();
        foreach (var (slip, slipNumbers) in zeroSlips)
        {
            foreach (var number in slipNumbers)
            {
                var earlier = Resolve(slip.RegisterMonth, slip.Party, number, candidates[number], index);
                if (wanted.Contains(slip.Id)) Add(links, slip.Id, earlier);
                if (earlier.EntryId is { } target && wanted.Contains(target))
                {
                    Add(links, target, new EntryLinkDto(EntryLinkDirection.Later, earlier.State, slip.Id, slip.InwardNo, slip.RegisterMonth, slip.EntryDate, slip.Party, 0));
                }
            }
        }
        return links.ToDictionary(l => l.Key, l => (IReadOnlyList<EntryLinkDto>)l.Value);
    }

    /// <summary>Every all-zero slip whose D.N. names an inward number (a full scan), kept until the data changes.</summary>
    private IReadOnlyList<ZeroSlip> ZeroSlips()
    {
        // Inside a transaction the rows may hold changes not committed yet, so they are read afresh and not kept.
        var inTransaction = session.Transaction is not null;
        var stamp = revision.Stamp();
        if (!inTransaction && cache.Get(stamp) is { } kept) return kept;
        var found = entries.ZeroSlipsNamingInward()
            .Select(slip => new ZeroSlip(slip, InwardReference.Numbers(slip.DesignNo)))
            .Where(z => z.Numbers.Count > 0)
            .ToList();
        if (!inTransaction) cache.Set(stamp, found);
        return found;
    }

    public IReadOnlyList<EntryLinkDto> Preview(string registerMonth, string party, string? designNo)
    {
        var numbers = InwardReference.Numbers(designNo);
        if (numbers.Count == 0) return [];
        var candidates = entries.SlipsWithNumbers(numbers).ToLookup(c => c.InwardNo);
        var index = ConfigIndex.For(masters.Config);
        return numbers.Select(n => Resolve(registerMonth, party, n, candidates[n], index)).ToList();
    }

    private static EntryLinkDto Resolve(string month, string party, int number, IEnumerable<LinkSlipEntity> candidates, ConfigIndex index)
    {
        var earlier = candidates
            .Where(c => string.CompareOrdinal(c.RegisterMonth, month) < 0)
            .OrderByDescending(c => c.RegisterMonth, StringComparer.Ordinal).ThenByDescending(c => c.EntryDate, StringComparer.Ordinal).ThenByDescending(c => c.Id)
            .ToList();
        if (earlier.FirstOrDefault(c => index.SameFamily(c.Party, party)) is { } same) return To(same, EntryLinkState.Found);
        return earlier.Count > 0 ? To(earlier[0], EntryLinkState.OtherParty) : new EntryLinkDto(EntryLinkDirection.Earlier, EntryLinkState.NotFound, null, number, null, null, null, 0);
    }

    private static EntryLinkDto To(LinkSlipEntity target, string state) =>
        new(EntryLinkDirection.Earlier, state, target.Id, target.InwardNo, target.RegisterMonth, target.EntryDate, target.Party, target.Than);

    private static void Add(Dictionary<long, List<EntryLinkDto>> links, long id, EntryLinkDto link)
    {
        if (!links.TryGetValue(id, out var list)) links[id] = list = [];
        list.Add(link);
    }
}

public sealed record ZeroSlip(LinkSlipEntity Slip, IReadOnlyList<int> Numbers);

/// <summary>The last list of all-zero slips naming an inward number, with the data stamp it was read under.</summary>
public sealed class ZeroSlipCache
{
    private readonly Lock gate = new();
    private string? stamp;
    private IReadOnlyList<ZeroSlip> slips = [];

    public IReadOnlyList<ZeroSlip>? Get(string current)
    {
        lock (gate)
        {
            return current == stamp ? slips : null;
        }
    }

    public void Set(string current, IReadOnlyList<ZeroSlip> list)
    {
        lock (gate)
        {
            stamp = current;
            slips = list;
        }
    }
}
