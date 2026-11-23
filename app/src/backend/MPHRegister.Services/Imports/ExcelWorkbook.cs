using System.Text;
using ExcelDataReader;

namespace MPHRegister.Services.Imports;

public static class ExcelWorkbook
{
    private static readonly Lazy<bool> Encodings = new(() =>
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        return true;
    });

    /// <summary>Rows of the named sheet as cell values, or null when the workbook has no such sheet.</summary>
    public static List<object?[]>? ReadSheet(string filePath, string sheetName, int minColumns, int maxColumns = 64)
    {
        _ = Encodings.Value;
        using var stream = File.OpenRead(filePath);
        using var reader = ExcelReaderFactory.CreateReader(stream);
        do
        {
            if (!string.Equals(reader.Name, sheetName, StringComparison.OrdinalIgnoreCase)) continue;
            var rows = new List<object?[]>();
            while (reader.Read())
            {
                var count = Math.Min(reader.FieldCount, maxColumns);
                var row = new object?[Math.Max(count, minColumns)];
                for (var c = 0; c < count; c++) row[c] = reader.GetValue(c);
                rows.Add(row);
            }
            return rows;
        }
        while (reader.NextResult());
        return null;
    }
}
