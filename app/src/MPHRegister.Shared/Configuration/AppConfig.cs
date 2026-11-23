using System.Text.Json.Serialization;
using MPHRegister.Shared.Enums;

namespace MPHRegister.Shared.Configuration;

/// <summary>
/// Everything the app knows about the business, kept in the config file (mph-config.json) next to the data file:
/// firm details, bill rules, printed texts, colours, billing styles, finish groups, finishes and parties with their rates.
/// The app itself holds none of it; the screens edit this file and it is re-read when it changes.
/// </summary>
public sealed record AppConfig
{
    public const int CurrentVersion = 1;

    public const string AboutText =
        "MPH Register config file. Edit it in the app (Masters) or carefully by hand; the app re-reads it when it changes. " +
        "Bills already saved keep the firm details and bill rules they were made with.";

    public string About { get; init; } = AboutText;

    public int ConfigVersion { get; init; } = CurrentVersion;

    public FirmProfile Firm { get; init; } = new();

    public BillRules BillRules { get; init; } = new();

    public PrintedTexts PrintedTexts { get; init; } = new();

    public PrintSettings Print { get; init; } = new();

    public DisplaySettings Display { get; init; } = new();

    /// <summary>Colour names usable for parties and finishes (a #rrggbb value is always allowed too).</summary>
    public IReadOnlyList<NamedColor> Colors { get; init; } = [];

    public IReadOnlyList<BillingStyle> BillingStyles { get; init; } = [];

    public IReadOnlyList<FinishGroupConfig> FinishGroups { get; init; } = [];

    public IReadOnlyList<FinishConfig> Finishes { get; init; } = [];

    public IReadOnlyList<PartyConfig> Parties { get; init; } = [];

    /// <summary>The lorry walas of the AAWAK (gate arrival) register.</summary>
    public IReadOnlyList<TransporterConfig> Transporters { get; init; } = [];

    public AawakSettings Aawak { get; init; } = new();

    /// <summary>The signature printed on bills, as a data URL ("data:image/png;base64,…"), or null for none.</summary>
    public string? Signature { get; init; }
}

public sealed record FirmProfile
{
    public string Name { get; init; } = string.Empty;

    public string Gstin { get; init; } = string.Empty;

    public string AddressLine1 { get; init; } = string.Empty;

    public string AddressLine2 { get; init; } = string.Empty;

    public string PhoneLine { get; init; } = string.Empty;

    public string MsmeLine { get; init; } = string.Empty;

    /// <summary>GST state code of the firm ("08" is Rajasthan). Parties whose GSTIN starts differently are billed IGST.</summary>
    public string HomeStateCode { get; init; } = string.Empty;

    /// <summary>Used instead of the code for parties without a GSTIN.</summary>
    public string HomeStateName { get; init; } = string.Empty;
}

public sealed record BillRules
{
    /// <summary>Text before the bill serial; {FY} becomes the financial year ("{FY}\JOB\" gives 26-27\JOB\279).</summary>
    public string NumberPrefix { get; init; } = "{FY}\\";

    /// <summary>A bill's total must stay below this many rupees; bigger bills are split. 0 means no limit.</summary>
    public decimal TotalMustStayBelow { get; init; }

    /// <summary>Printed rows on one bill, counting blank separator rows. The printed bill has 25; more rows are drawn smaller.</summary>
    public int RowsPerBill { get; init; } = 25;

    /// <summary>Entries with THAN below this are combined on one line (same finish) when the party's style allows. 0 turns it off.</summary>
    public int CombineSmallBelowThan { get; init; }

    /// <summary>At most this many small entries share one line.</summary>
    public int CombineUpTo { get; init; } = 4;

    public decimal CgstPercent { get; init; }

    public decimal SgstPercent { get; init; }

    /// <summary>Charged instead of CGST + SGST to parties outside the home state.</summary>
    public decimal IgstPercent { get; init; }
}

/// <summary>Every fixed text printed on a bill, so spelling and wording can be changed without a new app.</summary>
public sealed record PrintedTexts
{
    public string Title { get; init; } = "TAX INVOICE";

    public string CopyLabel { get; init; } = "ORIGINAL COPY";

    public string FirmGstinPrefix { get; init; } = "GSTN-";

    public string PartyDetailsLabel { get; init; } = "Party Details :";

    public string InvoiceNoLabel { get; init; } = " Invoice No.       :";

    public string DatedLabel { get; init; } = "    Dated                 :";

    /// <summary>Printed before the bill period ("01.10.26 TO 31.10.26"); empty prints nothing.</summary>
    public string PeriodLabel { get; init; } = string.Empty;

    public string PeriodJoiner { get; init; } = " TO ";

    public string PartyGstinPrefix { get; init; } = "GSTIN: ";

    /// <summary>Kind of bill printed above the table, e.g. "TEXTILE JOB CHARGE INVOICE".</summary>
    public string InvoiceKind { get; init; } = string.Empty;

    /// <summary>e.g. "SAC CODE-998821".</summary>
    public string SacLine { get; init; } = string.Empty;

    public string GpnHeader { get; init; } = "G.P.N.";

    public string DnHeader { get; init; } = "D.N.";

    public string LotHeader { get; init; } = "LOT NO.";

    public string FinishHeader { get; init; } = "FINISH";

    public string ThanHeader { get; init; } = "THAN";

    public string RateHeader { get; init; } = "RATE";

    public string AmountHeader { get; init; } = "Amount(Rs.)";

    public string GrossLabel { get; init; } = "Gross";

    public string TotalRsLabel { get; init; } = "Total Rs.";

    public string DiscountLabel { get; init; } = "Less/Discount";

    public string TaxableLabel { get; init; } = "Net Taxable Amount";

    public string CgstLabel { get; init; } = "CGST";

    public string SgstLabel { get; init; } = "SGST";

    public string IgstLabel { get; init; } = "IGST";

    public string TotalLabel { get; init; } = "Invoice Total";

    public string BankLine1 { get; init; } = string.Empty;

    public string BankLine2 { get; init; } = string.Empty;

    public string PaymentLine { get; init; } = string.Empty;

    /// <summary>Up to four lines of terms printed at the bottom.</summary>
    public IReadOnlyList<string> Terms { get; init; } = [];

    public string Signatory { get; init; } = string.Empty;

    public string SignatureLabel { get; init; } = "Authorized Signatory";

    public string CheckedByLabel { get; init; } = string.Empty;
}

public sealed record PrintSettings
{
    public static readonly IReadOnlyDictionary<string, string> DefaultFontFallbacks = new Dictionary<string, string>
    {
        ["Calibri"] = "Calibri, Carlito, \"Segoe UI\", Arial, sans-serif",
        ["Arial Narrow"] = "\"Arial Narrow\", \"Liberation Sans Narrow\", \"Helvetica Neue Condensed\", Arial, sans-serif",
        ["Algerian"] = "Algerian, Castellar, \"Times New Roman\", serif",
    };

    public PaperSize PaperSize { get; init; } = PaperSize.Letter;

    /// <summary>Group digits Indian style on printed bills (₹1,37,757.00) rather than 137,757.00.</summary>
    public bool IndianDigitGrouping { get; init; } = true;

    /// <summary>
    /// Smallest font (pt) on a bill line. Long combined lot or D.N. lists shrink down to it and then wrap onto a second row;
    /// it also decides how many rows per bill fit on the paper.
    /// </summary>
    public decimal SmallestFontPt { get; init; } = 7.5m;

    /// <summary>Fonts the bill uses, each with the fonts to use instead on computers without it (a CSS font list).</summary>
    public IReadOnlyDictionary<string, string> FontFallbacks { get; init; } = DefaultFontFallbacks;
}

public sealed record DisplaySettings
{
    public UiTheme Theme { get; init; } = UiTheme.Light;

    public UiLanguage Language { get; init; } = UiLanguage.En;

    /// <summary>Show the Excel import screens (only needed while old workbooks are being brought in).</summary>
    public bool ShowExcelImport { get; init; } = true;

    /// <summary>Show the Billing styles subsection under Masters (hidden by default for now).</summary>
    public bool ShowBillingStyles { get; init; }

    /// <summary>Show the Party-wise screen.</summary>
    public bool ShowPartywise { get; init; } = true;

    /// <summary>Show the Bills screens.</summary>
    public bool ShowBills { get; init; } = true;

    /// <summary>Show the Colours subsection under Masters.</summary>
    public bool ShowColors { get; init; } = true;

    /// <summary>Show the Dashboard screen (income, unbilled work, GST and parties).</summary>
    public bool ShowDashboard { get; init; } = true;

    /// <summary>Show the AAWAK screen (goods arriving at the gate).</summary>
    public bool ShowAawak { get; init; } = true;
}

/// <summary>How AAWAK rows are matched with inward slips.</summary>
public sealed record AawakSettings
{
    public const int DefaultLinkWindowDays = 3;

    /// <summary>An inward slip may be dated this many days before or after the arrival that names it.</summary>
    public int LinkWindowDays { get; init; } = DefaultLinkWindowDays;

    /// <summary>
    /// Inward slips dated from this day (ISO) on should have an AAWAK row; earlier ones are not checked. Null checks from the
    /// first AAWAK row in the data file.
    /// </summary>
    public string? CheckSlipsFrom { get; init; }
}

/// <summary>Someone who brings goods to the gate (a LORRY WALA of the AAWAK register).</summary>
public sealed record TransporterConfig
{
    public string Name { get; init; } = string.Empty;

    public bool Active { get; init; } = true;

    /// <summary>Other ways the name is written in the gate's workbook; the import reads them as this lorry wala.</summary>
    public IReadOnlyList<string> OtherSpellings { get; init; } = [];

    /// <summary>The party's own vehicle rather than a hired lorry.</summary>
    public bool OwnVehicle { get; init; }
}

public sealed record NamedColor
{
    public string Name { get; init; } = string.Empty;

    public string Hex { get; init; } = "#000000";
}

/// <summary>How a party's bill lines look. Parties choose a style by name, so one change applies to all of them.</summary>
public sealed record BillingStyle
{
    public string Name { get; init; } = string.Empty;

    public string Description { get; init; } = string.Empty;

    public ColumnContent GpnColumn { get; init; } = ColumnContent.Blank;

    public ColumnContent DnColumn { get; init; } = ColumnContent.DesignNo;

    public ColumnContent LotColumn { get; init; } = ColumnContent.LotNo;

    public LineGrouping Lines { get; init; } = LineGrouping.OnePerEntry;

    public LineOrder Order { get; init; } = LineOrder.Inward;

    /// <summary>When several entries share a line, also print their THAN like (15+28).</summary>
    public bool ShowQuantityBreakdown { get; init; }

    /// <summary>Combine small entries (see bill rules) on shared lines.</summary>
    public bool CombineSmallEntries { get; init; } = true;
}

public sealed record FinishGroupConfig
{
    public string Name { get; init; } = string.Empty;

    public bool Active { get; init; } = true;
}

public sealed record FinishConfig
{
    public string Name { get; init; } = string.Empty;

    public bool Active { get; init; } = true;

    public string Group { get; init; } = string.Empty;

    public string Color { get; init; } = "black";

    /// <summary>If a party has no rate for this finish, bill it as the first of these it has a rate for (Gotka S2G → S2G).</summary>
    public IReadOnlyList<string> BillAsIfNoRate { get; init; } = [];
}

public sealed record PartyConfig
{
    public string Name { get; init; } = string.Empty;

    public bool Active { get; init; } = true;

    public string Address { get; init; } = string.Empty;

    public string State { get; init; } = string.Empty;

    public string Gstin { get; init; } = string.Empty;

    /// <summary>Discount % taken off the gross; null means not set yet (0% is used and the bill warns).</summary>
    public decimal? DiscountPercent { get; init; }

    public string Color { get; init; } = "black";

    /// <summary>Bill this party's entries to another party (e.g. SHELBY to SHELDON FABRICS); empty bills the party itself.</summary>
    // Read legacy config files and database exports; normalization replaces these links with groups.
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? BillTo { get; init; }

    /// <summary>
    /// Sister firms share a group name (e.g. "HARRISON"): an Excel bill of one may carry the others' inward entries,
    /// so the bill import looks for them too. Empty for a party on its own.
    /// </summary>
    public string SisterGroup { get; init; } = string.Empty;

    /// <summary>Name of one of the billing styles.</summary>
    public string BillingStyle { get; init; } = string.Empty;

    /// <summary>
    /// The party is never billed (it pays in another way, or no bill is wanted): its entries are not counted as unbilled work,
    /// the party is left out of Make bills, and the register shows "No bill needed" in BILL NO.
    /// </summary>
    public bool NoBillNeeded { get; init; }

    /// <summary>The party wants bills before dispatch: undispatched entries are ticked when making its bills.</summary>
    public bool BillBeforeDispatch { get; init; }

    /// <summary>Inward finish to the finish it is billed as for this party (e.g. SGZ to SGJ).</summary>
    public IReadOnlyDictionary<string, string> BillAs { get; init; } = new Dictionary<string, string>();

    /// <summary>Rupees per THAN, by finish.</summary>
    public IReadOnlyDictionary<string, decimal> Rates { get; init; } = new Dictionary<string, decimal>();
}
