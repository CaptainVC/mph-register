using System.Globalization;
using System.IO.Compression;
using System.Security;
using System.Text;

namespace MPHRegister.UnitTests.TestSupport;

/// <summary>A row of a made-up inward register. Dates are ISO; dispatches are (JAWAK NAG, GATE PASS NO, DATE).</summary>
internal sealed record SheetRow(int InwardNo, string Date, string Party, string Dn = "", string Lot = "", int Than = 10, string Finish = "F1", int Tp = 0, int TwoPart = 0)
{
    public IReadOnlyList<(int Qty, string GatePass, string Date)> Dispatches { get; init; } = [];

    public SheetRow Sent(params (int Qty, string GatePass, string Date)[] dispatches) => this with { Dispatches = dispatches };
}

/// <summary>
/// Writes a small .xlsx with the inward register's Main sheet, the way the real workbooks lay it out. A null row is a
/// blank row (rows after one are carryovers). The salt changes the file's bytes without changing what it holds.
/// </summary>
internal static class InwardWorkbook
{
    private static readonly string[] Headers =
    [
        "INW. NO.", "DATE", "PARTY", "D.N.", "LOT N.", "REP.", "THAN", "TP", "NAG", "FINISH", "NETT THAN", "TWO PART",
        "JAWAK NAG 1", "GATE PASS NO 1", "DATE 1", "JAWAK NAG 2", "GATE PASS NO 2", "DATE 2", "JAWAK NAG 3", "GATE PASS NO 3", "DATE 3",
    ];

    public static string Write(string path, IEnumerable<SheetRow?> rows, string salt = "")
    {
        var sheet = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
        sheet.Append(CultureInfo.InvariantCulture, $"<!--{salt}-->");
        sheet.Append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>");
        AppendRow(sheet, 1, Headers.Select(h => (object?)h).ToArray());
        var r = 1;
        foreach (var row in rows)
        {
            r++;
            if (row is null) continue;
            var cells = new object?[Headers.Length];
            cells[0] = row.InwardNo;
            cells[1] = DateOnly.Parse(row.Date, CultureInfo.InvariantCulture);
            cells[2] = row.Party;
            cells[3] = row.Dn;
            cells[4] = row.Lot;
            cells[5] = "NO";
            cells[6] = row.Than;
            cells[7] = row.Tp == 0 ? null : row.Tp;
            cells[8] = row.Than + row.Tp;
            cells[9] = row.Finish;
            cells[10] = row.Than;
            cells[11] = row.TwoPart == 0 ? null : row.TwoPart;
            for (var i = 0; i < row.Dispatches.Count; i++)
            {
                cells[12 + (i * 3)] = row.Dispatches[i].Qty;
                cells[13 + (i * 3)] = row.Dispatches[i].GatePass;
                cells[14 + (i * 3)] = DateOnly.Parse(row.Dispatches[i].Date, CultureInfo.InvariantCulture);
            }
            AppendRow(sheet, r, cells);
        }
        sheet.Append("</sheetData></worksheet>");

        File.Delete(path);
        using (var zip = ZipFile.Open(path, ZipArchiveMode.Create))
        {
            Add(zip, "[Content_Types].xml",
                "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
                + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                + "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>"
                + "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
                + "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/></Types>");
            Add(zip, "_rels/.rels",
                "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");
            Add(zip, "xl/workbook.xml",
                "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">"
                + "<sheets><sheet name=\"Main\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");
            Add(zip, "xl/_rels/workbook.xml.rels",
                "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>"
                + "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>");
            Add(zip, "xl/styles.xml",
                "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
                + "<fonts count=\"1\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>"
                + "<fills count=\"1\"><fill><patternFill patternType=\"none\"/></fill></fills><borders count=\"1\"><border/></borders>"
                + "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>"
                + "<cellXfs count=\"2\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>"
                + "<xf numFmtId=\"14\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/></cellXfs></styleSheet>");
            Add(zip, "xl/worksheets/sheet1.xml", sheet.ToString());
        }
        return path;
    }

    private static void AppendRow(StringBuilder sheet, int r, object?[] cells)
    {
        sheet.Append(CultureInfo.InvariantCulture, $"<row r=\"{r}\">");
        for (var c = 0; c < cells.Length; c++)
        {
            var at = $"{Column(c)}{r}";
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

    private static string Column(int index) => index < 26 ? ((char)('A' + index)).ToString() : $"{(char)('A' + (index / 26) - 1)}{(char)('A' + (index % 26))}";

    private static void Add(ZipArchive zip, string name, string xml)
    {
        using var writer = new StreamWriter(zip.CreateEntry(name).Open(), new UTF8Encoding(false));
        writer.Write(xml);
    }
}
