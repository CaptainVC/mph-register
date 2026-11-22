using System.Buffers;
using System.Xml.Linq;
using MPHRegister.Shared.Configuration;

namespace MPHRegister.Services.Exports.Bills;

/// <summary>Reuses or appends style variants; styles used by other cells are never edited.</summary>
internal sealed class WorkbookStyles
{
    private static readonly SearchValues<char> HexDigits = SearchValues.Create("0123456789abcdefABCDEF");
    private static readonly string[] Edges = ["left", "right", "top", "bottom"];
    private readonly XlsxPackage package;
    private readonly string part;
    private readonly XElement fonts;
    private readonly XElement borders;
    private readonly XElement formats;
    private readonly Dictionary<(int Style, string Color), int> colored = [];
    private readonly Dictionary<(int Style, bool Box), int> outlined = [];

    public WorkbookStyles(XlsxPackage package, string part)
    {
        this.package = package;
        this.part = part;
        var root = package.Xml(part).Root ?? throw new InvalidDataException("The workbook's styles are empty.");
        fonts = root.Element(X("fonts")) ?? throw new InvalidDataException("The workbook has no fonts.");
        borders = root.Element(X("borders")) ?? throw new InvalidDataException("The workbook has no borders.");
        formats = root.Element(X("cellXfs")) ?? throw new InvalidDataException("The workbook has no cell formats.");
    }

    public static string PartyColor(string? name, IReadOnlyList<NamedColor>? palette)
    {
        var text = name?.Trim() ?? string.Empty;
        if (text.Length == 0) return "FFFF0000";
        var hex = text.StartsWith('#') ? text : (palette ?? DefaultConfig.BasicColors)
            .FirstOrDefault(c => string.Equals(c.Name, text, StringComparison.OrdinalIgnoreCase))?.Hex ?? "#000000";
        if (hex.Length == 7 && hex[0] == '#' && !hex.AsSpan(1).ContainsAnyExcept(HexDigits))
            return "FF" + hex[1..].ToUpperInvariant();
        throw new InvalidDataException($"Invalid bill font colour: {hex}.");
    }

    public bool HasColor(SheetXml sheet, string reference, string color)
    {
        var font = fonts.Elements().ElementAt(FontId(Format(sheet.Style(reference))));
        return string.Equals((string?)font.Element(X("color"))?.Attribute("rgb"), color, StringComparison.OrdinalIgnoreCase);
    }

    public void SetColor(SheetXml sheet, string reference, string color)
    {
        var style = sheet.Style(reference);
        if (!colored.TryGetValue((style, color), out var index))
        {
            var format = new XElement(Format(style));
            var font = new XElement(fonts.Elements().ElementAt(FontId(format)));
            var rgb = font.Element(X("color"));
            if (rgb is null)
            {
                rgb = new XElement(X("color"));
                font.Add(rgb);
            }
            rgb.ReplaceAttributes(new XAttribute("rgb", color));
            format.SetAttributeValue("fontId", FindOrAdd(fonts, font));
            format.SetAttributeValue("applyFont", "1");
            index = FindOrAdd(formats, format);
            colored[(style, color)] = index;
        }
        sheet.SetStyle(reference, index);
    }

    public bool HasOutline(SheetXml sheet, string reference)
    {
        var border = Border(Format(sheet.Style(reference)));
        return IsBox(border) && Edges.All(name => string.Equals((string?)border.Element(X(name))?.Element(X("color"))?.Attribute("rgb"),
            "FF000000", StringComparison.OrdinalIgnoreCase));
    }

    public bool IsBoxed(SheetXml sheet, string reference) => IsBox(Border(Format(sheet.Style(reference))));

    public void SetOutline(SheetXml sheet, string reference, bool box, int ordinaryStyle)
    {
        var style = sheet.Style(reference);
        if (!outlined.TryGetValue((style, box), out var index))
        {
            var format = new XElement(Format(style));
            var border = Border(format);
            if (box)
            {
                border = new XElement(border);
                foreach (var name in Edges)
                {
                    var side = border.Element(X(name));
                    if (side is null)
                    {
                        side = new XElement(X(name));
                        var following = border.Elements().FirstOrDefault(e => Array.IndexOf(Edges, e.Name.LocalName) > Array.IndexOf(Edges, name)
                            || e.Name == X("diagonal") || e.Name == X("vertical") || e.Name == X("horizontal"));
                        if (following is null) border.Add(side);
                        else following.AddBeforeSelf(side);
                    }
                    side.SetAttributeValue("style", "thick");
                    side.ReplaceNodes(new XElement(X("color"), new XAttribute("rgb", "FF000000")));
                }
                format.SetAttributeValue("borderId", FindOrAdd(borders, border));
                format.SetAttributeValue("applyBorder", "1");
            }
            else if (IsBox(border))
            {
                var plain = formats.Elements().FirstOrDefault(f => !IsBox(Border(f)) && SameExceptBorder(format, f))
                    ?? Format(ordinaryStyle);
                if (IsBox(Border(plain))) throw new InvalidDataException("The workbook has no ordinary THAN border to restore.");
                format.SetAttributeValue("borderId", (int?)plain.Attribute("borderId") ?? 0);
            }
            index = FindOrAdd(formats, format);
            outlined[(style, box)] = index;
        }
        sheet.SetStyle(reference, index);
    }

    private XElement Format(int index) => formats.Elements().ElementAt(index);

    private static int FontId(XElement format) => (int?)format.Attribute("fontId") ?? 0;

    private XElement Border(XElement format) => borders.Elements().ElementAt((int?)format.Attribute("borderId") ?? 0);

    private static bool IsBox(XElement border) => Edges
        .All(name => (string?)border.Element(X(name))?.Attribute("style") == "thick");

    private static bool SameExceptBorder(XElement a, XElement b)
    {
        var first = new XElement(a);
        var second = new XElement(b);
        first.Attribute("borderId")?.Remove();
        second.Attribute("borderId")?.Remove();
        first.Attribute("applyBorder")?.Remove();
        second.Attribute("applyBorder")?.Remove();
        return XNode.DeepEquals(first, second);
    }

    private int FindOrAdd(XElement container, XElement value)
    {
        var index = 0;
        foreach (var existing in container.Elements())
        {
            if (XNode.DeepEquals(existing, value)) return index;
            index++;
        }
        container.Add(value);
        container.SetAttributeValue("count", index + 1);
        package.MarkChanged(part);
        return index;
    }

    public static bool PreservesOriginal(XDocument before, XDocument after)
    {
        if (before.Root is null || after.Root is null) return false;
        var original = new XElement(before.Root);
        var saved = new XElement(after.Root);
        foreach (var name in new[] { "fonts", "borders", "cellXfs" })
        {
            var a = original.Element(X(name));
            var b = saved.Element(X(name));
            if (a is null || b is null || b.Elements().Count() < a.Elements().Count()) return false;
            b.Elements().Skip(a.Elements().Count()).Remove();
            b.SetAttributeValue("count", (string?)a.Attribute("count"));
        }
        return XNode.DeepEquals(original, saved);
    }

    private static XName X(string name) => XName.Get(name, XlsxPackage.MainNs);
}
