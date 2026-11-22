using System.Text.RegularExpressions;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Shared.Configuration;

/// <summary>
/// Makes a config safe to use after it is read from the file or changed on a screen: fills gaps left by hand edits,
/// tidies names, drops duplicates and impossible values, and reports every change it makes.
/// </summary>
public static partial class ConfigNormalizer
{
    private static readonly PrintedTexts DefaultTexts = new();

    public static AppConfig Normalize(AppConfig? config, List<string> notices)
    {
        ArgumentNullException.ThrowIfNull(notices);
        config ??= new AppConfig();
        var styles = Unique(config.BillingStyles, s => s.Name, "Billing style", notices, s => CleanStyle(s, notices));
        if (styles.Count == 0) styles.Add(DefaultConfig.StandardStyle);
        return config with
        {
            About = AppConfig.AboutText,
            ConfigVersion = AppConfig.CurrentVersion,
            Firm = CleanFirm(config.Firm ?? new FirmProfile()),
            BillRules = CleanRules(config.BillRules ?? new BillRules(), notices),
            PrintedTexts = CleanTexts(config.PrintedTexts ?? new PrintedTexts(), notices),
            Print = CleanPrint(config.Print ?? new PrintSettings(), notices),
            Display = CleanDisplay(config.Display ?? new DisplaySettings()),
            Colors = Unique(config.Colors, c => c.Name, "Colour", notices, c => CleanColor(c, notices)),
            BillingStyles = styles,
            FinishGroups = Unique(config.FinishGroups, g => g.Name, "Finish group", notices, g => g with { Name = g.Name.NormalizeName() }),
            Finishes = Unique(config.Finishes, f => f.Name, "Finish", notices, CleanFinish),
            Parties = SisterGroupMigration.Apply(Unique(config.Parties, p => p.Name, "Party", notices, p => CleanParty(p, notices)), notices),
            Signature = CleanSignature(config.Signature, notices),
        };
    }

    /// <summary>77.50 is written as 77.5 and 90.00 as 90.</summary>
    public static decimal Tidy(decimal value) => value / 1.000000000000000000000000000000000m;

    public static string ColorReference(string? color)
    {
        var value = (color ?? string.Empty).Trim().ToLowerInvariant();
        return value.Length == 0 ? "black" : value;
    }

    public static bool IsHexColor(string? value) => value is not null && HexColor().IsMatch(value);

    private static List<T> Unique<T>(IEnumerable<T?>? items, Func<T, string?> nameOf, string what, List<string> notices, Func<T, T> clean)
        where T : class
    {
        var result = new List<T>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var raw in items ?? [])
        {
            if (raw is null) continue;
            var item = clean(raw);
            var name = nameOf(item) ?? string.Empty;
            if (name.Length == 0)
            {
                notices.Add($"{what} without a name was left out.");
                continue;
            }
            if (!seen.Add(name))
            {
                notices.Add($"{what} \"{name}\" is listed twice; the second one was left out.");
                continue;
            }
            result.Add(item);
        }
        return result;
    }

    private static FirmProfile CleanFirm(FirmProfile f) => f with
    {
        Name = Text(f.Name),
        Gstin = Gstin.Clean(f.Gstin),
        AddressLine1 = Text(f.AddressLine1),
        AddressLine2 = Text(f.AddressLine2),
        PhoneLine = f.PhoneLine ?? string.Empty,
        MsmeLine = Text(f.MsmeLine),
        HomeStateCode = Text(f.HomeStateCode),
        HomeStateName = Text(f.HomeStateName),
    };

    private static BillRules CleanRules(BillRules r, List<string> notices)
    {
        var defaults = new BillRules();
        return r with
        {
            NumberPrefix = string.IsNullOrWhiteSpace(r.NumberPrefix) ? defaults.NumberPrefix : r.NumberPrefix.Trim(),
            TotalMustStayBelow = Clamp(r.TotalMustStayBelow, 0, decimal.MaxValue, "Bill total limit", notices),
            RowsPerBill = Clamp(r.RowsPerBill, Limits.MinRowsPerBill, Limits.MaxBillRows, "Rows per bill", notices),
            CombineSmallBelowThan = Clamp(r.CombineSmallBelowThan, 0, Limits.MaxSmallThan, "Combine entries below THAN", notices),
            CombineUpTo = Clamp(r.CombineUpTo, 2, Limits.MaxCombineUpTo, "Combine up to", notices),
            CgstPercent = Tidy(Clamp(r.CgstPercent, 0, Limits.MaxGstPercent, "CGST %", notices)),
            SgstPercent = Tidy(Clamp(r.SgstPercent, 0, Limits.MaxGstPercent, "SGST %", notices)),
            IgstPercent = Tidy(Clamp(r.IgstPercent, 0, Limits.MaxGstPercent, "IGST %", notices)),
        };
    }

    private static PrintedTexts CleanTexts(PrintedTexts t, List<string> notices)
    {
        var d = DefaultTexts;
        var terms = (t.Terms ?? []).Select(x => (x ?? string.Empty).TrimEnd()).ToList();
        if (terms.Count > Limits.MaxTerms)
        {
            notices.Add($"Only {Limits.MaxTerms} lines of terms fit on a bill; the rest were left out.");
            terms = terms.Take(Limits.MaxTerms).ToList();
        }
        return t with
        {
            Title = t.Title ?? d.Title,
            CopyLabel = t.CopyLabel ?? d.CopyLabel,
            FirmGstinPrefix = t.FirmGstinPrefix ?? d.FirmGstinPrefix,
            PartyDetailsLabel = t.PartyDetailsLabel ?? d.PartyDetailsLabel,
            InvoiceNoLabel = t.InvoiceNoLabel ?? d.InvoiceNoLabel,
            DatedLabel = t.DatedLabel ?? d.DatedLabel,
            PeriodLabel = t.PeriodLabel ?? d.PeriodLabel,
            PeriodJoiner = t.PeriodJoiner ?? d.PeriodJoiner,
            PartyGstinPrefix = t.PartyGstinPrefix ?? d.PartyGstinPrefix,
            InvoiceKind = t.InvoiceKind ?? d.InvoiceKind,
            SacLine = t.SacLine ?? d.SacLine,
            GpnHeader = t.GpnHeader ?? d.GpnHeader,
            DnHeader = t.DnHeader ?? d.DnHeader,
            LotHeader = t.LotHeader ?? d.LotHeader,
            FinishHeader = t.FinishHeader ?? d.FinishHeader,
            ThanHeader = t.ThanHeader ?? d.ThanHeader,
            RateHeader = t.RateHeader ?? d.RateHeader,
            AmountHeader = t.AmountHeader ?? d.AmountHeader,
            GrossLabel = t.GrossLabel ?? d.GrossLabel,
            TotalRsLabel = t.TotalRsLabel ?? d.TotalRsLabel,
            DiscountLabel = t.DiscountLabel ?? d.DiscountLabel,
            TaxableLabel = t.TaxableLabel ?? d.TaxableLabel,
            CgstLabel = t.CgstLabel ?? d.CgstLabel,
            SgstLabel = t.SgstLabel ?? d.SgstLabel,
            IgstLabel = t.IgstLabel ?? d.IgstLabel,
            TotalLabel = t.TotalLabel ?? d.TotalLabel,
            BankLine1 = t.BankLine1 ?? d.BankLine1,
            BankLine2 = t.BankLine2 ?? d.BankLine2,
            PaymentLine = t.PaymentLine ?? d.PaymentLine,
            Terms = terms,
            Signatory = t.Signatory ?? d.Signatory,
            SignatureLabel = t.SignatureLabel ?? d.SignatureLabel,
            CheckedByLabel = t.CheckedByLabel ?? d.CheckedByLabel,
        };
    }

    private static PrintSettings CleanPrint(PrintSettings p, List<string> notices)
    {
        var fonts = new Dictionary<string, string>(PrintSettings.DefaultFontFallbacks, StringComparer.OrdinalIgnoreCase);
        foreach (var (font, list) in p.FontFallbacks ?? new Dictionary<string, string>())
        {
            if (!string.IsNullOrWhiteSpace(font) && !string.IsNullOrWhiteSpace(list)) fonts[font.Trim()] = list.Trim();
        }
        return p with
        {
            PaperSize = Enum.IsDefined(p.PaperSize) ? p.PaperSize : PaperSize.Letter,
            SmallestFontPt = Tidy(Clamp(p.SmallestFontPt, Limits.MinSmallestFontPt, Limits.MaxSmallestFontPt, "Smallest font", notices)),
            FontFallbacks = fonts,
        };
    }

    private static DisplaySettings CleanDisplay(DisplaySettings d) => d with
    {
        Theme = Enum.IsDefined(d.Theme) ? d.Theme : UiTheme.Light,
        Language = Enum.IsDefined(d.Language) ? d.Language : UiLanguage.En,
    };

    private static NamedColor CleanColor(NamedColor c, List<string> notices)
    {
        var name = (c.Name ?? string.Empty).ToLowerInvariant().NormalizeName();
        var hex = (c.Hex ?? string.Empty).Trim().ToLowerInvariant();
        if (!IsHexColor(hex))
        {
            if (name.Length > 0) notices.Add($"Colour \"{name}\" has no valid #rrggbb value; black is used.");
            hex = "#000000";
        }
        return c with { Name = name, Hex = hex };
    }

    private static BillingStyle CleanStyle(BillingStyle s, List<string> notices)
    {
        var name = s.Name.NormalizeName();
        var defaults = new BillingStyle();
        T Defined<T>(T value, T fallback, string what)
            where T : struct, Enum
        {
            if (Enum.IsDefined(value)) return value;
            notices.Add($"Billing style \"{name}\": unknown {what}; the usual one is used.");
            return fallback;
        }
        var cleaned = s with
        {
            Name = name,
            Description = Text(s.Description),
            GpnColumn = Defined(s.GpnColumn, defaults.GpnColumn, "G.P.N. column"),
            DnColumn = Defined(s.DnColumn, defaults.DnColumn, "D.N. column"),
            LotColumn = Defined(s.LotColumn, defaults.LotColumn, "LOT NO. column"),
            Lines = Defined(s.Lines, defaults.Lines, "line grouping"),
            Order = Defined(s.Order, defaults.Order, "line order"),
        };
        if (cleaned.GpnColumn == ColumnContent.Blank && cleaned.DnColumn == ColumnContent.Blank && cleaned.LotColumn == ColumnContent.Blank)
        {
            notices.Add($"Billing style \"{name}\" showed nothing in G.P.N., D.N. and LOT NO.; D.N. shows the design no. again.");
            cleaned = cleaned with { DnColumn = ColumnContent.DesignNo };
        }
        return cleaned;
    }

    private static FinishConfig CleanFinish(FinishConfig f)
    {
        var name = f.Name.NormalizeName();
        var fallback = (f.BillAsIfNoRate ?? [])
            .Select(x => x.NormalizeName())
            .Where(x => x.Length > 0 && !string.Equals(x, name, StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(Limits.MaxFallbacks)
            .ToList();
        return f with { Name = name, Group = f.Group.NormalizeName(), Color = ColorReference(f.Color), BillAsIfNoRate = fallback };
    }

    private static PartyConfig CleanParty(PartyConfig p, List<string> notices)
    {
        var name = p.Name.NormalizeName();
        var rates = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var (finish, rate) in p.Rates ?? new Dictionary<string, decimal>())
        {
            var finishName = finish.NormalizeName();
            if (finishName.Length == 0) continue;
            if (rate <= 0 || rate > Limits.MaxRate)
            {
                notices.Add($"Party \"{name}\": rate {rate} for {finishName} cannot be used and was left out.");
                continue;
            }
            rates[finishName] = Tidy(Math.Round(rate, 2, MidpointRounding.AwayFromZero));
        }
        var billAs = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (from, to) in p.BillAs ?? new Dictionary<string, string>())
        {
            var a = from.NormalizeName();
            var b = to.NormalizeName();
            if (a.Length > 0 && b.Length > 0 && !string.Equals(a, b, StringComparison.OrdinalIgnoreCase)) billAs[a] = b;
        }
        var discount = p.DiscountPercent is { } d ? Tidy(Math.Round(Math.Clamp(d, 0, 100), 2, MidpointRounding.AwayFromZero)) : (decimal?)null;
        if (p.DiscountPercent is { } given && (given < 0 || given > 100)) notices.Add($"Party \"{name}\": discount {given}% was changed to {discount}%.");
        return p with
        {
            Name = name,
            Address = p.Address.NormalizeName(),
            State = p.State.NormalizeName(),
            Gstin = Gstin.Clean(p.Gstin),
            DiscountPercent = discount,
            Color = ColorReference(p.Color),
            BillTo = p.BillTo.NormalizeName() is { Length: > 0 } legacyTarget ? legacyTarget : null,
            SisterGroup = p.SisterGroup.NormalizeName(),
            BillingStyle = p.BillingStyle.NormalizeName(),
            BillAs = billAs,
            Rates = rates,
        };
    }

    private static string? CleanSignature(string? signature, List<string> notices)
    {
        if (string.IsNullOrWhiteSpace(signature)) return null;
        if (SignatureImage.TryDecode(signature, out _, out _)) return signature.Trim();
        notices.Add("The signature in the config file is not a PNG or JPG picture; bills print without one.");
        return null;
    }

    private static int Clamp(int value, int min, int max, string what, List<string> notices)
    {
        var clamped = Math.Clamp(value, min, max);
        if (clamped != value) notices.Add($"{what} {value} is outside {min}–{max}; {clamped} is used.");
        return clamped;
    }

    private static decimal Clamp(decimal value, decimal min, decimal max, string what, List<string> notices)
    {
        var clamped = Math.Clamp(value, min, max);
        if (clamped != value) notices.Add($"{what} {value} is outside {min}–{(max == decimal.MaxValue ? "any" : max.ToString(System.Globalization.CultureInfo.InvariantCulture))}; {clamped} is used.");
        return clamped;
    }

    private static string Text(string? value) => (value ?? string.Empty).Trim();

    [GeneratedRegex("^#[0-9a-f]{6}$")]
    private static partial Regex HexColor();
}
