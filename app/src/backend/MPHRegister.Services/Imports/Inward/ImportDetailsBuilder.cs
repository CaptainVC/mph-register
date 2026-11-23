using System.Globalization;
using System.Text.Json;
using MPHRegister.Contracts.Entries;
using MPHRegister.Data.Entities;
using MPHRegister.Shared.Json;

namespace MPHRegister.Services.Imports.Inward;

/// <summary>
/// What an import changed in one entry, found by comparing the entry as it was with the entry as the import saves it, so it
/// is exactly what changed whichever rule of the import decided it. Stored with the import (as JSON) for the entry's
/// import history.
/// </summary>
public static class ImportDetailsBuilder
{
    public static ImportChangeDetails Between(
        EntryEntity before, IReadOnlyList<DispatchEntity> beforeDispatches, EntryEntity after, IReadOnlyList<DispatchEntity> afterDispatches)
    {
        ArgumentNullException.ThrowIfNull(before);
        ArgumentNullException.ThrowIfNull(beforeDispatches);
        ArgumentNullException.ThrowIfNull(after);
        ArgumentNullException.ThrowIfNull(afterDispatches);
        var fields = new List<ImportFieldChange>();
        Compare(fields, "REGISTER MONTH", before.RegisterMonth, after.RegisterMonth);
        Compare(fields, "INW. NO.", Number(before.InwardNo), Number(after.InwardNo));
        Compare(fields, "DATE", before.EntryDate, after.EntryDate);
        Compare(fields, "PARTY", before.Party, after.Party);
        Compare(fields, "D.N.", before.DesignNo, after.DesignNo);
        Compare(fields, "LOT N.", before.LotNo, after.LotNo);
        Compare(fields, "REP.", Yes(before.Repair), Yes(after.Repair));
        Compare(fields, "THAN", Number(before.Than), Number(after.Than));
        Compare(fields, "TP", Number(before.Tp), Number(after.Tp));
        Compare(fields, "FINISH", before.Finish, after.Finish);
        Compare(fields, "TWO PART", Number(before.TwoPart), Number(after.TwoPart));
        Compare(fields, "SHORT THAN", before.ShortThan is { } was ? Number(was) : string.Empty, after.ShortThan is { } now ? Number(now) : string.Empty);

        var dispatches = new List<ImportDispatchChange>();
        for (var i = 0; i < Math.Max(beforeDispatches.Count, afterDispatches.Count); i++)
        {
            var was2 = i < beforeDispatches.Count ? beforeDispatches[i] : null;
            var now2 = i < afterDispatches.Count ? afterDispatches[i] : null;
            if (was2 is not null && now2 is not null && CarryoverMerger.SameDispatch(was2, now2)) continue;
            dispatches.Add(new ImportDispatchChange(i + 1, Dto(was2), Dto(now2)));
        }

        var effects = new List<ImportFieldChange>();
        var (nagWas, nettWas, balanceWas) = Figures(before, beforeDispatches);
        var (nagNow, nettNow, balanceNow) = Figures(after, afterDispatches);
        Compare(effects, "NAG", Number(nagWas), Number(nagNow));
        Compare(effects, "NETT THAN", Number(nettWas), Number(nettNow));
        Compare(effects, "BALANCE", Number(balanceWas), Number(balanceNow));
        return new ImportChangeDetails(fields, dispatches, effects);
    }

    /// <summary>
    /// Two carryover rows of one earlier slip change the same entry in one import: what it was before the first and what it
    /// is after the last, with what changed back left out.
    /// </summary>
    public static ImportChangeDetails Merge(ImportChangeDetails first, ImportChangeDetails second)
    {
        ArgumentNullException.ThrowIfNull(first);
        ArgumentNullException.ThrowIfNull(second);
        var dispatches = first.Dispatches.Concat(second.Dispatches).GroupBy(d => d.Number)
            .Select(g => new ImportDispatchChange(g.Key, g.First().Was, g.Last().Now))
            .Where(d => d.Was is null || d.Now is null || !CarryoverMerger.SameDispatch(ToEntity(d.Was), ToEntity(d.Now)))
            .OrderBy(d => d.Number).ToList();
        return new ImportChangeDetails(Join(first.Fields, second.Fields), dispatches, Join(first.Effects, second.Effects));
    }

    public static string ToJson(ImportChangeDetails details) => JsonSerializer.Serialize(details, JsonDefaults.Options);

    /// <summary>The stored details, or null when there are none (an import from before they were kept) or they cannot be read.</summary>
    public static ImportChangeDetails? FromJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var details = JsonSerializer.Deserialize<ImportChangeDetails>(json, JsonDefaults.Options);
            return details is null ? null : new ImportChangeDetails(details.Fields ?? [], details.Dispatches ?? [], details.Effects ?? []);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static List<ImportFieldChange> Join(IReadOnlyList<ImportFieldChange> first, IReadOnlyList<ImportFieldChange> second) =>
        first.Concat(second).GroupBy(f => f.Field).Select(g => new ImportFieldChange(g.Key, g.First().Was, g.Last().Now))
            .Where(f => !string.Equals(f.Was, f.Now, StringComparison.Ordinal)).ToList();

    private static void Compare(List<ImportFieldChange> into, string field, string was, string now)
    {
        if (!string.Equals(was, now, StringComparison.Ordinal)) into.Add(new ImportFieldChange(field, was, now));
    }

    private static (int Nag, int Nett, int Balance) Figures(EntryEntity entry, IReadOnlyList<DispatchEntity> dispatches)
    {
        var nag = entry.Than + entry.Tp;
        return (nag, entry.Repair ? 0 : entry.Than, nag + entry.TwoPart - dispatches.Sum(d => d.Qty));
    }

    private static string Number(int value) => value.ToString(CultureInfo.InvariantCulture);

    private static string Yes(bool value) => value ? "Yes" : "No";

    private static DispatchDto? Dto(DispatchEntity? d) => d is null ? null : new DispatchDto(d.Qty, d.GatePass, d.DispatchDate, d.DateText);

    private static DispatchEntity ToEntity(DispatchDto d) => new() { Qty = d.Qty, GatePass = d.GatePass, DispatchDate = d.Date, DateText = d.DateText };
}
