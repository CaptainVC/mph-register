using System.Globalization;
using MPHRegister.Shared.Constants;

namespace MPHRegister.Shared.Helpers;

public static class Dates
{
    public static bool IsValidMonth(string? month) =>
        DateTime.TryParseExact(month, Formats.Month, CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    public static bool TryParseIso(string? text, out DateOnly date) =>
        DateOnly.TryParseExact(text, Formats.IsoDate, CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    /// <summary>The date, or 0001-01-01 when the text is not an ISO date.</summary>
    public static DateOnly ParseIsoOrDefault(string? text) => TryParseIso(text, out var date) ? date : default;

    public static string Iso(DateOnly date) => date.ToString(Formats.IsoDate, CultureInfo.InvariantCulture);

    public static string Iso(DateTime date) => date.ToString(Formats.IsoDate, CultureInfo.InvariantCulture);

    public static string Month(DateOnly date) => date.ToString(Formats.Month, CultureInfo.InvariantCulture);

    public static string Timestamp(DateTimeOffset now) => now.LocalDateTime.ToString(Formats.Timestamp, CultureInfo.InvariantCulture);

    public static DateOnly Today(TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(clock);
        return DateOnly.FromDateTime(clock.GetLocalNow().DateTime);
    }
}
