using MPHRegister.Data.Entities;

namespace MPHRegister.Services.Imports.Inward;

public enum RowAction
{
    Insert,
    MergeIntoEarlier,
    AdoptLaterCarryover,
    UpdateSaved,

    /// <summary>The row of an entry deleted in the app: it stays deleted (nothing is saved for the row).</summary>
    KeepDeleted,
}

/// <summary>What importing does with one workbook row; <c>Changes</c> says what it changes in a saved entry.</summary>
public sealed record RowPlan(InwardRow Row, RowAction Action, EntryEntity Entry, IReadOnlyList<DispatchEntity> Dispatches, bool Changed, bool DispatchesChanged = true)
{
    public IReadOnlyList<string> Changes { get; init; } = [];

    /// <summary>The saved entry (and its dispatches) as it was before an update; what the import changed is the difference.</summary>
    public EntryEntity? Before { get; init; }

    public IReadOnlyList<DispatchEntity> BeforeDispatches { get; init; } = [];
}

/// <summary>
/// A carryover row repeats an earlier month's inward slip (same party, INW. NO. and date) with its later dispatches.
/// The registers fill in blanks (usually FINISH), correct typos (LOT 8585 → 28585) and add dispatches; they never drop one.
/// </summary>
public static class CarryoverMerger
{
    public static (EntryEntity Entry, List<DispatchEntity> Dispatches, List<string> Changes) Merge(
        EntryEntity stored, IReadOnlyList<DispatchEntity> storedDispatches, InwardRow row)
    {
        ArgumentNullException.ThrowIfNull(stored);
        ArgumentNullException.ThrowIfNull(storedDispatches);
        ArgumentNullException.ThrowIfNull(row);
        var changes = new List<string>();
        string Text(string label, string current, string incoming)
        {
            if (incoming.Length == 0 || string.Equals(current, incoming, StringComparison.OrdinalIgnoreCase)) return current;
            changes.Add(current.Length == 0 ? $"{label} filled in ({incoming})" : $"{label} {current} → {incoming}");
            return incoming;
        }
        int Number(string label, int current, int incoming)
        {
            if (current == incoming) return current;
            changes.Add($"{label} {current} → {incoming}");
            return incoming;
        }

        var entry = stored with
        {
            Finish = Text("FINISH", stored.Finish, row.Finish),
            LotNo = Text("LOT N.", stored.LotNo, row.Lot),
            DesignNo = Text("D.N.", stored.DesignNo, row.Design),
            Than = Number("THAN", stored.Than, row.Than),
            Tp = Number("TP", stored.Tp, row.Tp),
            TwoPart = Number("TWO PART", stored.TwoPart, row.TwoPart),
            // Only a REP. Yes written in the row turns it on: the saved entry's REP. No beside an R is the user's choice or a bill's.
            Repair = stored.Repair || (row.Repair && !row.RepairFromMark),
            ShortThan = row.ShortThan ?? stored.ShortThan,
            // A carryover row repeats the slip: its NETT THAN is the formula's unless someone typed over it there too.
            NettLess = row.NettLess != 0 ? row.NettLess : stored.NettLess,
        };
        if (entry.NettLess != stored.NettLess) changes.Add($"NETT THAN {Math.Max(0, stored.Than - stored.NettLess)} → {Math.Max(0, entry.Than - entry.NettLess)}");
        if (entry.Repair != stored.Repair) changes.Add("REP. → YES");

        var incoming = row.Dispatches.Select(d => new DispatchEntity { EntryId = stored.Id, Qty = d.Qty, GatePass = d.GatePass, DispatchDate = d.Date, DateText = d.DateText }).ToList();
        var current = storedDispatches.ToList();
        List<DispatchEntity> dispatches;
        if (StartsWith(incoming, current))
        {
            dispatches = incoming;
            if (incoming.Count > current.Count) changes.Add($"{incoming.Count - current.Count} later dispatch(es) added");
        }
        else if (StartsWith(current, incoming))
        {
            dispatches = current;
        }
        else
        {
            dispatches = [.. current, .. incoming.Where(d => !current.Any(c => SameDispatch(c, d)))];
            changes.Add("dispatches differ between the two registers; both kept");
        }
        return (entry, dispatches, changes);
    }

    internal static bool StartsWith(List<DispatchEntity> list, List<DispatchEntity> prefix) =>
        list.Count >= prefix.Count && prefix.Select((d, i) => SameDispatch(d, list[i])).All(same => same);

    internal static bool SameDispatch(DispatchEntity a, DispatchEntity b) =>
        a.Qty == b.Qty
        && string.Equals(a.GatePass.Trim(), b.GatePass.Trim(), StringComparison.OrdinalIgnoreCase)
        && string.Equals(a.DispatchDate ?? a.DateText, b.DispatchDate ?? b.DateText, StringComparison.Ordinal);
}
