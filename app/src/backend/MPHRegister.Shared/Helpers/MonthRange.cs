using System.Globalization;

namespace MPHRegister.Shared.Helpers;

/// <summary>Months from <see cref="From"/> to <see cref="To"/> (yyyy-MM, both included).</summary>
public sealed record MonthRange(string From, string To)
{
    /// <summary>The financial year that starts in April of <paramref name="year"/> ("2026": 2026-04 to 2027-03); null when it is not a year.</summary>
    public static MonthRange? FinancialYear(string? year) =>
        year is { Length: 4 } && int.TryParse(year, NumberStyles.None, CultureInfo.InvariantCulture, out var start) && start is >= 1900 and <= 9998
            ? new MonthRange(string.Create(CultureInfo.InvariantCulture, $"{start:D4}-04"), string.Create(CultureInfo.InvariantCulture, $"{start + 1:D4}-03"))
            : null;
}
