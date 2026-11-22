using System.Globalization;
using System.IO.Compression;
using System.Security;
using System.Text;
using MPHRegister.Services.Exports.Bills;

namespace MPHRegister.UnitTests.TestSupport;

/// <summary>A made-up row of the bill workbook's Details sheet.</summary>
internal sealed record DetailsParty(string Name, string Address = "ADDR", string State = "(HOME STATE)", string Gstin = "08TESTF9001J1ZJ", decimal? Discount = 10)
{
    public IReadOnlyDictionary<string, decimal> Rates { get; init; } = new Dictionary<string, decimal> { ["F1"] = 100, ["F2"] = 50 };
    public string Color { get; init; } = "black";
}

/// <summary>
/// Writes an empty bill workbook with the real layout: Main with 100 bill places (4 panels × 25 bills of A1:G49) and the
/// same formulas (bill no. / date / period chains, Details lookups, rates, amounts and totals), a Details sheet, shared
/// texts, a calculation chain and a stand-in VBA project. Made-up data only.
/// </summary>
internal static class BillWorkbookBuilder
{
    public static readonly byte[] VbaProject = Encoding.ASCII.GetBytes("not a real VBA project, kept byte for byte");
    public static readonly string[] Finishes = ["F1", "F2", "F3"];

    private const string RateFormula = "IFERROR(INDEX(INDIRECT(\"Details!\"&Details!$E$1&Details!$B$1&\":\"&Details!$E$2&Details!$B$2),"
        + "MATCH(A8,INDIRECT(\"Details!A\"&Details!$B$1&\":A\"&Details!$B$2),0),MATCH(D13,INDIRECT(\"Details!\"&Details!$E$1&\"6:\"&Details!$E$2&\"6\"),0)),\"\")";

    private static string Lookup(int column) => $"VLOOKUP(A8,INDIRECT(\"Details!A\"&Details!B1&\":E\"&Details!B2),{column},FALSE)";

    private const string NumberLink = "LEFT(F7,FIND(\"\\\",F7,FIND(\"\\\",F7)+1))&(MID(F7,FIND(\"\\\",F7,FIND(\"\\\",F7)+1)+1,LEN(F7))+1)";

    public static byte[] Build(IReadOnlyList<DetailsParty> parties, string firstNumber = "26-27\\JOB\\101", string firstDate = "31.10.26",
        string firstPeriod = "01.10.26 TO 31.10.26", Action<Dictionary<string, Cell>>? change = null)
    {
        var strings = new List<string>();
        var main = MainCells(firstNumber, firstDate, firstPeriod);
        change?.Invoke(main);
        var details = DetailsCells(parties);
        using var output = new MemoryStream();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            Add(zip, "[Content_Types].xml",
                "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
                + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                + "<Default Extension=\"bin\" ContentType=\"application/vnd.ms-office.vbaProject\"/>"
                + "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.ms-excel.sheet.macroEnabled.main+xml\"/>"
                + "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
                + "<Override PartName=\"/xl/worksheets/sheet2.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
                + "<Override PartName=\"/xl/sharedStrings.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml\"/>"
                + "<Override PartName=\"/xl/calcChain.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml\"/>"
                + "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/></Types>");
            Add(zip, "_rels/.rels",
                "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");
            Add(zip, "xl/workbook.xml",
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                + "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">"
                + "<sheets><sheet name=\"Main\" sheetId=\"1\" r:id=\"rId1\"/><sheet name=\"Details\" sheetId=\"2\" state=\"hidden\" r:id=\"rId2\"/></sheets>"
                + "<definedNames><definedName name=\"finishes\">Details!$H$6:$J$6</definedName></definedNames><calcPr calcId=\"191029\"/></workbook>");
            Add(zip, "xl/_rels/workbook.xml.rels",
                "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>"
                + "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet2.xml\"/>"
                + "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings\" Target=\"sharedStrings.xml\"/>"
                + "<Relationship Id=\"rId4\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>"
                + "<Relationship Id=\"rId5\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain\" Target=\"calcChain.xml\"/>"
                + "<Relationship Id=\"rId6\" Type=\"http://schemas.microsoft.com/office/2006/relationships/vbaProject\" Target=\"vbaProject.bin\"/></Relationships>");
            Add(zip, "xl/styles.xml",
                "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><fonts count=\"1\"><font><sz val=\"11\"/><color rgb=\"FFFF0000\"/><name val=\"Calibri\"/></font></fonts><fills count=\"1\"><fill/></fills>"
                + "<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count=\"1\"><xf/></cellStyleXfs><cellXfs count=\"2\"><xf/><xf numFmtId=\"49\" applyNumberFormat=\"1\"/></cellXfs></styleSheet>");
            Add(zip, "xl/worksheets/sheet1.xml", Sheet(main, strings));
            Add(zip, "xl/worksheets/sheet2.xml", Sheet(details, strings));
            Add(zip, "xl/calcChain.xml", "<calcChain xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><c r=\"F13\" i=\"1\"/><c r=\"G38\"/></calcChain>");
            var entry = zip.CreateEntry("xl/vbaProject.bin");
            using (var stream = entry.Open()) stream.Write(VbaProject);
            Add(zip, "xl/sharedStrings.xml",
                $"<sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" count=\"{strings.Count}\" uniqueCount=\"{strings.Count}\">"
                + string.Concat(strings.Select(s => $"<si><t xml:space=\"preserve\">{SecurityElement.Escape(s)}</t></si>")) + "</sst>");
        }
        return output.ToArray();
    }

    /// <summary>A cell: typed text or number, or a formula with its saved result (null = "", a string, or a number).</summary>
    internal sealed record Cell(object? Value, string? Formula = null, string? Shared = null, string? SharedRef = null, int Style = 0);

    private static Dictionary<string, Cell> MainCells(string firstNumber, string firstDate, string firstPeriod)
    {
        var cells = new Dictionary<string, Cell>(StringComparer.Ordinal);
        string? number = firstNumber;
        foreach (var slot in BillSlot.All)
        {
            void Put(int row, int column, Cell cell) => cells[slot.Ref(row, column)] = cell;
            string Shift(string formula) => FormulaText.Shift(formula, slot.RowOffset, slot.ColumnOffset, otherSheets: false);
            Put(1, Col.C, new Cell("TAX INVOICE"));
            Put(7, Col.D, new Cell(" Invoice No.  :"));
            Put(8, Col.D, new Cell(" Dated  :"));
            if (slot.Index == 0)
            {
                Put(7, Col.F, new Cell(firstNumber));
                Put(8, Col.F, new Cell(firstDate));
                Put(10, Col.F, new Cell(firstPeriod));
            }
            else
            {
                var previous = slot.Previous!.Value;
                number = BillWorkbook.Next(number);
                Put(7, Col.F, new Cell(number, FormulaText.Shift(NumberLink, previous.RowOffset, previous.ColumnOffset, otherSheets: false)));
                Put(8, Col.F, new Cell(firstDate, previous.Ref(8, Col.F)));
                Put(10, Col.F, new Cell(firstPeriod, previous.Ref(10, Col.F)));
            }
            Put(9, Col.A, new Cell(null, Shift($"IFERROR({Lookup(2)},\"\")")));
            Put(10, Col.A, new Cell(null, Shift($"IFERROR({Lookup(3)},\"\")")));
            Put(11, Col.A, new Cell(null, Shift($"IFERROR(\"GSTIN: \"&{Lookup(4)},\"\")")));
            var labels = new[] { "G.P.N.", "D.N.", "LOT NO.", "FINISH", "THAN", "RATE", "Amount(Rs.)" };
            for (var c = 0; c < labels.Length; c++) Put(12, c, new Cell(labels[c]));
            var si = slot.Index.ToString(CultureInfo.InvariantCulture);
            for (var row = BillSlot.FirstLineRow; row <= BillSlot.LastLineRow; row++)
            {
                for (var c = Col.A; c <= Col.C; c++) Put(row, c, new Cell(null, Style: 1));
                var rate = RateFormula.Replace("D13", $"D{row}", StringComparison.Ordinal);
                Put(row, Col.F, new Cell(null, Shift(rate)));
                Put(row, Col.G, row == BillSlot.FirstLineRow
                    ? new Cell(null, Shift("IF(F13=\"\",\"\",ROUND(F13*E13,0))"), si, $"{slot.Ref(13, Col.G)}:{slot.Ref(37, Col.G)}")
                    : new Cell(null, string.Empty, si));
            }
            Put(38, Col.F, new Cell("Total Rs."));
            Put(38, Col.G, new Cell(0m, Shift("SUBTOTAL(109,G13:G37)")));
            Put(39, Col.D, new Cell("Less/Discount"));
            Put(39, Col.G, new Cell(null, Shift($"IF(IFERROR({Lookup(5)},\"\")=\"\",\"\",ROUND(G38*IFERROR({Lookup(5)}/100,\"\"),0))")));
            Put(40, Col.D, new Cell("Net Taxable Amount"));
            Put(40, Col.G, new Cell(0m, Shift("IF(G39=\"\",0,G38-G39)")));
            Put(41, Col.D, new Cell("CGST"));
            Put(41, Col.F, new Cell(0.025m));
            Put(41, Col.G, new Cell(0m, Shift("ROUND(G40*F41,0)")));
            Put(42, Col.D, new Cell("SGST"));
            Put(42, Col.F, new Cell(0.025m));
            Put(42, Col.G, new Cell(0m, Shift("ROUND(G40*F42,0)")));
            Put(43, Col.A, new Cell(new CellError("#NAME?"), Shift("rupeeformat(G43)")));
            Put(43, Col.E, new Cell("Invoice Total"));
            Put(43, Col.G, new Cell(0m, Shift("SUM(G40:G42)")));
        }
        return cells;
    }

    private static Dictionary<string, Cell> DetailsCells(IReadOnlyList<DetailsParty> parties)
    {
        var cells = new Dictionary<string, Cell>(StringComparer.Ordinal)
        {
            ["A1"] = new("Start Row"),
            ["B1"] = new(7m, "ROW(PartyDetails[#Headers])+1"),
            ["A2"] = new("End Row"),
            ["B2"] = new((decimal)(6 + Math.Max(1, parties.Count)), "ROWS(PartyDetails[])+ROW(PartyDetails[#Headers])"),
            ["E1"] = new("H"),
            ["E2"] = new(A1.Column(6 + Finishes.Length), "SUBSTITUTE(ADDRESS(1,9,4),\"1\",\"\")"),
        };
        var headers = new[] { "FirmName", "Address", "State", "GSTIN", "Dis.", "Active", "Color" }.Concat(Finishes).ToList();
        for (var c = 0; c < headers.Count; c++) cells[A1.Ref(6, c)] = new Cell(headers[c]);
        for (var i = 0; i < parties.Count; i++)
        {
            var p = parties[i];
            var row = 7 + i;
            cells[A1.Ref(row, 0)] = new Cell(p.Name);
            cells[A1.Ref(row, 1)] = new Cell(p.Address);
            cells[A1.Ref(row, 2)] = new Cell(p.State);
            cells[A1.Ref(row, 3)] = new Cell(p.Gstin);
            if (p.Discount is { } d) cells[A1.Ref(row, 4)] = new Cell(d);
            cells[A1.Ref(row, 5)] = new Cell("Yes");
            cells[A1.Ref(row, 6)] = new Cell(p.Color);
            for (var f = 0; f < Finishes.Length; f++)
            {
                if (p.Rates.TryGetValue(Finishes[f], out var rate)) cells[A1.Ref(row, 7 + f)] = new Cell(rate);
            }
        }
        return cells;
    }

    private static string Sheet(Dictionary<string, Cell> cells, List<string> strings)
    {
        var xml = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>");
        foreach (var row in cells.Select(c => (Ref: c.Key, Pos: A1.Parse(c.Key), c.Value)).GroupBy(c => c.Pos.Row).OrderBy(g => g.Key))
        {
            xml.Append(CultureInfo.InvariantCulture, $"<row r=\"{row.Key}\">");
            foreach (var (reference, _, cell) in row.OrderBy(c => c.Pos.Column))
            {
                xml.Append(CultureInfo.InvariantCulture, $"<c r=\"{reference}\"{(cell.Style > 0 ? $" s=\"{cell.Style}\"" : string.Empty)}");
                string? type = null;
                string? value = null;
                switch (cell.Value)
                {
                    case null when cell.Formula is not null:
                        type = "str";
                        value = string.Empty;
                        break;
                    case string s when cell.Formula is null:
                        type = "s";
                        if (!strings.Contains(s)) strings.Add(s);
                        value = strings.IndexOf(s).ToString(CultureInfo.InvariantCulture);
                        break;
                    case string s:
                        type = "str";
                        value = s;
                        break;
                    case decimal d:
                        value = d.ToString(CultureInfo.InvariantCulture);
                        break;
                    case CellError e:
                        type = "e";
                        value = e.Code;
                        break;
                }
                if (type is not null) xml.Append(CultureInfo.InvariantCulture, $" t=\"{type}\"");
                xml.Append('>');
                if (cell.Shared is not null)
                {
                    xml.Append(cell.SharedRef is not null
                        ? $"<f t=\"shared\" ref=\"{cell.SharedRef}\" si=\"{cell.Shared}\">{SecurityElement.Escape(cell.Formula)}</f>"
                        : $"<f t=\"shared\" si=\"{cell.Shared}\"/>");
                }
                else if (cell.Formula is not null)
                {
                    xml.Append(CultureInfo.InvariantCulture, $"<f>{SecurityElement.Escape(cell.Formula)}</f>");
                }
                if (value is not null) xml.Append(CultureInfo.InvariantCulture, $"<v>{SecurityElement.Escape(value)}</v>");
                xml.Append("</c>");
            }
            xml.Append("</row>");
        }
        return xml.Append("</sheetData></worksheet>").ToString();
    }

    private static void Add(ZipArchive zip, string name, string content)
    {
        var entry = zip.CreateEntry(name);
        using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
        writer.Write(content);
    }
}
