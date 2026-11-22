using System.Globalization;
using System.Text;

namespace MPHRegister.Shared.Helpers;

/// <summary>Indian digit grouping: 1234567 is written 12,34,567 (lakh and crore places).</summary>
public static class IndianNumbers
{
    public static string Format(decimal value, int decimals = 0)
    {
        var rounded = Math.Round(value, Math.Clamp(decimals, 0, 6), MidpointRounding.AwayFromZero);
        var text = Math.Abs(rounded).ToString("F" + Math.Clamp(decimals, 0, 6).ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
        var dot = text.IndexOf('.', StringComparison.Ordinal);
        var whole = dot < 0 ? text : text[..dot];
        var fraction = dot < 0 ? string.Empty : text[dot..];
        return (rounded < 0 ? "-" : string.Empty) + Group(whole) + fraction;
    }

    public static string Format(long value) => Format((decimal)value);

    public static string Rupees(decimal value, int decimals = 0) => "₹" + Format(value, decimals);

    private static string Group(string digits)
    {
        if (digits.Length <= 3) return digits;
        var rest = digits[..^3];
        var builder = new StringBuilder(digits.Length + (digits.Length / 2));
        for (var i = 0; i < rest.Length; i++)
        {
            builder.Append(rest[i]);
            var remaining = rest.Length - i - 1;
            if (remaining > 0 && remaining % 2 == 0) builder.Append(',');
        }
        return builder.Append(',').Append(digits[^3..]).ToString();
    }
}
