using System.Text.RegularExpressions;
using FluentValidation;
using MPHRegister.Contracts.Settings;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Validators;

/// <summary>Range checks per section; the service also checks rows per bill against the paper.</summary>
public sealed partial class SettingsInputValidator : AbstractValidator<SettingsInput>
{
    public SettingsInputValidator()
    {
        When(x => x.Firm is not null, () =>
        {
            RuleFor(x => x.Firm!.Name).Must(n => !string.IsNullOrWhiteSpace(n)).WithMessage("Firm name is required.");
            RuleFor(x => x.Firm!.Gstin).Custom((gstin, context) =>
            {
                var clean = Gstin.Clean(gstin);
                if (clean.Length > 0 && !Gstin.IsValid(clean)) context.AddFailure($"Firm GSTIN \"{clean}\" is not valid.");
            });
            RuleFor(x => x.Firm!.HomeStateCode).Must(c => StateCode().IsMatch(c ?? string.Empty))
                .WithMessage("Home state code must be 2 digits (Rajasthan is 08).");
            RuleFor(x => x.Firm!).Must(f => new[] { f.Name, f.AddressLine1, f.AddressLine2, f.PhoneLine, f.MsmeLine, f.HomeStateName }
                    .All(t => (t ?? string.Empty).Length <= Limits.ConfigTextMax))
                .WithMessage("A firm detail is too long.");
        });
        When(x => x.BillRules is not null, () =>
        {
            RuleFor(x => x.BillRules!.NumberPrefix).Must(p => !string.IsNullOrWhiteSpace(p) && p.Length <= 40)
                .WithMessage("Bill number prefix is required (up to 40 characters).");
            RuleFor(x => x.BillRules!.TotalMustStayBelow).GreaterThanOrEqualTo(0).WithMessage("Bill limit cannot be negative (0 means no limit).");
            RuleFor(x => x.BillRules!.RowsPerBill).InclusiveBetween(Limits.MinRowsPerBill, Limits.MaxBillRows)
                .WithMessage($"Rows per bill must be between {Limits.MinRowsPerBill} and {Limits.MaxBillRows}.");
            RuleFor(x => x.BillRules!.CombineSmallBelowThan).InclusiveBetween(0, Limits.MaxSmallThan)
                .WithMessage($"Small THAN threshold must be between 0 and {Limits.MaxSmallThan} (0 turns it off).");
            RuleFor(x => x.BillRules!.CombineUpTo).InclusiveBetween(2, Limits.MaxCombineUpTo).WithMessage($"Combine up to must be between 2 and {Limits.MaxCombineUpTo}.");
            RuleFor(x => x.BillRules!).Must(r => new[] { r.CgstPercent, r.SgstPercent, r.IgstPercent }.All(p => p is >= 0 and <= Limits.MaxGstPercent))
                .WithMessage($"GST rates must be between 0 and {Limits.MaxGstPercent}.");
        });
        When(x => x.PrintedTexts is not null, () =>
        {
            RuleFor(x => x.PrintedTexts!).Must(t => Texts(t).All(v => (v ?? string.Empty).Length <= Limits.ConfigTextMax))
                .WithMessage($"A printed text is too long ({Limits.ConfigTextMax} characters at most).");
            RuleFor(x => x.PrintedTexts!.Terms).Must(t => t is null || t.Count <= Limits.MaxTerms).WithMessage($"Only {Limits.MaxTerms} lines of terms fit on a bill.");
        });
        When(x => x.Print is not null, () =>
        {
            RuleFor(x => x.Print!.PaperSize).IsInEnum().WithMessage("Choose Letter or A4 paper.");
            RuleFor(x => x.Print!.SmallestFontPt).InclusiveBetween(Limits.MinSmallestFontPt, Limits.MaxSmallestFontPt)
                .WithMessage($"Smallest font must be between {Limits.MinSmallestFontPt} and {Limits.MaxSmallestFontPt} pt.");
            RuleFor(x => x.Print!.FontFallbacks).Must(f => f is null || f.Values.All(v => (v ?? string.Empty).Length <= Limits.ConfigTextMax))
                .WithMessage("A font list is too long.");
        });
        When(x => x.Display is not null, () =>
        {
            RuleFor(x => x.Display!.Theme).IsInEnum().WithMessage("Choose light or dark.");
            RuleFor(x => x.Display!.Language).IsInEnum().WithMessage("Choose English or Hindi.");
        });
        RuleFor(x => x.Fy).Must(fy => fy is null || FinancialYear.IsValid(fy)).WithMessage("Financial year must look like 26-27.");
        RuleFor(x => x.NextSerial).Must(n => n is null or >= 1).WithMessage("Next bill number must be 1 or more.");
    }

    private static IEnumerable<string?> Texts(PrintedTexts t) =>
    [
        t.Title, t.CopyLabel, t.FirmGstinPrefix, t.PartyDetailsLabel, t.InvoiceNoLabel, t.DatedLabel, t.PeriodLabel, t.PeriodJoiner, t.PartyGstinPrefix,
        t.InvoiceKind, t.SacLine, t.GpnHeader, t.DnHeader, t.LotHeader, t.FinishHeader, t.ThanHeader, t.RateHeader, t.AmountHeader, t.GrossLabel,
        t.TotalRsLabel, t.DiscountLabel, t.TaxableLabel, t.CgstLabel, t.SgstLabel, t.IgstLabel, t.TotalLabel, t.BankLine1, t.BankLine2, t.PaymentLine,
        t.Signatory, t.SignatureLabel, t.CheckedByLabel, .. t.Terms ?? [],
    ];

    [GeneratedRegex("^[0-9]{2}$")]
    private static partial Regex StateCode();
}
