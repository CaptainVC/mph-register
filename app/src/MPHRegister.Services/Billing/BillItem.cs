using MPHRegister.Contracts.Entries;

namespace MPHRegister.Services.Billing;

/// <summary>One bill row before packing: one entry, or several grouped by lot/gate pass or combined because they are small.</summary>
public sealed class BillItem
{
    public required List<EntryDto> Entries { get; init; }

    public required string Finish { get; init; }

    public int Qty => Entries.Sum(e => e.NettThan);

    public int Position { get; set; }

    public string Gpn { get; set; } = string.Empty;

    public string Dn { get; set; } = string.Empty;

    public string Lot { get; set; } = string.Empty;

    public string PrimaryRef
    {
        get
        {
            if (Lot.Length > 0) return Lot;
            return Dn.Length > 0 ? Dn : Gpn;
        }
    }

    public static string GatePasses(EntryDto entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return string.Join(",", entry.Dispatches.Select(d => d.GatePass.Trim()).Where(g => g.Length > 0).Distinct());
    }
}
