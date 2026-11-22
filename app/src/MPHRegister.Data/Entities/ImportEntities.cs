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
