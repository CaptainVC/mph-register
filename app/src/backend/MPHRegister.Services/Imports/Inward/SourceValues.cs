using System.Text.Json;
using MPHRegister.Data.Entities;
using MPHRegister.Shared.Helpers;
using MPHRegister.Shared.Json;

namespace MPHRegister.Services.Imports.Inward;

/// <summary>An entry's row as its month's workbook had it at the last import; the next import of that month compares with it.</summary>
public sealed record SourceValues(
    int InwardNo,
    string Date,
    string Party,
    string Design,
    string Lot,
    bool Repair,
    int Than,
    int Tp,
    int TwoPart,
    string Finish,
    int? ShortThan,
    IReadOnlyList<InwardDispatch> Dispatches)
{
    public static SourceValues Of(InwardRow row)
    {
        ArgumentNullException.ThrowIfNull(row);
        return new(row.InwardNo, row.Date, row.Party, row.Design, row.Lot, row.Repair, row.Than, row.Tp, row.TwoPart, row.Finish, row.ShortThan, row.Dispatches);
    }

    /// <summary>The saved entry's own values, standing in for the row of an entry imported before rows were kept.</summary>
    public static SourceValues Of(EntryEntity entry, IReadOnlyList<DispatchEntity> dispatches)
    {
        ArgumentNullException.ThrowIfNull(entry);
        ArgumentNullException.ThrowIfNull(dispatches);
        return new(entry.InwardNo, entry.EntryDate, entry.Party, entry.DesignNo, entry.LotNo, ReadNow(entry.Repair, entry.LotNo, entry.DesignNo), entry.Than, entry.Tp, entry.TwoPart,
            entry.Finish, entry.ShortThan, dispatches.Select(d => new InwardDispatch(d.Qty, d.GatePass, d.DispatchDate, d.DateText)).ToList());
    }

    /// <summary>
    /// A row kept from before R in LOT N. or D.N. counted as a repair says REP. No; the reader now reads that row as Yes, so
    /// it is compared as Yes and an unchanged workbook row is not taken for a change of REP.
    /// </summary>
    private static bool ReadNow(bool repair, string? lot, string? design) => repair || RepairMark.In(lot, design);

    public string ToJson() => JsonSerializer.Serialize(this, JsonDefaults.Options);

    /// <summary>The stored row, or null when there is none or it cannot be read (the entry is then treated as having none).</summary>
    public static SourceValues? FromJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var values = JsonSerializer.Deserialize<SourceValues>(json, JsonDefaults.Options);
            return values is null ? null : values with
            {
                Repair = ReadNow(values.Repair, values.Lot, values.Design),
                Date = values.Date ?? string.Empty,
                Party = values.Party ?? string.Empty,
                Design = values.Design ?? string.Empty,
                Lot = values.Lot ?? string.Empty,
                Finish = values.Finish ?? string.Empty,
                Dispatches = (values.Dispatches ?? []).Select(d => d with { GatePass = d.GatePass ?? string.Empty }).ToList(),
            };
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
