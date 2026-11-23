namespace MPHRegister.Data.Entities;

public sealed record ImportBatchEntity
{
    public string FileName { get; init; } = string.Empty;

    public string Sha256 { get; init; } = string.Empty;

    public string RegisterMonth { get; init; } = string.Empty;

    public string ImportedAt { get; init; } = string.Empty;

    public int EntryCount { get; init; }

    public int DispatchCount { get; init; }
}

public sealed record BillImportEntity
{
    public string FileName { get; init; } = string.Empty;

    public string Sha256 { get; init; } = string.Empty;

    public string ImportedAt { get; init; } = string.Empty;

    public int InvoiceCount { get; init; }
}

/// <summary>What one inward import did to one entry: added it, or updated it (<see cref="Changes"/> says how).</summary>
public sealed record ImportBatchEntryEntity
{
    public long BatchId { get; init; }

    public long EntryId { get; init; }

    public string Action { get; init; } = string.Empty;

    public int? SourceRow { get; init; }

    public string Changes { get; init; } = string.Empty;

    /// <summary>What the update changed as JSON (fields, dispatches, what follows from them); empty when not recorded.</summary>
    public string Details { get; init; } = string.Empty;
}

/// <summary>An entry the latest import of a month added or updated, with that import's file and time.</summary>
public sealed record ImportMarkEntity
{
    public long EntryId { get; init; }

    public string Action { get; init; } = string.Empty;

    public string Changes { get; init; } = string.Empty;

    /// <summary>Only read for one entry's history, not for the Register's marks.</summary>
    public string Details { get; init; } = string.Empty;

    public int? SourceRow { get; init; }

    public long BatchId { get; init; }

    public string FileName { get; init; } = string.Empty;

    public string ImportedAt { get; init; } = string.Empty;

    public string RegisterMonth { get; init; } = string.Empty;
}
