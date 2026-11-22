using System.Globalization;
using System.Text.RegularExpressions;

namespace MPHRegister.Shared.Helpers;

public static partial class FinancialYear
{
    /// <summary>Indian financial year (April to March) as "26-27".</summary>
    public static string Of(DateOnly date)
    {
        var start = date.Month >= 4 ? date.Year : date.Year - 1;
        return string.Create(CultureInfo.InvariantCulture, $"{start % 100:00}-{(start + 1) % 100:00}");
    }

    public static bool IsValid(string? fy) => fy is not null && Pattern().IsMatch(fy);

    [GeneratedRegex("^[0-9]{2}-[0-9]{2}$")]
    private static partial Regex Pattern();
}
