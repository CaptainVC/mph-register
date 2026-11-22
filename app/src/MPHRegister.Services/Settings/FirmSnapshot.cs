using MPHRegister.Contracts.Settings;
using MPHRegister.Shared.Configuration;

namespace MPHRegister.Services.Settings;

public static class FirmSnapshot
{
    /// <summary>The firm details and bill rules a new bill is made with (and keeps).</summary>
    public static FirmSettings From(AppConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);
        var f = config.Firm;
        var t = config.PrintedTexts;
        var r = config.BillRules;
        var p = config.Print;
        return new FirmSettings(f.Name, f.Gstin, f.AddressLine1, f.AddressLine2, f.PhoneLine, f.MsmeLine, t.InvoiceKind, t.SacLine, t.CopyLabel,
            t.BankLine1, t.BankLine2, t.PaymentLine, string.Join("\n", t.Terms), t.Signatory, t.SignatureLabel, t.CheckedByLabel, f.HomeStateCode,
            f.HomeStateName, r.CgstPercent, r.SgstPercent, r.IgstPercent, r.TotalMustStayBelow, r.RowsPerBill, r.NumberPrefix, r.CombineSmallBelowThan,
            r.CombineUpTo, p.PaperSize, p.IndianDigitGrouping, t, p.SmallestFontPt);
    }
}
