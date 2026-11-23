using FluentValidation;
using MPHRegister.Contracts.Masters;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Validators;

/// <summary>Checks that need no lists; the service checks names, styles and colours against the config file.</summary>
public sealed class PartyInputValidator : AbstractValidator<PartyInput>
{
    public PartyInputValidator()
    {
        RuleFor(x => x.Name).Must(n => n.NormalizeName().Length > 0).WithMessage("Party name is required.");
        RuleFor(x => x.Name).Must(n => n.NormalizeName().Length <= Limits.PartyNameMax).WithMessage($"Party name is too long ({Limits.PartyNameMax} characters at most).");
        RuleFor(x => x.Gstin).Custom((gstin, context) =>
        {
            var clean = Gstin.Clean(gstin);
            if (clean.Length > 0 && !Gstin.IsValid(clean))
                context.AddFailure($"GSTIN \"{clean}\" is not valid. It must be 15 characters, like 08ABCDE1234F1Z5, with a correct last check character.");
        });
        RuleFor(x => x.Discount).Must(d => d is null or (>= 0 and <= 100)).WithMessage("Discount must be between 0 and 100.");
        RuleFor(x => x.Discount).Must(d => d is null || decimal.Round(d.Value, 2) == d.Value).WithMessage("Discount can have at most 2 decimals.");
        RuleFor(x => x.Address).Must(t => (t ?? string.Empty).Length <= Limits.ConfigTextMax).WithMessage("Address is too long.");
        RuleFor(x => x.State).Must(t => (t ?? string.Empty).Length <= 100).WithMessage("State is too long.");
        RuleFor(x => x.SisterGroup).Must(t => t.NormalizeName().Length <= Limits.PartyNameMax).WithMessage("Sister-firm group name is too long.");
    }
}

public sealed class SisterGroupInputValidator : AbstractValidator<SisterGroupInput>
{
    public SisterGroupInputValidator()
    {
        RuleFor(x => x.Name).Must(n => n.NormalizeName().Length > 0).WithMessage("Sister-firm group name is required.");
        RuleFor(x => x.Name).Must(n => n.NormalizeName().Length <= Limits.PartyNameMax).WithMessage($"Sister-firm group name is too long ({Limits.PartyNameMax} characters at most).");
        RuleFor(x => x.Parties).Must(p => (p ?? []).Any(n => n.NormalizeName().Length > 0)).WithMessage("Choose at least one party for the group.");
    }
}

public sealed class RateInputValidator : AbstractValidator<RateInput>
{
    public RateInputValidator()
    {
        RuleFor(x => x.Party).Must(p => p.NormalizeName().Length > 0).WithMessage("Choose the party.");
        RuleFor(x => x.Finish).Must(f => f.NormalizeName().Length > 0).WithMessage("Choose the finish.");
        RuleFor(x => x.Rate).Must(r => r is > 0 and <= Limits.MaxRate)
            .WithMessage($"Rate must be more than 0 and at most {IndianNumbers.Format(Limits.MaxRate)}.");
        RuleFor(x => x.Rate).Must(r => r is null || decimal.Round(r.Value, 2) == r.Value).WithMessage("Rate can have at most 2 decimals.");
    }
}
