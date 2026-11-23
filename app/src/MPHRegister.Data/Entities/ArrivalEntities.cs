namespace MPHRegister.Data.Entities;

/// <summary>One AAWAK row: a consignment that came in at the gate.</summary>
public sealed record ArrivalEntity
{
    public long Id { get; init; }

    public string AawakMonth { get; init; } = string.Empty;

    public int AawakNo { get; init; }

    public string AawakSuffix { get; init; } = string.Empty;

    public string ArrivalDate { get; init; } = string.Empty;

    public string Party { get; init; } = string.Empty;

    public int Nag { get; init; }

    public string Transporter { get; init; } = string.Empty;

    public string InwardText { get; init; } = string.Empty;

    public string Note { get; init; } = string.Empty;

    public long? ImportBatchId { get; init; }

    public int? SourceRow { get; init; }

    /// <summary>The workbook row as last imported (JSON); null for rows typed in the app.</summary>
    public string? SourceValues { get; init; }

    public string CreatedAt { get; init; } = string.Empty;

    public string UpdatedAt { get; init; } = string.Empty;
}

/// <summary>An inward entry that came on an arrival; <c>Nag</c> is its share when a slip came in two loads.</summary>
public sealed record ArrivalLinkEntity
{
    public long ArrivalId { get; init; }

    public long EntryId { get; init; }

    public int? Nag { get; init; }

    public string How { get; init; } = ArrivalLinkHow.Auto;

    public string CreatedAt { get; init; } = string.Empty;
}

public static class ArrivalLinkHow
{
    public const string Auto = "auto";
    public const string Manual = "manual";
}

public sealed record ArrivalRefEntity
{
    public long ArrivalId { get; init; }

    public int InwardNo { get; init; }
}

/// <summary>What the AAWAK screens need of an inward entry.</summary>
public sealed record SlipEntity
{
    public long Id { get; init; }

    public string RegisterMonth { get; init; } = string.Empty;

    public int InwardNo { get; init; }

    public string EntryDate { get; init; } = string.Empty;

    public string Party { get; init; } = string.Empty;

    public int Than { get; init; }

    public int Tp { get; init; }

    public int TwoPart { get; init; }

    public bool CarriedOver { get; init; }

    /// <summary>The entry was deleted in the app (it may be restored).</summary>
    public bool Deleted { get; init; }

    public int Nag => Than + Tp;
}

public sealed record DeletedArrivalEntity
{
    public long Id { get; init; }

    public string AawakMonth { get; init; } = string.Empty;

    public int AawakNo { get; init; }

    public string AawakSuffix { get; init; } = string.Empty;

    public string ArrivalDate { get; init; } = string.Empty;

    public string Party { get; init; } = string.Empty;

    public int Nag { get; init; }

    public string Transporter { get; init; } = string.Empty;

    public string InwardText { get; init; } = string.Empty;

    public string Note { get; init; } = string.Empty;

    public long? ImportBatchId { get; init; }

    public int? SourceRow { get; init; }

    public string? SourceValues { get; init; }

    public string Refs { get; init; } = "[]";

    public string Links { get; init; } = "[]";

    public string CreatedAt { get; init; } = string.Empty;

    public string UpdatedAt { get; init; } = string.Empty;

    public string DeletedAt { get; init; } = string.Empty;
}

public sealed record ArrivalImportBatchEntity
{
    public long Id { get; init; }

    public string FileName { get; init; } = string.Empty;

    public string Sha256 { get; init; } = string.Empty;

    public string AawakMonth { get; init; } = string.Empty;

    public string ImportedAt { get; init; } = string.Empty;

    public int ArrivalCount { get; init; }
}

public sealed record ArrivalImportMarkEntity
{
    public long BatchId { get; init; }

    public long ArrivalId { get; init; }

    public string Action { get; init; } = string.Empty;

    public int? SourceRow { get; init; }

    public string Changes { get; init; } = string.Empty;

    public string FileName { get; init; } = string.Empty;

    public string ImportedAt { get; init; } = string.Empty;
}

public sealed record AawakMonthCount
{
    public string AawakMonth { get; init; } = string.Empty;

    public int Arrivals { get; init; }
}

/// <summary>An entry marked as never coming through the gate.</summary>
public sealed record NoArrivalEntity
{
    public long EntryId { get; init; }

    public string Note { get; init; } = string.Empty;

    public string CreatedAt { get; init; } = string.Empty;
}

/// <summary>An arrival an inward entry came on, as the inward register shows it.</summary>
public sealed record EntryArrivalRow
{
    public long EntryId { get; init; }

    public long ArrivalId { get; init; }

    public string AawakMonth { get; init; } = string.Empty;

    public int AawakNo { get; init; }

    public string AawakSuffix { get; init; } = string.Empty;

    public string ArrivalDate { get; init; } = string.Empty;

    public string Transporter { get; init; } = string.Empty;

    public int Nag { get; init; }
}
