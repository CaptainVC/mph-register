using System.Globalization;
using System.IO.Compression;
using System.Security;
using System.Text;

namespace MPHRegister.UnitTests.TestSupport;

/// <summary>A row of a made-up AAWAK register. <c>No</c> is the AAWAK NO ("12" or "12A"); the date is ISO.</summary>
internal sealed record AawakSheetRow(string No, int Inward, string Date, string Party, int Nag, string Lorry, string Comments = "");

/// <summary>
/// Writes a small .xlsx laid out like the gate's AAWAK workbook: a Main sheet (with a stray empty "Column1" and a last row
/// holding only the next number and a date) and a Details sheet with the party list (active, party group) and the lorry walas.
/// </summary>
internal static class AawakWorkbook
{
    private static readonly string[] Headers = ["AAWAK NO", "INW NO", "DATE", "PARTY", "Party Group", "NAG", "LORRY WALA", "COMMENTS", "Column1"];

    public static string Write(string path, IEnumerable<AawakSheetRow> rows, IEnumerable<(string Party, bool Active, string Group)>? parties = null,
        IEnumerable<(string Name, bool Active)>? lorries = null, string salt = "")
    {
        var main = Sheet(salt, sheet =>
        {
            AppendRow(sheet, 1, Headers.Select(h => (object?)h).ToArray());
            var r = 1;
            var list = rows.ToList();
            foreach (var row in list)
            {
                r++;
                object no = int.TryParse(row.No, NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : row.No;
                AppendRow(sheet, r, [no, row.Inward, DateOnly.Parse(row.Date, CultureInfo.InvariantCulture), row.Party, null, row.Nag, row.Lorry, row.Comments]);
            }
            if (list.Count > 0) AppendRow(sheet, r + 1, [list.Count + 1, null, DateOnly.Parse(list[^1].Date, CultureInfo.InvariantCulture)]);
        });
        var details = Sheet(string.Empty, sheet =>
        {
            AppendRow(sheet, 6, ["Party", "Active", "Party Group", null, null, null, null, null, "Lorry Wala", "Active"]);
            var partyRows = (parties ?? []).ToList();
            var lorryRows = (lorries ?? []).ToList();
            for (var i = 0; i < Math.Max(partyRows.Count, lorryRows.Count); i++)
            {
                var cells = new object?[10];
                if (i < partyRows.Count) (cells[0], cells[1], cells[2]) = (partyRows[i].Party, partyRows[i].Active ? "Yes" : "No", partyRows[i].Group);
                if (i < lorryRows.Count) (cells[8], cells[9]) = (lorryRows[i].Name, lorryRows[i].Active ? "Yes" : "No");
                AppendRow(sheet, 7 + i, cells);
            }
        });

        File.Delete(path);
        using (var zip = ZipFile.Open(path, ZipArchiveMode.Create))
        {
            Add(zip, "[Content_Types].xml",
                "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
                + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                + "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>"
                + "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
                + "<Override PartName=\"/xl/worksheets/sheet2.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
                + "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/></Types>");
            Add(zip, "_rels/.rels",
                "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");
            Add(zip, "xl/workbook.xml",
                "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">"
                + "<sheets><sheet name=\"Main\" sheetId=\"1\" r:id=\"rId1\"/><sheet name=\"Details\" sheetId=\"2\" state=\"hidden\" r:id=\"rId3\"/></sheets></workbook>");
            Add(zip, "xl/_rels/workbook.xml.rels",
                "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>"
                + "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet2.xml\"/>"
                + "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>");
            Add(zip, "xl/styles.xml",
                "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
                + "<fonts count=\"1\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>"
                + "<fills count=\"1\"><fill><patternFill patternType=\"none\"/></fill></fills><borders count=\"1\"><border/></borders>"
                + "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>"
                + "<cellXfs count=\"2\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>"
                + "<xf numFmtId=\"14\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/></cellXfs></styleSheet>");
            Add(zip, "xl/worksheets/sheet1.xml", main);
            Add(zip, "xl/worksheets/sheet2.xml", details);
        }
        return path;
    }

    private static string Sheet(string salt, Action<StringBuilder> fill)
    {
        var sheet = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
        sheet.Append(CultureInfo.InvariantCulture, $"<!--{salt}-->");
        sheet.Append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>");
        fill(sheet);
        sheet.Append("</sheetData></worksheet>");
        return sheet.ToString();
    }

    private static void AppendRow(StringBuilder sheet, int r, object?[] cells)
    {
        sheet.Append(CultureInfo.InvariantCulture, $"<row r=\"{r}\">");
        for (var c = 0; c < cells.Length; c++)
        {
            var at = $"{(char)('A' + c)}{r}";
            switch (cells[c])
            {
                case null:
                case "":
                    break;
                case string text:
                    sheet.Append(CultureInfo.InvariantCulture, $"<c r=\"{at}\" t=\"inlineStr\"><is><t>{SecurityElement.Escape(text)}</t></is></c>");
                    break;
                case DateOnly date:
                    var serial = date.ToDateTime(TimeOnly.MinValue).ToOADate().ToString(CultureInfo.InvariantCulture);
                    sheet.Append(CultureInfo.InvariantCulture, $"<c r=\"{at}\" s=\"1\"><v>{serial}</v></c>");
                    break;
                case int number:
                    sheet.Append(CultureInfo.InvariantCulture, $"<c r=\"{at}\"><v>{number}</v></c>");
                    break;
            }
        }
        sheet.Append("</row>");
    }

    private static void Add(ZipArchive zip, string name, string xml)
    {
        using var writer = new StreamWriter(zip.CreateEntry(name).Open(), new UTF8Encoding(false));
        writer.Write(xml);
    }
}
