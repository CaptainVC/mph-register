namespace MPHRegister.Data.Entities;

public sealed record InvoiceEntity
{
    public long Id { get; init; }

    public string InvoiceNo { get; init; } = string.Empty;

    public string Fy { get; init; } = string.Empty;

    public int Serial { get; init; }

    public string Party { get; init; } = string.Empty;

    public string PartyName { get; init; } = string.Empty;

    public string Address { get; init; } = string.Empty;

    public string State { get; init; } = string.Empty;

    public string Gstin { get; init; } = string.Empty;

    public string BillDate { get; init; } = string.Empty;

    public string BillMonth { get; init; } = string.Empty;

    public string PeriodFrom { get; init; } = string.Empty;

    public string PeriodTo { get; init; } = string.Empty;

    public double DiscountPct { get; init; }

    public string TaxMode { get; init; } = string.Empty;

    public double CgstRate { get; init; }

    public double SgstRate { get; init; }

    public double IgstRate { get; init; }

    public long Gross { get; init; }

    public long Discount { get; init; }

    public long Taxable { get; init; }

    public long Cgst { get; init; }

    public long Sgst { get; init; }

    public long Igst { get; init; }

    public long Total { get; init; }

    public string Status { get; init; } = string.Empty;

    public string Source { get; init; } = string.Empty;

    public string Firm { get; init; } = "{}";

    public string Notes { get; init; } = string.Empty;

    public string CreatedAt { get; init; } = string.Empty;

    public string UpdatedAt { get; init; } = string.Empty;

    public string? CancelledAt { get; init; }
}

public sealed record InvoiceLineEntity
{
    public string Kind { get; init; } = string.Empty;

    public string Gpn { get; init; } = string.Empty;

    public string Dn { get; init; } = string.Empty;

    public string Lot { get; init; } = string.Empty;

    public string Finish { get; init; } = string.Empty;

    public int? Qty { get; init; }

    public double? Rate { get; init; }

    public long? Amount { get; init; }

    public bool AutoSum { get; init; }

    public string EntryIds { get; init; } = "[]";
}

public sealed record InvoiceSummaryRow
{
    public long Id { get; init; }

    public string InvoiceNo { get; init; } = string.Empty;

    public string BillDate { get; init; } = string.Empty;

    public string BillMonth { get; init; } = string.Empty;

    public string Fy { get; init; } = string.Empty;

    public int Serial { get; init; }

    public string Party { get; init; } = string.Empty;

    public string PartyName { get; init; } = string.Empty;

    public int Than { get; init; }

    public long Total { get; init; }

    public string Status { get; init; } = string.Empty;

    public string Source { get; init; } = string.Empty;

    public string? Finishes { get; init; }

    public int Entries { get; init; }

    /// <summary>When the bill was last written to a copy of the Excel bill workbook, or null.</summary>
    public string? ExportedAt { get; init; }

    public string? ExportedTo { get; init; }

    /// <summary>The bill was edited after it was last written to Excel.</summary>
    public bool ChangedSinceExport { get; init; }
}

/// <summary>Why one entry of a cancelled bill cannot go back on it: gone, on another saved bill, or marked billed elsewhere.</summary>
public sealed record InvoiceEntryClaim
{
    public long EntryId { get; init; }

    public string? Party { get; init; }

    public string? RegisterMonth { get; init; }

    public int InwardNo { get; init; }

    public string? Bill { get; init; }

    public string? Elsewhere { get; init; }

    public bool Missing { get; init; }
}
