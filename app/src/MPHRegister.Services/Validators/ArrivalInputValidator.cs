using FluentValidation;
using MPHRegister.Contracts.Arrivals;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Validators;

public sealed class ArrivalInputValidator : AbstractValidator<ArrivalInput>
{
    public const int MaxInwardText = 200;
    public const int MaxNote = 500;

    public ArrivalInputValidator()
    {
        RuleFor(x => x.ArrivalDate).Must(d => Dates.TryParseIso(d, out _)).WithMessage("Enter a valid date.");
        RuleFor(x => x.AawakMonth).Must(m => string.IsNullOrWhiteSpace(m) || Dates.IsValidMonth(m.Trim())).WithMessage("AAWAK month is not valid.");
        RuleFor(x => x.AawakNo).Must(n => string.IsNullOrWhiteSpace(n) || AawakNumber.TryParse(n, out _, out _))
            .WithMessage("AAWAK NO must be a number, with at most one letter after it (like 217A).");
        RuleFor(x => x.Party).Must(p => !string.IsNullOrWhiteSpace(p)).WithMessage("Choose a party.");
        RuleFor(x => x.Nag).Must(n => n is >= 1 and <= Limits.MaxQuantity).WithMessage("NAG must be 1 or more.");
        RuleFor(x => x.Transporter).Must(t => !string.IsNullOrWhiteSpace(t)).WithMessage("Choose a lorry wala.");
        RuleFor(x => x.InwardText).Must(t => (t ?? string.Empty).Length <= MaxInwardText).WithMessage("INW NO is too long.");
        RuleFor(x => x.Note).Must(t => (t ?? string.Empty).Length <= MaxNote).WithMessage("The note is too long.");
    }
}
