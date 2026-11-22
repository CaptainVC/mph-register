namespace MPHRegister.Data.Entities;

public sealed record NameCount
{
    public string Name { get; init; } = string.Empty;

    public int Count { get; init; }
}
