namespace MPHRegister.Shared.Extensions;

public static class EnumExtensions
{
    /// <summary>Lower-case text stored in the database and sent to the browser ("gatepass", "priced").</summary>
    public static string ToDbValue<TEnum>(this TEnum value)
        where TEnum : struct, Enum => value.ToString().ToLowerInvariant();

    public static TEnum ToEnum<TEnum>(this string? text, TEnum fallback)
        where TEnum : struct, Enum => Enum.TryParse<TEnum>(text, ignoreCase: true, out var value) && Enum.IsDefined(value) ? value : fallback;
}
