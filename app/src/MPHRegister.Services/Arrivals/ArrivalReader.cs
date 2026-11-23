using System.Globalization;
using MPHRegister.Contracts.Arrivals;
using MPHRegister.Data.Config;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Arrivals;

/// <summary>Arrivals as the screens show them: their slips, the NAG check, status and warnings.</summary>
public sealed class ArrivalReader(IArrivalRepository arrivals, IConfigStore config)
{
    private const int NearbyDays = 3;

    public IReadOnlyList<ArrivalDto> Read(IReadOnlyList<ArrivalEntity> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);
        if (rows.Count == 0) return [];
        var ids = rows.Select(r => r.Id).ToList();
        var refs = arrivals.Refs(ids);
        var links = arrivals.Links(ids).ToLookup(l => l.ArrivalId);
        var slips = arrivals.SlipsByIds(links.SelectMany(g => g).Select(l => l.EntryId).Distinct().ToList())
            .GroupBy(s => s.Id).ToDictionary(g => g.Key, g => g.OrderBy(s => s.Deleted).First());
        var marks = arrivals.LatestMarks();
        var index = ConfigIndex.For(config.Current);
        var elsewhere = Elsewhere(rows, refs, links, slips);
        return rows.Select(r => ToDto(r, refs.GetValueOrDefault(r.Id) ?? [], links[r.Id], slips, marks.GetValueOrDefault(r.Id), index, elsewhere)).ToList();
    }

    public ArrivalDto? Read(ArrivalEntity? row) => row is null ? null : Read([row])[0];

    /// <summary>Slips with a named number that were not linked (another firm's, or more than one could be it), near the arrival's date.</summary>
    private List<SlipEntity> Elsewhere(IReadOnlyList<ArrivalEntity> rows, IReadOnlyDictionary<long, IReadOnlyList<int>> refs, ILookup<long, ArrivalLinkEntity> links, Dictionary<long, SlipEntity> slips)
    {
        var unlinked = rows.SelectMany(r => (refs.GetValueOrDefault(r.Id) ?? []).Where(n => !links[r.Id].Any(l => slips.TryGetValue(l.EntryId, out var s) && s.InwardNo == n))).Distinct().ToList();
        if (unlinked.Count == 0) return [];
        var dates = rows.Select(r => Dates.ParseIsoOrDefault(r.ArrivalDate)).ToList();
        var window = Math.Max(config.Current.Aawak.LinkWindowDays, NearbyDays);
        return arrivals.Slips(unlinked, Dates.Iso(dates.Min().AddDays(-window)), Dates.Iso(dates.Max().AddDays(window))).ToList();
    }

    public static ArrivalLinkSummary Summary(IEnumerable<ArrivalDto> list)
    {
        ArgumentNullException.ThrowIfNull(list);
        var counts = list.GroupBy(a => a.Status).ToDictionary(g => g.Key, g => g.Count());
        return new ArrivalLinkSummary(counts.GetValueOrDefault(ArrivalStatus.Linked), counts.GetValueOrDefault(ArrivalStatus.NagDiffers),
            counts.GetValueOrDefault(ArrivalStatus.PartlyLinked), counts.GetValueOrDefault(ArrivalStatus.NotLinked));
    }

    public static ArrivalSlipDto Slip(SlipEntity slip, int? share, bool manual, string party, ConfigIndex index)
    {
        ArgumentNullException.ThrowIfNull(slip);
        ArgumentNullException.ThrowIfNull(index);
        var sister = !string.Equals(slip.Party, party, StringComparison.OrdinalIgnoreCase) && index.SameFamily(slip.Party, party);
        return new ArrivalSlipDto(slip.Id, slip.RegisterMonth, slip.InwardNo, slip.EntryDate, slip.Party, share ?? slip.Nag, slip.Nag, share, manual, slip.Deleted, sister);
    }

    /// <summary>The status of an arrival from what was found for it.</summary>
    public static string Status(int nag, int slipsNag, int found, int missing)
    {
        if (found == 0) return ArrivalStatus.NotLinked;
        if (missing > 0) return ArrivalStatus.PartlyLinked;
        return slipsNag == nag ? ArrivalStatus.Linked : ArrivalStatus.NagDiffers;
    }

    private ArrivalDto ToDto(ArrivalEntity row, IReadOnlyList<int> refs, IEnumerable<ArrivalLinkEntity> links, Dictionary<long, SlipEntity> slips,
        ArrivalImportMarkEntity? mark, ConfigIndex index, List<SlipEntity> elsewhere)
    {
        var shown = links.Where(l => slips.ContainsKey(l.EntryId))
            .Select(l => Slip(slips[l.EntryId], l.Nag, l.How == ArrivalLinkHow.Manual, row.Party, index))
            .OrderBy(s => s.InwardNo).ThenBy(s => s.EntryId).ToList();
        var live = shown.Where(s => !s.Deleted).ToList();
        var missing = refs.Where(n => !live.Any(s => s.InwardNo == n)).ToList();
        var slipsNag = live.Sum(s => s.Nag);
        var status = Status(row.Nag, slipsNag, live.Count, missing.Count);

        var warnings = new List<string>();
        if (status == ArrivalStatus.NagDiffers) warnings.Add(string.Create(CultureInfo.InvariantCulture, $"NAG is {row.Nag} but the slips have {slipsNag}."));
        var day0 = Dates.ParseIsoOrDefault(row.ArrivalDate);
        var window = Math.Max(config.Current.Aawak.LinkWindowDays, NearbyDays);
        var others = elsewhere.Where(s => missing.Contains(s.InwardNo) && Math.Abs(Dates.ParseIsoOrDefault(s.EntryDate).DayNumber - day0.DayNumber) <= window).ToList();
        var notEntered = missing.Where(n => !others.Any(s => s.InwardNo == n)).ToList();
        if (notEntered.Count > 0)
            warnings.Add($"INW NO {InwardNumbers.Format(notEntered)} {(notEntered.Count == 1 ? "is" : "are")} not in the inward register yet.");
        foreach (var number in others.GroupBy(s => s.InwardNo))
        {
            var firms = string.Join(" / ", number.Select(s => s.Party).Distinct(StringComparer.OrdinalIgnoreCase));
            warnings.Add(number.Count() == 1 && !index.SameFamily(number.First().Party, row.Party)
                ? string.Create(CultureInfo.InvariantCulture, $"INW NO {number.Key} is under {firms}, not this party or a sister firm. Open the row to link it by hand, or make the firms sister firms in Masters.")
                : string.Create(CultureInfo.InvariantCulture, $"INW NO {number.Key} could be more than one slip ({firms}). Open the row to link the right one."));
        }
        foreach (var gone in shown.Where(s => s.Deleted))
            warnings.Add(string.Create(CultureInfo.InvariantCulture, $"INW NO {gone.InwardNo} was deleted in the app."));
        foreach (var other in live.Where(s => !index.SameFamily(s.Party, row.Party)))
            warnings.Add(string.Create(CultureInfo.InvariantCulture, $"INW NO {other.InwardNo} is of {other.Party}, not of this party or its sister firms."));
        foreach (var far in live.Where(s => Math.Abs(Dates.ParseIsoOrDefault(s.EntryDate).DayNumber - day0.DayNumber) > 1))
            warnings.Add(string.Create(CultureInfo.InvariantCulture, $"INW NO {far.InwardNo} is dated {far.EntryDate}."));
        if (Dates.TryParseIso(row.ArrivalDate, out var date) && Dates.Month(date) != row.AawakMonth)
            warnings.Add("The date is not in the AAWAK month.");
        if (index.Transporter(row.Transporter) is { Active: false }) warnings.Add($"Lorry wala {row.Transporter} is inactive.");

        return new ArrivalDto(row.Id, row.AawakMonth, row.AawakNo, row.AawakSuffix, AawakNumber.Format(row.AawakNo, row.AawakSuffix), row.ArrivalDate,
            row.Party, index.GroupOf(row.Party), row.Nag, row.Transporter, row.InwardText, row.Note, refs, shown, missing, slipsNag, status, warnings,
            row.ImportBatchId is not null,
            mark is null ? null : new ArrivalImportMarkDto(mark.Action, mark.FileName, mark.ImportedAt, mark.Changes));
    }
}
