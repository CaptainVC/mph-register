using System.Globalization;
using System.Text.RegularExpressions;

namespace MPHRegister.Shared.Helpers;

/// <summary>Orders "9" before "10" and numbers before words, like the bill rows.</summary>
public sealed partial class NaturalComparer : IComparer<string>
{
    public static readonly NaturalComparer Instance = new();

    public int Compare(string? x, string? y)
    {
        x ??= string.Empty;
        y ??= string.Empty;
        var mx = LeadingNumber().Match(x);
        var my = LeadingNumber().Match(y);
        if (mx.Success && my.Success)
        {
            var c = decimal.Parse(mx.Value, CultureInfo.InvariantCulture).CompareTo(decimal.Parse(my.Value, CultureInfo.InvariantCulture));
            if (c != 0) return c;
        }
        else if (mx.Success)
        {
            return -1;
        }
        else if (my.Success)
        {
            return 1;
        }
        return string.Compare(x, y, StringComparison.OrdinalIgnoreCase);
    }

    [GeneratedRegex(@"^\d{1,28}")]
    private static partial Regex LeadingNumber();
}
