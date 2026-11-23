using System.Text.RegularExpressions;

namespace MPHRegister.Shared.Helpers;

public static partial class Gstin
{
    private const string Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    public static string Clean(string? text) => Whitespace().Replace(text ?? string.Empty, string.Empty).ToUpperInvariant();

    /// <summary>Format plus the mod-36 check character, so typos like O for 0 are caught.</summary>
    public static bool IsValid(string? gstin)
    {
        if (gstin is null || !Pattern().IsMatch(gstin)) return false;
        var sum = 0;
        for (var i = 0; i < 14; i++)
        {
            var product = Alphabet.IndexOf(gstin[i], StringComparison.Ordinal) * (i % 2 == 0 ? 1 : 2);
            sum += (product / 36) + (product % 36);
        }
        return Alphabet[(36 - (sum % 36)) % 36] == gstin[14];
    }

    [GeneratedRegex(@"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")]
    private static partial Regex Pattern();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}
