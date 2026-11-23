using System.IO.Compression;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace MPHRegister.Services.Exports.Bills;

/// <summary>
/// An .xlsx / .xlsm opened as its zip parts. Only the parts marked changed are written again; every other part (the VBA
/// project, drawings, tables, other sheets) is copied byte for byte, in its original order.
/// </summary>
internal sealed class XlsxPackage
{
    public const string MainNs = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    public const string RelNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private const string PackageRelNs = "http://schemas.openxmlformats.org/package/2006/relationships";
    private const string ContentTypesNs = "http://schemas.openxmlformats.org/package/2006/content-types";
    private const string OfficeDocumentType = RelNs + "/officeDocument";
    private const long MaxUnpackedBytes = 400L * 1024 * 1024;

    private readonly List<string> order = [];
    private readonly Dictionary<string, byte[]> parts = new(StringComparer.Ordinal);
    private readonly Dictionary<string, DateTimeOffset> times = new(StringComparer.Ordinal);
    private readonly Dictionary<string, XDocument> xml = new(StringComparer.Ordinal);
    private readonly HashSet<string> changed = new(StringComparer.Ordinal);

    public static XlsxPackage Open(byte[] bytes)
    {
        var package = new XlsxPackage();
        long total = 0;
        try
        {
            using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
            foreach (var entry in zip.Entries)
            {
                if (total + entry.Length > MaxUnpackedBytes) throw new InvalidDataException("the workbook is too large");
                using var stream = entry.Open();
                using var copy = new MemoryStream();
                var buffer = new byte[81920];
                int read;
                while ((read = stream.Read(buffer, 0, buffer.Length)) > 0)
                {
                    total += read;
                    if (total > MaxUnpackedBytes) throw new InvalidDataException("the workbook is too large");
                    copy.Write(buffer, 0, read);
                }
                package.order.Add(entry.FullName);
                package.parts[entry.FullName] = copy.ToArray();
                package.times[entry.FullName] = entry.LastWriteTime;
            }
        }
        catch (InvalidDataException ex)
        {
            throw new InvalidDataException($"This is not an .xlsx or .xlsm workbook ({ex.Message})", ex);
        }
        return package;
    }

    public IReadOnlyList<string> Names => order;

    public bool Has(string name) => parts.ContainsKey(name);

    /// <summary>The part as it will be saved.</summary>
    public byte[] Bytes(string name) => changed.Contains(name) ? Serialize(xml[name]) : parts[name];

    public XDocument Xml(string name)
    {
        if (!xml.TryGetValue(name, out var doc))
        {
            doc = Parse(parts[name]);
            xml[name] = doc;
        }
        return doc;
    }

    public void MarkChanged(string name)
    {
        _ = Xml(name);
        changed.Add(name);
    }

    public void Remove(string name)
    {
        order.Remove(name);
        parts.Remove(name);
        xml.Remove(name);
        changed.Remove(name);
    }

    public bool IsChanged(string name) => changed.Contains(name);

    public byte[] Save()
    {
        using var output = new MemoryStream();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var name in order)
            {
                var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
                if (times[name].Year >= 1980) entry.LastWriteTime = times[name];
                using var stream = entry.Open();
                stream.Write(Bytes(name));
            }
        }
        return output.ToArray();
    }

    /// <summary>The workbook part, from the package relationships (normally xl/workbook.xml).</summary>
    public string WorkbookPart()
    {
        var target = Relationships("_rels/.rels", string.Empty).FirstOrDefault(r => r.Type == OfficeDocumentType).Target;
        return target ?? "xl/workbook.xml";
    }

    /// <summary>The part of the sheet with that name (case-insensitive), or null.</summary>
    public string? SheetPart(string sheetName)
    {
        var workbook = WorkbookPart();
        var sheet = Xml(workbook).Root?.Element(XName.Get("sheets", MainNs))?.Elements(XName.Get("sheet", MainNs))
            .FirstOrDefault(s => string.Equals((string?)s.Attribute("name"), sheetName, StringComparison.OrdinalIgnoreCase));
        var id = (string?)sheet?.Attribute(XName.Get("id", RelNs));
        if (id is null) return null;
        return Relationships(RelsOf(workbook), Folder(workbook)).FirstOrDefault(r => r.Id == id).Target;
    }

    /// <summary>The workbook's related part of that type (e.g. sharedStrings, calcChain), or null.</summary>
    public string? WorkbookRelated(string type)
    {
        var workbook = WorkbookPart();
        return Relationships(RelsOf(workbook), Folder(workbook)).FirstOrDefault(r => r.Type == RelNs + "/" + type).Target;
    }

    /// <summary>Drops the calculation chain: Excel rebuilds it, and an old one that lists a cell whose formula was removed makes Excel repair the file.</summary>
    public bool RemoveCalcChain()
    {
        var workbook = WorkbookPart();
        var part = WorkbookRelated("calcChain");
        if (part is null) return false;
        Remove(part);
        var rels = RelsOf(workbook);
        var relDoc = Xml(rels);
        relDoc.Root!.Elements(XName.Get("Relationship", PackageRelNs)).Where(r => ((string?)r.Attribute("Type"))?.EndsWith("/calcChain", StringComparison.Ordinal) == true).Remove();
        MarkChanged(rels);
        if (Has("[Content_Types].xml"))
        {
            var types = Xml("[Content_Types].xml");
            types.Root!.Elements(XName.Get("Override", ContentTypesNs)).Where(o => string.Equals((string?)o.Attribute("PartName"), "/" + part, StringComparison.OrdinalIgnoreCase)).Remove();
            MarkChanged("[Content_Types].xml");
        }
        return true;
    }

    /// <summary>Asks Excel to work out every formula again when the file is opened.</summary>
    public void RecalculateOnOpen()
    {
        var workbook = WorkbookPart();
        var root = Xml(workbook).Root!;
        var calc = root.Element(XName.Get("calcPr", MainNs));
        if (calc is null)
        {
            calc = new XElement(XName.Get("calcPr", MainNs));
            var after = root.Element(XName.Get("definedNames", MainNs)) ?? root.Element(XName.Get("sheets", MainNs));
            if (after is null) root.Add(calc);
            else after.AddAfterSelf(calc);
        }
        calc.SetAttributeValue("fullCalcOnLoad", "1");
        MarkChanged(workbook);
    }

    private IEnumerable<(string Id, string Type, string? Target)> Relationships(string relsPart, string folder)
    {
        if (!Has(relsPart)) yield break;
        foreach (var rel in Xml(relsPart).Root!.Elements(XName.Get("Relationship", PackageRelNs)))
        {
            if (string.Equals((string?)rel.Attribute("TargetMode"), "External", StringComparison.OrdinalIgnoreCase)) continue;
            yield return ((string?)rel.Attribute("Id") ?? string.Empty, (string?)rel.Attribute("Type") ?? string.Empty, Resolve(folder, (string?)rel.Attribute("Target") ?? string.Empty));
        }
    }

    private static string Folder(string part) => part.Contains('/', StringComparison.Ordinal) ? part[..(part.LastIndexOf('/') + 1)] : string.Empty;

    private static string RelsOf(string part) => $"{Folder(part)}_rels/{part[(part.LastIndexOf('/') + 1)..]}.rels";

    private static string Resolve(string folder, string target)
    {
        if (target.StartsWith('/')) return target[1..];
        var segments = new List<string>(folder.Split('/', StringSplitOptions.RemoveEmptyEntries));
        foreach (var segment in target.Split('/'))
        {
            if (segment == "..") { if (segments.Count > 0) segments.RemoveAt(segments.Count - 1); }
            else if (segment is not ("." or "")) segments.Add(segment);
        }
        return string.Join('/', segments);
    }

    private static XDocument Parse(byte[] bytes)
    {
        var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null };
        using var reader = XmlReader.Create(new MemoryStream(bytes), settings);
        return XDocument.Load(reader, LoadOptions.PreserveWhitespace);
    }

    private static byte[] Serialize(XDocument doc)
    {
        using var output = new MemoryStream();
        var settings = new XmlWriterSettings { Encoding = new UTF8Encoding(false), Indent = false };
        using (var writer = XmlWriter.Create(output, settings)) doc.Save(writer);
        return output.ToArray();
    }
}
