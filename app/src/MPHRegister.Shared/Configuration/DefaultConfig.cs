namespace MPHRegister.Shared.Configuration;

/// <summary>The empty starting config written when a data folder has no config file and nothing to migrate.</summary>
public static class DefaultConfig
{
    public const string StandardStyleName = "Standard";

    public static BillingStyle StandardStyle { get; } = new()
    {
        Name = StandardStyleName,
        Description = "D.N. and LOT NO. filled in, one line per inward entry in inward order; small entries are combined.",
    };

    public static IReadOnlyList<NamedColor> BasicColors { get; } =
    [
        new() { Name = "black", Hex = "#000000" },
        new() { Name = "red", Hex = "#ff0000" },
        new() { Name = "blue", Hex = "#0000ff" },
        new() { Name = "green", Hex = "#008000" },
        new() { Name = "orange", Hex = "#ffa500" },
        new() { Name = "purple", Hex = "#800080" },
        new() { Name = "gray", Hex = "#808080" },
    ];

    public static AppConfig Skeleton() => new()
    {
        Colors = BasicColors,
        BillingStyles = [StandardStyle],
    };
}
