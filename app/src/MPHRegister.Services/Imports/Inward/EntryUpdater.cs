using System.Globalization;
using MPHRegister.Data.Entities;

namespace MPHRegister.Services.Imports.Inward;

public sealed record EntryUpdate(EntryEntity Entry, List<DispatchEntity> Dispatches, bool FieldsChanged, bool DispatchesChanged, List<string> Changes, List<string> Kept)
{
    public bool Changed => FieldsChanged || DispatchesChanged;
}

/// <summary>
/// Updates a saved entry from its row in a newer copy of the same month's workbook. <c>last</c> is the row as the workbook
/// had it at the last import: a value the workbook changed since then is taken, a value only the app changed (an edit in
/// the Register, a later month's carryover row) is kept. Without <c>last</c> nobody knows which side changed a value, so
/// blanks are filled in and later dispatches added, and every other difference is kept as in the app and listed.
/// Dispatches the app has after the workbook's (a later month's carryover row added them) are never dropped for an
/// entry whose dispatches at the last import are unknown, and a name the party or finish list does not know never
/// replaces the app's.
/// </summary>
public static class EntryUpdater
{
    public static EntryUpdate Update(
        EntryEntity stored, IReadOnlyList<DispatchEntity> storedDispatches, InwardRow row, SourceValues? last,
        bool lastHasDispatches = true, bool newParty = false, bool newFinish = false)
    {
        ArgumentNullException.ThrowIfNull(stored);
        ArgumentNullException.ThrowIfNull(storedDispatches);
        ArgumentNullException.ThrowIfNull(row);
        var changes = new List<string>();
        var kept = new List<string>();

        T Pick<T>(string label, T ours, T theirs, Func<SourceValues, T> was, Func<T, T, bool> same, Func<T, string> show, bool oursBlank = false, bool unknownName = false)
        {
            if (same(ours, theirs)) return ours;
            if (last is not null && same(theirs, was(last))) return ours;
            if (oursBlank || (!unknownName && last is not null && same(ours, was(last))))
            {
                changes.Add(oursBlank ? $"{label} filled in ({show(theirs)})" : $"{label} {show(ours)} → {show(theirs)}");
                return theirs;
            }
            kept.Add($"{label} {show(ours)} (workbook: {show(theirs)})");
            return ours;
        }

        var entry = stored with
        {
            InwardNo = Pick("INW. NO.", stored.InwardNo, row.InwardNo, s => s.InwardNo, SameNumber, Number),
            EntryDate = Pick("DATE", stored.EntryDate, row.Date, s => s.Date, string.Equals, Text),
            Party = Pick("PARTY", stored.Party, row.Party, s => s.Party, SameText, Text, unknownName: newParty),
            DesignNo = Pick("D.N.", stored.DesignNo, row.Design, s => s.Design, SameText, Text, stored.DesignNo.Length == 0),
            LotNo = Pick("LOT N.", stored.LotNo, row.Lot, s => s.Lot, SameText, Text, stored.LotNo.Length == 0),
            Repair = Pick("REP.", stored.Repair, row.Repair, s => s.Repair, (a, b) => a == b, r => r ? "YES" : "NO"),
            Than = Pick("THAN", stored.Than, row.Than, s => s.Than, SameNumber, Number),
            Tp = Pick("TP", stored.Tp, row.Tp, s => s.Tp, SameNumber, Number),
            TwoPart = Pick("TWO PART", stored.TwoPart, row.TwoPart, s => s.TwoPart, SameNumber, Number),
            Finish = Pick("FINISH", stored.Finish, row.Finish, s => s.Finish, SameText, Text, stored.Finish.Length == 0, newFinish),
            ShortThan = Pick("SHORT THAN", stored.ShortThan, row.ShortThan, s => s.ShortThan, (a, b) => a == b, n => n is { } v ? Number(v) : "blank", stored.ShortThan is null),
        };
        var fieldsChanged = changes.Count > 0;

        var ours = storedDispatches.ToList();
        var theirs = row.Dispatches.Select(d => ToEntity(stored.Id, d)).ToList();
        var lastDispatches = last is not null && lastHasDispatches ? last.Dispatches.Select(d => ToEntity(stored.Id, d)).ToList() : null;
        var (dispatches, dispatchesChanged) = PickDispatches(ours, theirs, lastDispatches, changes, kept);
        return new EntryUpdate(entry, dispatches, fieldsChanged, dispatchesChanged, changes, kept);
    }

    private static (List<DispatchEntity> Dispatches, bool Changed) PickDispatches(
        List<DispatchEntity> ours, List<DispatchEntity> theirs, List<DispatchEntity>? was, List<string> changes, List<string> kept)
    {
        if (Same(ours, theirs)) return (ours, false);
        if (was is not null)
        {
            if (Same(theirs, was)) return (ours, false);
            if (Same(ours, was))
            {
                changes.Add(CarryoverMerger.StartsWith(theirs, ours)
                    ? $"{theirs.Count - ours.Count} later dispatch(es) added"
                    : $"dispatches {Describe(ours)} → {Describe(theirs)}");
                return (theirs, true);
            }
            // Both sides only added dispatches after the last import's: keep the app's and add the workbook's new ones.
            if (CarryoverMerger.StartsWith(theirs, was) && CarryoverMerger.StartsWith(ours, was))
            {
                var added = theirs.Skip(was.Count).Where(d => !ours.Any(o => CarryoverMerger.SameDispatch(o, d))).ToList();
                if (added.Count == 0) return (ours, false);
                changes.Add($"{added.Count} later dispatch(es) added");
                return ([.. ours, .. added], true);
            }
        }
        else if (CarryoverMerger.StartsWith(theirs, ours))
        {
            changes.Add($"{theirs.Count - ours.Count} later dispatch(es) added");
            return (theirs, true);
        }
        else if (CarryoverMerger.StartsWith(ours, theirs))
        {
            return (ours, false);
        }
        kept.Add($"dispatches {Describe(ours)} (workbook: {Describe(theirs)})");
        return (ours, false);
    }

    private static bool Same(List<DispatchEntity> a, List<DispatchEntity> b) => a.Count == b.Count && CarryoverMerger.StartsWith(a, b);

    private static bool SameNumber(int a, int b) => a == b;

    private static bool SameText(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

    private static string Number(int value) => value.ToString(CultureInfo.InvariantCulture);

    private static string Text(string value) => value.Length == 0 ? "blank" : value;

    private static string Describe(List<DispatchEntity> dispatches) => dispatches.Count == 0
        ? "none"
        : string.Join(", ", dispatches.Select(d =>
            $"{d.Qty} (gate pass {(d.GatePass.Length == 0 ? "blank" : d.GatePass)}, {d.DispatchDate ?? d.DateText ?? "no date"})"));

    private static DispatchEntity ToEntity(long entryId, InwardDispatch d) =>
        new() { EntryId = entryId, Qty = d.Qty, GatePass = d.GatePass, DispatchDate = d.Date, DateText = d.DateText };
}
