using System.Globalization;
using FluentValidation;
using MPHRegister.Contracts.Settings;
using MPHRegister.Data.Config;
using MPHRegister.Data.Database;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Services.Billing;
using MPHRegister.Services.Interfaces;
using MPHRegister.Services.Validators;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Exceptions;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Settings;

/// <summary>Firm details, bill rules, printed texts and display settings live in the config file; bill numbers in the data file.</summary>
public sealed class SettingsService(
    IDbSession session,
    IConfigStore config,
    ISettingsRepository settings,
    IInvoiceRepository invoices,
    BillGeometry geometry,
    IValidator<SettingsInput> validator,
    TimeProvider clock) : ISettingsService
{
    public SettingsDto Get(string? fy)
    {
        var current = config.Current;
        fy = FinancialYear.IsValid(fy) ? fy! : FinancialYear.Of(Dates.Today(clock));
        var status = config.Status;
        return new SettingsDto(current.Firm, current.BillRules, current.PrintedTexts, current.Print, current.Display, fy, NextSerial(fy),
            current.Signature is not null, Limits(current.Print),
            new ConfigFileDto(status.Path, status.LoadedAt, status.SavedAt, status.Notices, status.Problem));
    }

    public SettingsDto Save(SettingsInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var errors = validator.ErrorsFor(input);
        var current = config.Current;
        var fy = input.Fy ?? FinancialYear.Of(Dates.Today(clock));
        if (input.NextSerial is { } next && next >= 1 && FinancialYear.IsValid(fy))
        {
            var used = invoices.MaxSerial(fy);
            if (next <= used) errors.Add($"Bill number {used} is already used in {fy}; the next number must be more than {used}.");
        }
        var print = input.Print ?? current.Print;
        var rules = input.BillRules ?? current.BillRules;
        if (errors.Count == 0 && Enum.IsDefined(print.PaperSize))
        {
            var max = geometry.MaxRowsPerBill(print.PaperSize, print.SmallestFontPt);
            if (rules.RowsPerBill > max)
            {
                errors.Add($"At most {max} rows fit on a {Paper(print.PaperSize)} bill when the smallest font is {print.SmallestFontPt.ToString(CultureInfo.InvariantCulture)} pt "
                    + $"(rows get shorter as you add them, and below that they are too small to read). Choose {max} rows or fewer, A4 paper, or a smaller smallest font.");
            }
        }
        if (errors.Count > 0) throw new AppValidationException(errors);

        var before = current;
        using var unit = session.Begin();
        if (input.NextSerial is { } serial) SetNextSerial(fy, serial);
        config.Update(c => c with
        {
            Firm = input.Firm ?? c.Firm,
            BillRules = input.BillRules ?? c.BillRules,
            PrintedTexts = input.PrintedTexts ?? c.PrintedTexts,
            Print = input.Print ?? c.Print,
            Display = input.Display ?? c.Display,
        });
        try
        {
            unit.Commit();
        }
        catch
        {
            config.Save(before);
            throw;
        }
        return Get(fy);
    }

    public FirmSettings Snapshot() => FirmSnapshot.From(config.Current);

    public int NextSerial(string fy)
    {
        var stored = int.TryParse(settings.Get(SettingKeys.InvoiceNext(fy)), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : 1;
        return Math.Max(stored, invoices.MaxSerial(fy) + 1);
    }

    public void SetNextSerial(string fy, int next) =>
        settings.Set(SettingKeys.InvoiceNext(fy), next.ToString(CultureInfo.InvariantCulture));

    public (byte[] Image, string ContentType)? Signature() =>
        SignatureImage.TryDecode(config.Current.Signature, out var image, out var type) ? (image, type) : null;

    public void SaveSignature(byte[] image)
    {
        ArgumentNullException.ThrowIfNull(image);
        if (image.Length == 0 || image.Length > Shared.Constants.Limits.MaxSignatureBytes)
            throw new AppValidationException($"The signature picture must be smaller than {Shared.Constants.Limits.MaxSignatureBytes / 1024} KB.");
        if (SignatureImage.ContentType(image) is null) throw new AppValidationException("The signature must be a PNG or JPG picture.");
        config.Update(c => c with { Signature = SignatureImage.Encode(image) });
    }

    public void DeleteSignature() => config.Update(c => c with { Signature = null });

    public PrintContextDto PrintContext()
    {
        var current = config.Current;
        var index = ConfigIndex.For(current);
        string Hex(string color) => index.Hex(color) ?? color;
        return new PrintContextDto(
            FirmSnapshot.From(current),
            current.Print,
            current.PrintedTexts,
            current.Colors.ToDictionary(c => c.Name, c => c.Hex, StringComparer.OrdinalIgnoreCase),
            current.Parties.ToDictionary(p => p.Name.ToLowerInvariant(), p => Hex(p.Color), StringComparer.OrdinalIgnoreCase),
            current.Finishes.ToDictionary(f => f.Name.ToLowerInvariant(), f => Hex(f.Color), StringComparer.OrdinalIgnoreCase),
            current.Signature is not null);
    }

    public SettingsDto ReloadConfig()
    {
        config.Reload();
        return Get(null);
    }

    private PrintLimitsDto Limits(PrintSettings print) => new(
        geometry.TemplateLineRows,
        geometry.MaxRowsPerBill(PaperSize.Letter, print.SmallestFontPt),
        geometry.MaxRowsPerBill(PaperSize.A4, print.SmallestFontPt),
        geometry.MaxRowsPerBill(Enum.IsDefined(print.PaperSize) ? print.PaperSize : PaperSize.Letter, print.SmallestFontPt));

    private static string Paper(PaperSize paper) => paper == PaperSize.A4 ? "A4" : "Letter";
}
