using System.Text.RegularExpressions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Billing;

public static partial class LotNumbers
{
    /// <summary>"L   624" and "624" are the same lot; the L only marks loose cloth.</summary>
    public static IReadOnlyList<string> Split(string? lot) =>
        Separators().Split((lot ?? string.Empty).ToUpperInvariant()).Where(t => t.Length > 0 && t != "L").Distinct().ToList();

    public static string Key(string? lot) => string.Join(",", Split(lot).Order(NaturalComparer.Instance));

    [GeneratedRegex("[^A-Z0-9]+")]
    private static partial Regex Separators();
}
