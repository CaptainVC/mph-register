using System.Globalization;
using System.Text.RegularExpressions;

namespace MPHRegister.Services.Imports.Bills;

/// <summary>
/// The numbers and words in one G.P.N., D.N. or LOT cell. Shorthand is written out in full: "1049 TO 1053" is
/// 1049, 1050 … 1053 and "1134,35,36" is 1134, 1135, 1136. The short form itself ("35") is kept as a weak token,
/// because it may also be a number of its own. A shorter number that would land far from the one before is a number of
/// its own ("1061,352" is lots 1061 and 352); the long form (1352) is then the weak token.
/// </summary>
public sealed partial class RefTokens
{
    private const int MaxRange = 40;

    private RefTokens(HashSet<string> strong, HashSet<string> weak)
    {
        Strong = strong;
        Weak = weak;
    }

    public static RefTokens Empty { get; } = new([], []);

    public IReadOnlySet<string> Strong { get; }

    public IReadOnlySet<string> Weak { get; }

    public bool IsEmpty => Strong.Count == 0 && Weak.Count == 0;

    public static RefTokens Parse(string? text)
    {
        var cleaned = Brackets().Replace(text ?? string.Empty, " ").ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(cleaned)) return Empty;
        var strong = new HashSet<string>(StringComparer.Ordinal);
        var weak = new HashSet<string>(StringComparer.Ordinal);
        foreach (var groups in Range().Matches(cleaned).Select(m => m.Groups)) AddRange(groups[1].Value, groups[2].Value, strong);
        string? previous = null;
        foreach (var part in Separators().Split(cleaned))
        {
            if (part.Length == 0 || part is "TO" or "MIX") continue;
            var digits = IsDigits(part);
            if (digits && previous is not null && part.Length < previous.Length)
            {
                var full = string.Concat(previous.AsSpan(0, previous.Length - part.Length), part);
                // "1134,35" counts on from 1134; "1061,352" is lot 1061 and lot 352, not 1352.
                if (Near(previous, full))
                {
                    strong.Add(full);
                    weak.Add(part);
                    previous = full;
                    continue;
                }
                weak.Add(full);
            }
            strong.Add(part);
            previous = digits ? part : null;
        }
        weak.ExceptWith(strong);
        return new RefTokens(strong, weak);
    }

    public static RefTokens Union(IEnumerable<RefTokens> parts)
    {
        ArgumentNullException.ThrowIfNull(parts);
        var strong = new HashSet<string>(StringComparer.Ordinal);
        var weak = new HashSet<string>(StringComparer.Ordinal);
        foreach (var part in parts)
        {
            strong.UnionWith(part.Strong);
            weak.UnionWith(part.Weak);
        }
        weak.ExceptWith(strong);
        return strong.Count == 0 && weak.Count == 0 ? Empty : new RefTokens(strong, weak);
    }

    private static void AddRange(string from, string to, HashSet<string> into)
    {
        if (to.Length < from.Length) to = string.Concat(from.AsSpan(0, from.Length - to.Length), to);
        if (from.Length > 9 || to.Length > 9) return;
        var a = int.Parse(from, CultureInfo.InvariantCulture);
        var b = int.Parse(to, CultureInfo.InvariantCulture);
        if (b < a || b - a > MaxRange) return;
        for (var n = a; n <= b; n++) into.Add(n.ToString(CultureInfo.InvariantCulture));
    }

    private static bool IsDigits(string text) => text.All(char.IsAsciiDigit);

    private static bool Near(string previous, string full) =>
        previous.Length <= 9 && Math.Abs(long.Parse(full, CultureInfo.InvariantCulture) - long.Parse(previous, CultureInfo.InvariantCulture)) <= MaxRange;

    [GeneratedRegex(@"\([^)]*\)")]
    private static partial Regex Brackets();

    [GeneratedRegex("[^A-Z0-9]+")]
    private static partial Regex Separators();

    [GeneratedRegex(@"(?<![0-9])([0-9]+)\s*TO\s*([0-9]+)(?![0-9])")]
    private static partial Regex Range();
}
