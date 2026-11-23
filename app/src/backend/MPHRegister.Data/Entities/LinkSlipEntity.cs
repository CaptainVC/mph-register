namespace MPHRegister.Data.Entities;

/// <summary>The few columns of an entry needed to link an all-zero slip to the entry its D.N. points to.</summary>
public sealed record LinkSlipEntity
{
    public long Id { get; init; }

    public string RegisterMonth { get; init; } = string.Empty;

    public int InwardNo { get; init; }

    public string EntryDate { get; init; } = string.Empty;

    public string Party { get; init; } = string.Empty;

    public string DesignNo { get; init; } = string.Empty;

    public int Than { get; init; }
}
