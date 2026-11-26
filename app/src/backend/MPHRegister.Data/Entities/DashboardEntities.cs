namespace MPHRegister.Data.Entities;

/// <summary>One saved (not cancelled) bill with its money columns and billed THAN.</summary>
public sealed record DashboardBillRow
{
    public string BillDate { get; init; } = string.Empty;

    public string Party { get; init; } = string.Empty;

    public string PartyName { get; init; } = string.Empty;

    public long Gross { get; init; }

    public long Discount { get; init; }

    public long Taxable { get; init; }

    public long Cgst { get; init; }

    public long Sgst { get; init; }

    public long Igst { get; init; }

    public long Total { get; init; }

    public int Than { get; init; }
}

/// <summary>Priced bill lines of saved bills, added up per finish.</summary>
public sealed record DashboardFinishRow
{
    public string Finish { get; init; } = string.Empty;

    public int Than { get; init; }

    public long Amount { get; init; }
}

/// <summary>Priced bill lines of saved bills, added up per bill-to party, bill month (yyyy-MM) and finish.</summary>
public sealed record DashboardFinishMonthRow
{
    public string Party { get; init; } = string.Empty;

    public string Month { get; init; } = string.Empty;

    public string Finish { get; init; } = string.Empty;

    public int Than { get; init; }

    public long Amount { get; init; }
}

/// <summary>Pieces sent back for one register party in one dispatch month (yyyy-MM).</summary>
public sealed record DashboardSentRow
{
    public string Party { get; init; } = string.Empty;

    public string Month { get; init; } = string.Empty;

    public int Pieces { get; init; }
}

public sealed record DashboardPartyBillDate
{
    public string Party { get; init; } = string.Empty;

    public string LastBill { get; init; } = string.Empty;
}

/// <summary>One inward entry as the dashboard needs it: who, what, when, how much and how much went back.</summary>
public sealed record DashboardEntryRow
{
    public string Party { get; init; } = string.Empty;

    public string Finish { get; init; } = string.Empty;

    public string EntryDate { get; init; } = string.Empty;

    public bool Repair { get; init; }

    public int Than { get; init; }

    /// <summary>THAN that NETT THAN charges less than THAN (see <see cref="EntryEntity.NettLess"/>).</summary>
    public int NettLess { get; init; }

    public int Tp { get; init; }

    public int TwoPart { get; init; }

    /// <summary>What is charged: THAN less NettLess, and nothing for a repair.</summary>
    public int NettThan => Repair ? 0 : Math.Max(0, Than - NettLess);

    public int Dispatched { get; init; }

    public string? LastValidDispatch { get; init; }

    public bool DispatchDateIssue { get; init; }

    public bool Billed { get; init; }
}
