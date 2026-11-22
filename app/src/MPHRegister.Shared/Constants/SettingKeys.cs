namespace MPHRegister.Shared.Constants;

/// <summary>Keys of the data file's settings table, which keeps working state (not configuration).</summary>
public static class SettingKeys
{
    public const string InvoiceNextPrefix = "invoice_next:";

    /// <summary>Set once the start-up has turned unbilled entries marked R in LOT N. or D.N. into repairs (see RepairMark).</summary>
    public const string RepairMarksChecked = "repair_marks_checked";

    /// <summary>Firm details as stored by v0.4 data files, before they moved to the config file.</summary>
    public const string LegacyFirm = "firm";

    /// <summary>Signature as stored by v0.4 data files.</summary>
    public const string LegacySignature = "signature_png";

    public static string InvoiceNext(string financialYear) => InvoiceNextPrefix + financialYear;
}
