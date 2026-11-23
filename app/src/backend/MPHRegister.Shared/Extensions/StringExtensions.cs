using System.Text.RegularExpressions;

namespace MPHRegister.Shared.Extensions;

public static partial class StringExtensions
{
    /// <summary>Trims and collapses runs of whitespace, so "HARRISON   PRODUCT" equals "HARRISON PRODUCT".</summary>
    public static string NormalizeName(this string? text)
    {
        if (text is null) return string.Empty;
        return HasOnlySingleSpaces(text) ? text.Trim() : Whitespace().Replace(text, " ").Trim();
    }

    // The usual name: no whitespace but single spaces, which the regex would leave as they are (it runs on every lookup).
    private static bool HasOnlySingleSpaces(string text)
    {
        var afterSpace = false;
        foreach (var c in text)
        {
            if (c == ' ')
            {
                if (afterSpace) return false;
                afterSpace = true;
            }
            else if (char.IsWhiteSpace(c))
            {
                return false;
            }
            else
            {
                afterSpace = false;
            }
        }
        return true;
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}
