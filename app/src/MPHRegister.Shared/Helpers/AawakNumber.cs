using System.Globalization;
using System.Text.RegularExpressions;

namespace MPHRegister.Shared.Helpers;

/// <summary>An AAWAK NO: a serial within the month and an optional letter for a row put in later ("217A").</summary>
public static partial class AawakNumber
{
    public const int Max = 99_999;

    public static bool TryParse(string? text, out int number, out string suffix)
    {
        number = 0;
        suffix = string.Empty;
        var match = Pattern().Match(text ?? string.Empty);
        if (!match.Success || !int.TryParse(match.Groups[1].Value, NumberStyles.None, CultureInfo.InvariantCulture, out number)) return false;
        if (number is < 1 or > Max) return false;
        suffix = match.Groups[2].Value.ToUpperInvariant();
        return true;
    }

    public static string Format(int number, string? suffix) => string.Create(CultureInfo.InvariantCulture, $"{number}{suffix ?? string.Empty}");

    [GeneratedRegex(@"^\s*0*(\d{1,6})\s*([A-Za-z]?)\s*$")]
    private static partial Regex Pattern();
}
