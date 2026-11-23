using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Enums;

namespace MPHRegister.Contracts.Settings;

/// <summary>
/// Firm details and bill rules as one flat record: copied onto every saved bill (so a printed bill never changes later)
/// and used by the bill maker. Built from the config file.
/// </summary>
public sealed record FirmSettings(
    string FirmName,
    string Gstin,
    string AddressLine1,
    string AddressLine2,
    string PhoneLine,
    string MsmeLine,
    string InvoiceTitle,
    string SacLine,
    string CopyLabel,
    string BankLine1,
    string BankLine2,
    string PaymentLine,
    string Terms,
    string Signatory,
    string SignatureLabel,
    string CheckedByLabel,
    string HomeStateCode,
    string HomeStateName,
    decimal CgstRate,
    decimal SgstRate,
    decimal IgstRate,
    decimal InvoiceLimit,
    int RowsPerInvoice,
    string InvoicePrefix,
    int SmallThanBelow,
    int CombineMax,
    PaperSize PaperSize = PaperSize.Letter,
    bool IndianNumbers = true,
    PrintedTexts? Texts = null,
    decimal? SmallestFontPt = null);

public sealed record PrintLimitsDto(int TemplateRows, int MaxRowsLetter, int MaxRowsA4, int MaxRows);

public sealed record ConfigFileDto(string Path, string? LoadedAt, string? SavedAt, IReadOnlyList<string> Notices, string? Problem);

public sealed record SettingsDto(
    FirmProfile Firm,
    BillRules BillRules,
    PrintedTexts PrintedTexts,
    PrintSettings Print,
    DisplaySettings Display,
    string Fy,
    int NextSerial,
    bool HasSignature,
    PrintLimitsDto Limits,
    ConfigFileDto ConfigFile);

/// <summary>Any section left null stays as it is.</summary>
public sealed record SettingsInput(
    FirmProfile? Firm,
    BillRules? BillRules,
    PrintedTexts? PrintedTexts,
    PrintSettings? Print,
    DisplaySettings? Display,
    string? Fy,
    int? NextSerial);

public sealed record InfoDto(
    string Version,
    string DataFile,
    string BackupFolder,
    string ConfigFile,
    string DataFolder,
    DataFolderSource DataFolderSource,
    long Entries,
    UiTheme Theme,
    bool ShowExcelImport,
    string FirmName,
    IReadOnlyList<string> Notices,
    string? ConfigProblem,
    UiLanguage Language = UiLanguage.En,
    bool ShowBillingStyles = false,
    bool ShowPartywise = true,
    bool ShowBills = true,
    bool ShowColors = true,
    bool ShowDashboard = true,
    bool ShowAawak = true);

/// <summary>What the print page needs besides the bills: current firm snapshot, print settings and the colours to paint.</summary>
public sealed record PrintContextDto(
    FirmSettings Firm,
    PrintSettings Print,
    PrintedTexts Texts,
    IReadOnlyDictionary<string, string> Colors,
    IReadOnlyDictionary<string, string> PartyColors,
    IReadOnlyDictionary<string, string> FinishColors,
    bool HasSignature);
