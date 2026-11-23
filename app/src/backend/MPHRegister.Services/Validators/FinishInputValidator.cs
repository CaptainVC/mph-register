using FluentValidation;
using MPHRegister.Contracts.Masters;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Extensions;

namespace MPHRegister.Services.Validators;

public sealed class FinishInputValidator : AbstractValidator<FinishInput>
{
    public FinishInputValidator()
    {
        RuleFor(x => x.Name).Must(n => n.NormalizeName().Length > 0).WithMessage("Finish name is required.");
        RuleFor(x => x.Name).Must(n => n.NormalizeName().Length <= Limits.FinishNameMax).WithMessage($"Finish name is too long ({Limits.FinishNameMax} characters at most).");
        RuleFor(x => x.Fallback).Must(f => f is null || f.Count <= Limits.MaxFallbacks).WithMessage($"A finish can fall back to at most {Limits.MaxFallbacks} other finishes.");
        RuleFor(x => x).Must(x => !(x.Fallback ?? []).Any(f => string.Equals(f.NormalizeName(), x.Name.NormalizeName(), StringComparison.OrdinalIgnoreCase)))
            .WithMessage("A finish cannot fall back to itself.");
    }
}

public sealed class GroupInputValidator : AbstractValidator<GroupInput>
{
    public GroupInputValidator()
    {
        RuleFor(x => x.Name).Must(n => n.NormalizeName().Length > 0).WithMessage("Group name is required.");
        RuleFor(x => x.Name).Must(n => n.NormalizeName().Length <= Limits.FinishNameMax).WithMessage($"Group name is too long ({Limits.FinishNameMax} characters at most).");
    }
}

public sealed class StyleInputValidator : AbstractValidator<StyleInput>
{
    public StyleInputValidator()
    {
        RuleFor(x => x.Name).Must(n => n.NormalizeName().Length > 0).WithMessage("Style name is required.");
        RuleFor(x => x.Name).Must(n => n.NormalizeName().Length <= Limits.StyleNameMax).WithMessage($"Style name is too long ({Limits.StyleNameMax} characters at most).");
        RuleFor(x => x.Description).Must(d => (d ?? string.Empty).Length <= Limits.ConfigTextMax).WithMessage("Description is too long.");
        RuleFor(x => x).Must(x => Enum.IsDefined(x.GpnColumn) && Enum.IsDefined(x.DnColumn) && Enum.IsDefined(x.LotColumn) && Enum.IsDefined(x.Lines) && Enum.IsDefined(x.Order))
            .WithMessage("Billing style has an unknown option.");
        RuleFor(x => x).Must(x => !(x.GpnColumn == ColumnContent.Blank && x.DnColumn == ColumnContent.Blank && x.LotColumn == ColumnContent.Blank))
            .WithMessage("Choose at least one of G.P.N., D.N. or LOT NO. to show on the bill.");
    }
}

public sealed class ColorInputValidator : AbstractValidator<ColorInput>
{
    public ColorInputValidator()
    {
        RuleFor(x => x.Name).Must(n => n.NormalizeName().Length > 0).WithMessage("Colour name is required.");
        RuleFor(x => x.Name).Must(n => n.NormalizeName().Length <= Limits.ColorNameMax).WithMessage($"Colour name is too long ({Limits.ColorNameMax} characters at most).");
        RuleFor(x => x.Name).Must(n => !(n ?? string.Empty).Trim().StartsWith('#')).WithMessage("A colour name cannot start with #.");
        RuleFor(x => x.Hex).Must(h => ConfigNormalizer.IsHexColor((h ?? string.Empty).Trim().ToLowerInvariant())).WithMessage("Pick the colour (like #1f4e79).");
    }
}
