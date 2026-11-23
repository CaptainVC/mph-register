using MPHRegister.Contracts.Entries;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Services.Interfaces;
using MPHRegister.Services.Mapping;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Entries;

public sealed class EntryReader(IEntryRepository entries, IImportLogRepository imports, IMasterReader masters, IArrivalRepository arrivals, IEntryLinker linker) : IEntryReader
{
    public IReadOnlyList<EntryDto> Read(IReadOnlyList<EntryEntity> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);
        if (rows.Count == 0) return [];
        var dispatches = entries.Dispatches(rows.Select(r => r.Id).ToHashSet());
        var duplicates = entries.DuplicateInwardNumbers();
        var index = ConfigIndex.For(masters.Config);
        var marks = imports.LatestImportMarks();
        var aawak = arrivals.EntryArrivals().ToLookup(a => a.EntryId);
        var notNeeded = arrivals.NoArrival();
        var checkFrom = masters.Config.Aawak.CheckSlipsFrom ?? arrivals.EarliestDate();
        var links = linker.For(rows.Select(r => r.Id).ToHashSet());
        return rows.Select(r =>
            {
                var sent = dispatches.TryGetValue(r.Id, out var d) ? d : [];
                var came = aawak[r.Id].Select(a => new EntryArrivalDto(a.ArrivalId, a.AawakMonth, AawakNumber.Format(a.AawakNo, a.AawakSuffix), a.ArrivalDate, a.Transporter, a.Nag)).ToList();
                var dto = EntryMapper.ToDto(r, sent, duplicates.Contains((r.RegisterMonth, r.InwardNo)), index.Party(r.Party)?.NoBillNeeded ?? false,
                    marks.GetValueOrDefault(r.Id), came, AawakState(r, sent.Count, came.Count, notNeeded.ContainsKey(r.Id), checkFrom));
                return links.TryGetValue(r.Id, out var linked) ? dto with { Links = linked } : dto;
            })
            .ToList();
    }

    /// <summary>
    /// "No Aawak found" is only said of slips that should have one: not carryovers or all-zero slips, and dated on or after the
    /// day Aawak rows are kept from (the first Aawak row, unless the config file says otherwise).
    /// </summary>
    private static string AawakState(EntryEntity row, int dispatches, int found, bool notNeeded, string? checkFrom)
    {
        if (found > 0) return EntryAawakState.Found;
        if (notNeeded) return EntryAawakState.NotNeeded;
        if (checkFrom is null || row.CarriedOver || AllZeroSlip.Is(row.Than, row.Tp, row.TwoPart, dispatches)) return EntryAawakState.NotChecked;
        return string.CompareOrdinal(row.EntryDate, checkFrom) >= 0 ? EntryAawakState.None : EntryAawakState.NotChecked;
    }
}
