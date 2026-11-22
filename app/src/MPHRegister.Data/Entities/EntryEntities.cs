namespace MPHRegister.Data.Entities;

public sealed record EntryEntity
{
    public long Id { get; init; }

    public string RegisterMonth { get; init; } = string.Empty;

    public int InwardNo { get; init; }

    public string EntryDate { get; init; } = string.Empty;

    public string Party { get; init; } = string.Empty;

    public string DesignNo { get; init; } = string.Empty;

    public string LotNo { get; init; } = string.Empty;

    public bool Repair { get; init; }

    public int Than { get; init; }

    public int Tp { get; init; }

    public int TwoPart { get; init; }

    public string Finish { get; init; } = string.Empty;

    public int? ShortThan { get; init; }

    public bool CarriedOver { get; init; }

    public long? ImportBatchId { get; init; }

    public int? SourceRow { get; init; }

    /// <summary>Written by imports: the entry's row in its month's workbook (JSON). The common queries do not read it.</summary>
    public string? SourceValues { get; init; }

    public string CreatedAt { get; init; } = string.Empty;

    public string UpdatedAt { get; init; } = string.Empty;

    /// <summary>Read-only: saved app bills holding this entry.</summary>
    public string? Bill { get; init; }

    /// <summary>Read-only: note when billed outside the app.</summary>
    public string? Elsewhere { get; init; }
}

public sealed record DispatchEntity
{
    public long EntryId { get; init; }

    public int Seq { get; init; }

    public int Qty { get; init; }

    public string GatePass { get; init; } = string.Empty;

    public string? DispatchDate { get; init; }

    public string? DateText { get; init; }
}

public sealed record MonthCount
{
    public string RegisterMonth { get; init; } = string.Empty;

    public int Entries { get; init; }
}

public sealed record InwardKey
{
    public string RegisterMonth { get; init; } = string.Empty;

    public int InwardNo { get; init; }
}

public sealed record EntrySource
{
    public long Id { get; init; }

    public string SourceValues { get; init; } = string.Empty;
}

public sealed record PartyToBillRow
{
    public string Party { get; init; } = string.Empty;

    public int Entries { get; init; }

    public int NettThan { get; init; }

    public int NotDispatched { get; init; }
}
