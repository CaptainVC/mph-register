using System.Globalization;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Imports;

/// <summary>Reads ExcelDataReader cell values the way the registers use them.</summary>
public static class ExcelCells
{
    private const int FirstPlausibleYear = 2000;
    private const int LastPlausibleYear = 2100;
    private static readonly string[] DotDateFormats = ["dd.MM.yy", "d.M.yy", "dd.MM.yyyy", "d.M.yyyy", "dd/MM/yy", "dd/MM/yyyy", "dd-MM-yy", "dd-MM-yyyy"];

    public static string Text(object? value, string dateFormat = "yyyy-MM-dd") => value switch
    {
        null => string.Empty,
        double d when double.IsInteger(d) && Math.Abs(d) < 1e15 => ((long)d).ToString(CultureInfo.InvariantCulture),
        double d => d.ToString(CultureInfo.InvariantCulture),
        DateTime dt => dt.ToString(dateFormat, CultureInfo.InvariantCulture),
        TimeSpan t => t.ToString(@"hh\:mm", CultureInfo.InvariantCulture),
        _ => Convert.ToString(value, CultureInfo.InvariantCulture)?.Trim() ?? string.Empty,
    };

    /// <summary>A real calendar date; time-only cells and years like 1900 are not.</summary>
    public static DateTime? Date(object? value) =>
        value is DateTime dt && dt.Year is >= FirstPlausibleYear and <= LastPlausibleYear ? dt.Date : null;

    public static bool IsImplausibleDate(object? value) => value is DateTime dt && dt.Year is < FirstPlausibleYear or > LastPlausibleYear;

    public static bool IsZeroOrBlank(object? value) => value switch
    {
        null => true,
        double d => d == 0,
        DateTime dt => dt.Year < FirstPlausibleYear,
        TimeSpan t => t == TimeSpan.Zero,
        _ => Text(value) is "" or "0",
    };

    /// <summary>Whole number, null when blank, or an error message when it is something else.</summary>
    public static (int? Value, string? Error) WholeNumber(object? value, string column) => value switch
    {
        null => (null, null),
        string s when s.Trim().Length == 0 => (null, null),
        double d when double.IsInteger(d) && d is >= int.MinValue and <= int.MaxValue => ((int)d, null),
        string s when int.TryParse(s.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) => (parsed, null),
        _ => (null, $"{column} is not a whole number ({Text(value)})."),
    };

    public static int? Rounded(object? value) => value switch
    {
        double d => (int)Math.Round(d, MidpointRounding.AwayFromZero),
        string s when int.TryParse(s.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
        _ => null,
    };

    public static decimal? Number(object? value) => value switch
    {
        double d => (decimal)d,
        string s when decimal.TryParse(s.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var n) => n,
        _ => null,
    };

    /// <summary>Bill dates are typed like 31.10.26.</summary>
    public static string? DotDate(object? value)
    {
        if (Date(value) is { } dt) return Dates.Iso(dt);
        var text = Text(value, "dd.MM.yy");
        foreach (var format in DotDateFormats)
        {
            if (DateOnly.TryParseExact(text, format, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) && date.Year >= FirstPlausibleYear)
                return Dates.Iso(date);
        }
        return null;
    }
}
