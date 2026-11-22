using System.Text.RegularExpressions;

namespace MPHRegister.Shared.Extensions;

public static partial class StringExtensions
{
    /// <summary>Trims and collapses runs of whitespace, so "HARRISON   PRODUCT" equals "HARRISON PRODUCT".</summary>
    public static string NormalizeName(this string? text) => Whitespace().Replace(text ?? string.Empty, " ").Trim();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}
