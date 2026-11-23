using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace MPHRegister.Shared.Helpers;

/// <summary>
/// What an Aawak row's INW NO / COMMENTS say about its inward slips. <c>Readings</c> are the possible lists of slip numbers,
/// the likeliest first: a shortened range end ("237-24") can be read more than one way, and the slips' NAG later decides.
/// <c>Note</c> is the text that is not numbers (who carried it, the real sender); <c>NumbersText</c> the numbers part as written.
/// </summary>
public sealed record InwardNumbersText(IReadOnlyList<IReadOnlyList<int>> Readings, string Note, string NumbersText)
{
    public IReadOnlyList<int> Numbers => Readings.Count > 0 ? Readings[0] : [];
}

/// <summary>
/// Reads slip numbers written the many ways the gate writes them: "12-14", "13 TO 17", "139 TO  141", "470 TO482",
/// "19,20", "2,,3", "310.311", "328/329", "78--79", "7 TO 11,13", "12 TO 14 NAME", "NAME-52-63" and shortened ends
/// such as "237-24" (237 to 240) or "105-6" (105 to 106).
/// </summary>
public static partial class InwardNumbers
{
    /// <summary>A range longer than this is a typo, not one consignment.</summary>
    public const int MaxRange = 30;

    public const int MaxNumber = 99_999;

    private const int MaxReadings = 8;

    public static InwardNumbersText Read(string? text)
    {
        var source = text ?? string.Empty;
        var tokens = Tokens().Matches(source).Select(m => m.Value).ToList();
        if (!tokens.Any(t => char.IsAsciiDigit(t[0]))) return new InwardNumbersText([], source.Trim(), string.Empty);

        var items = new List<List<List<int>>>();
        var notes = new List<string>();
        var numbersText = new StringBuilder();
        int? start = null;
        var dashAfterStart = false;

        void Close()
        {
            if (start is { } s) items.Add([[s]]);
            start = null;
            dashAfterStart = false;
        }

        foreach (var token in tokens)
        {
            var kind = Kind(token);
            if (kind != TokenKind.Word) numbersText.Append(token);
            switch (kind)
            {
                case TokenKind.Number:
                    var n = Parse(token);
                    if (start is { } a && dashAfterStart)
                    {
                        items.Add(Range(a, n, token.Length));
                        start = null;
                        dashAfterStart = false;
                    }
                    else
                    {
                        Close();
                        start = n;
                    }
                    break;
                case TokenKind.Dash:
                    if (start is not null) dashAfterStart = true;
                    break;
                case TokenKind.Word:
                    notes.Add(token);
                    Close();
                    numbersText.Append(' ');
                    break;
                case TokenKind.Separator:
                    Close();
                    break;
                default:
                    break;
            }
        }
        Close();

        var readings = new List<List<int>> { new() };
        foreach (var options in items)
        {
            readings = readings.SelectMany(r => options.Select(o => r.Concat(o).ToList())).Take(MaxReadings).ToList();
        }
        var distinct = readings.Select(r => (IReadOnlyList<int>)r.Where(n => n is > 0 and <= MaxNumber).Distinct().ToList())
            .Where(r => r.Count > 0).ToList();
        var unique = new List<IReadOnlyList<int>>();
        foreach (var reading in distinct.Where(reading => !unique.Any(u => u.SequenceEqual(reading)))) unique.Add(reading);
        return new InwardNumbersText(unique, string.Join(' ', notes), Tidy(numbersText.ToString()));
    }

    /// <summary>"12-14, 20": runs of numbers as ranges.</summary>
    public static string Format(IEnumerable<int> numbers)
    {
        ArgumentNullException.ThrowIfNull(numbers);
        var sorted = numbers.Distinct().Order().ToList();
        var parts = new List<string>();
        for (var i = 0; i < sorted.Count;)
        {
            var j = i;
            while (j + 1 < sorted.Count && sorted[j + 1] == sorted[j] + 1) j++;
            parts.Add(j > i ? string.Create(CultureInfo.InvariantCulture, $"{sorted[i]}-{sorted[j]}") : sorted[i].ToString(CultureInfo.InvariantCulture));
            i = j + 1;
        }
        return string.Join(", ", parts);
    }

    /// <summary>The ways a range can be read. A smaller end with fewer digits replaces the start's last digits or is padded with zeros.</summary>
    private static List<List<int>> Range(int from, int to, int toDigits)
    {
        if (to >= from) return to - from < MaxRange ? [Enumerable.Range(from, to - from + 1).ToList()] : [[from, to]];
        var fromText = from.ToString(CultureInfo.InvariantCulture);
        var ends = new List<int>();
        if (toDigits < fromText.Length)
        {
            ends.Add(int.Parse(fromText[..^toDigits] + to.ToString(CultureInfo.InvariantCulture).PadLeft(toDigits, '0'), CultureInfo.InvariantCulture));
            var padded = to;
            while (padded.ToString(CultureInfo.InvariantCulture).Length < fromText.Length) padded *= 10;
            ends.Add(padded);
        }
        var options = ends.Distinct().Where(end => end >= from && end - from < MaxRange).Select(end => Enumerable.Range(from, end - from + 1).ToList()).ToList();
        return options.Count > 0 ? options : [[from]];
    }

    private static int Parse(string digits) =>
        digits.Length > 6 ? 0 : int.Parse(digits, NumberStyles.None, CultureInfo.InvariantCulture);

    private static TokenKind Kind(string token)
    {
        if (char.IsAsciiDigit(token[0])) return TokenKind.Number;
        if (char.IsAsciiLetter(token[0])) return string.Equals(token, "TO", StringComparison.OrdinalIgnoreCase) ? TokenKind.Dash : TokenKind.Word;
        if (token[0] == '-') return TokenKind.Dash;
        return char.IsWhiteSpace(token[0]) ? TokenKind.Space : TokenKind.Separator;
    }

    private static string Tidy(string text) => Spaces().Replace(text, " ").Trim(' ', ',', '.', '/', ';', '-', '&', '+');

    private enum TokenKind
    {
        Number,
        Dash,
        Word,
        Separator,
        Space,
    }

    [GeneratedRegex(@"\d+|[A-Za-z]+|-+|\s+|[^\sA-Za-z\d-]+")]
    private static partial Regex Tokens();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();
}
