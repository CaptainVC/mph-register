using FluentValidation;
using MPHRegister.Contracts.Billing;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Validators;

public sealed record BillDates(string? BillDate, string? PeriodFrom, string? PeriodTo);

public sealed class BillDatesValidator : AbstractValidator<BillDates>
{
    public BillDatesValidator()
    {
        RuleFor(x => x.BillDate).Must(d => Dates.TryParseIso(d, out _)).WithMessage("Enter a valid bill date.");
        RuleFor(x => x).Custom((dates, context) =>
        {
            if (BillPeriodValidator.Problem(dates.PeriodFrom, dates.PeriodTo) is { } problem) context.AddFailure(problem);
        });
    }
}

/// <summary>The bill period; the bill lists the entries with an inward date inside it.</summary>
public sealed record BillPeriod(string? From, string? To);

public sealed class BillPeriodValidator : AbstractValidator<BillPeriod>
{
    public BillPeriodValidator()
    {
        RuleFor(x => x).Custom((period, context) =>
        {
            if (Problem(period.From, period.To) is { } problem) context.AddFailure(problem);
        });
    }

    internal static string? Problem(string? from, string? to)
    {
        if (!Dates.TryParseIso(from, out var start) || !Dates.TryParseIso(to, out var end)) return "Enter a valid bill period (from and to).";
        return end < start ? "Bill period 'to' date is before the 'from' date." : null;
    }
}

public sealed record BillLines(IReadOnlyList<LineDto>? Lines);

/// <summary>Rows typed or edited on a bill.</summary>
public sealed class BillLinesValidator : AbstractValidator<BillLines>
{
    public BillLinesValidator()
    {
        RuleFor(x => x.Lines).Custom((lines, context) =>
        {
            if (lines is null || lines.Count == 0)
            {
                context.AddFailure("A bill needs at least one line.");
                return;
            }
            if (lines.Count > Limits.MaxBillRows) context.AddFailure($"A bill can have at most {Limits.MaxBillRows} rows.");
            var row = 0;
            foreach (var line in lines)
            {
                row++;
                if (!Enum.IsDefined(line.Kind)) context.AddFailure($"Row {row}: unknown row type.");
                if (line.Qty is < 0 or > Limits.MaxQuantity) context.AddFailure($"Row {row}: THAN must be between 0 and 1,000,000.");
                if (line.Rate is < 0 or > Limits.MaxRate) context.AddFailure($"Row {row}: RATE must be between 0 and 100,000.");
                if (line.Rate is { } r && decimal.Round(r, 2) != r) context.AddFailure($"Row {row}: RATE can have at most 2 decimals.");
                if (new[] { line.Gpn, line.Dn, line.Lot, line.Finish }.Any(t => (t ?? string.Empty).Length > Limits.MaxBillText))
                    context.AddFailure($"Row {row}: text is too long.");
            }
            if (!lines.Any(l => l.Kind == LineKind.Priced)) context.AddFailure("A bill needs at least one priced row (with FINISH and RATE).");
        });
    }
}

public sealed record BillDiscountPct(decimal Value);

public sealed class BillDiscountPctValidator : AbstractValidator<BillDiscountPct>
{
    public BillDiscountPctValidator()
    {
        RuleFor(x => x.Value).InclusiveBetween(0, 100).WithMessage("Discount must be between 0 and 100.");
        RuleFor(x => x.Value).Must(value => decimal.Round(value, 2) == value).WithMessage("Discount can have at most 2 decimals.");
    }
}
