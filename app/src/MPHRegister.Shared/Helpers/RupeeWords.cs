using System.Globalization;
using System.Text;

namespace MPHRegister.Shared.Helpers;

/// <summary>
/// Line-for-line port of the bill workbook's RupeeFormat VBA macro, so printed words match Excel exactly,
/// including its leading space and double spaces (" Rupees Seventeen Thousand  Seven Hundred Ninety Only").
/// </summary>
public static class RupeeWords
{
    private static readonly string[] Places = ["", "", " Thousand ", " Lakh ", " Crores ", " Trillion ", "", "", "", ""];
    private static readonly string[] Digits = [" One", " Two", " Three", " Four", " Five", " Six", " Seven", " Eight", " Nine", ""];
    private static readonly string[] Teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    private static readonly string[] Tens = ["", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

    public static string Format(long amount)
    {
        if (amount < 0) return "Minus" + Format(-amount);
        if (amount > 999_999_999) return "Digit excced Maximum limit";
        var number = amount.ToString(CultureInfo.InvariantCulture);
        var words = new StringBuilder();
        var lakhPlace = 0;
        var place = 1;
        while (number.Length > 0)
        {
            var part = place >= 2 || number.Length <= 2 ? Right(number, 2) : Right(number, 3);
            if (place == 1 && number.Length == 1) part = Right(number, 1);
            var value = Val(part);
            var text = value switch
            {
                > 99 => Hundreds(Right(part, 3), lakhPlace),
                > 9 => TensWords(Right(part, 2)),
                _ => DigitWord(Right(part, 2)),
            };
            if (value > 99) lakhPlace++;
            if (text.Length > 0) words.Insert(0, text + Places[place]);
            number = place switch
            {
                2 => number.Length == 1 ? string.Empty : number[..^2],
                3 => number.Length >= 3 ? number[..^2] : string.Empty,
                4 => string.Empty,
                _ => number.Length <= 2 ? string.Empty : number[..^3],
            };
            place++;
        }
        return (words.Length == 0 ? "No Rupees" : " Rupees " + words) + " Only";
    }

    private static string Hundreds(string text, int lakhPlace)
    {
        if (Val(text) < 1) return string.Empty;
        text = Right("000" + text, 3);
        var unit = lakhPlace > 0 ? " Lakh " : " Hundred ";
        var result = text[0] != '0' ? DigitWord(text[..1]) + unit : string.Empty;
        return result + (text[1] != '0' ? TensWords(text[1..]) : DigitWord(text[2..]));
    }

    private static string TensWords(string text)
    {
        var first = Val(text[..1]);
        if (first == 1) return Teens[Val(text.Length > 1 ? text[1..2] : "0")];
        return (first > 0 ? Tens[first - 1] : string.Empty) + DigitWord(Right(text, 1));
    }

    private static string DigitWord(string text)
    {
        var value = Val(text);
        return value > 0 ? Digits[value - 1] : string.Empty;
    }

    private static string Right(string text, int count) => text.Length <= count ? text : text[^count..];

    private static int Val(string text) => int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var value) ? value : 0;
}
