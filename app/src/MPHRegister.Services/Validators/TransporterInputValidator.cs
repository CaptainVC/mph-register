using FluentValidation;
using MPHRegister.Contracts.Masters;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Extensions;

namespace MPHRegister.Services.Validators;

public sealed class TransporterInputValidator : AbstractValidator<TransporterInput>
{
    private const int MaxSpellings = 20;

    public TransporterInputValidator()
    {
        RuleFor(x => x.Name).Must(n => n.NormalizeName().Length > 0).WithMessage("Lorry wala name is required.");
        RuleFor(x => x.Name).Must(n => n.NormalizeName().Length <= Limits.PartyNameMax).WithMessage($"Lorry wala name is too long ({Limits.PartyNameMax} characters at most).");
        RuleFor(x => x.OtherSpellings).Must(s => (s ?? []).Count <= MaxSpellings).WithMessage($"At most {MaxSpellings} other spellings.");
        RuleFor(x => x.OtherSpellings).Must(s => (s ?? []).All(n => n.NormalizeName().Length <= Limits.PartyNameMax)).WithMessage("An other spelling is too long.");
    }
}
