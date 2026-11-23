using System.Globalization;
using System.Text.RegularExpressions;

namespace MPHRegister.Shared.Helpers;

/// <summary>The month a monthly workbook is for, read from its file name.</summary>
public static partial class RegisterFileName
{
    private static readonly string[] MonthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

    /// <summary>
    /// "INWARD REG.-OCT.-26-27.xlsm" or "Aawak--NOV.-26-27.xlsm" → 2026-10 / 2026-11, null when the name has no month and
    /// financial year. Only the first year counts (one June file is named 26-29).
    /// </summary>
    public static string? GuessMonth(string fileName)
    {
        ArgumentNullException.ThrowIfNull(fileName);
        var name = fileName.ToUpperInvariant();
        var month = Array.FindIndex(MonthNames, m => Regex.IsMatch(name, $"(^|[^A-Z]){m}([^A-Z]|$)", RegexOptions.None, TimeSpan.FromSeconds(1)));
        var year = FinancialYearPattern().Match(name);
        if (month < 0 || !year.Success) return null;
        var firstYear = 2000 + int.Parse(year.Groups[1].Value, CultureInfo.InvariantCulture);
        return string.Create(CultureInfo.InvariantCulture, $"{(month >= 3 ? firstYear : firstYear + 1):0000}-{month + 1:00}");
    }

    [GeneratedRegex(@"(\d{2})-(\d{2})")]
    private static partial Regex FinancialYearPattern();
}
