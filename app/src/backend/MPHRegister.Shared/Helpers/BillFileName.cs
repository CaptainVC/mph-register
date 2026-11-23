using System.Globalization;
using System.Text;

namespace MPHRegister.Shared.Helpers;

public static class BillFileName
{
    /// <summary>"Party_26-27_Apr_Job12.pdf": party name, financial year, bill month (short name) and "Job" plus the bill number; "..._and_2_more.pdf" when more bills follow in the same file.</summary>
    public static string Of(string? partyName, DateOnly billDate, string? invoiceNo, int more = 0)
    {
        var number = invoiceNo?.Split(['\\', '/'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).LastOrDefault();
        var month = billDate.ToString("MMM", CultureInfo.InvariantCulture);
        var tail = more > 0 ? $"_and_{more}_more" : string.Empty;
        return $"{Clean(partyName, "party")}_{FinancialYear.Of(billDate)}_{month}_Job{Clean(number, string.Empty)}{tail}.pdf";
    }

    private static string Clean(string? text, string fallback)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var result = new StringBuilder();
        foreach (var c in (text ?? string.Empty).Trim())
        {
            if (char.IsWhiteSpace(c) || c is '_') AppendSeparator(result);
            else if (Array.IndexOf(invalid, c) >= 0 || c is ':' or '*' or '?' or '"' or '<' or '>' or '|' or '\\' or '/') continue;
            else result.Append(c);
        }

        var clean = result.ToString().Trim('_', '.');
        return clean.Length == 0 ? fallback : clean;
    }

    private static void AppendSeparator(StringBuilder result)
    {
        if (result.Length > 0 && result[^1] != '_') result.Append('_');
    }
}
