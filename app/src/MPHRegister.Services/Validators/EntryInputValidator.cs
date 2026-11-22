using FluentValidation;
using MPHRegister.Contracts.Entries;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Validators;

public sealed class EntryInputValidator : AbstractValidator<EntryInput>
{
    private const int MaxText = 200;

    public EntryInputValidator()
    {
        RuleFor(x => x.RegisterMonth).Must(Dates.IsValidMonth).WithMessage("Register month is missing or invalid.");
        RuleFor(x => x.InwardNo).Must(n => n is >= 0).WithMessage("Inward number must be 0 or more.");
        RuleFor(x => x.EntryDate).Must(d => Dates.TryParseIso(d, out _)).WithMessage("Enter a valid date.");
        RuleFor(x => x.Party).Must(p => !string.IsNullOrWhiteSpace(p)).WithMessage("Choose a party.");
        RuleFor(x => x.Than).Must(t => t is >= 0).WithMessage("THAN must be 0 or more.");
        RuleFor(x => x.Tp).Must(t => t is null or >= 0).WithMessage("TP cannot be negative.");
        RuleFor(x => x.TwoPart).Must(t => t is null or >= 0).WithMessage("TWO PART cannot be negative.");
        RuleFor(x => x.ShortThan).Must(t => t is null or >= 0).WithMessage("SHORT THAN cannot be negative.");
        RuleFor(x => x).Must(x => (x.Than ?? 0) + (x.Tp ?? 0) > 0).Unless(IsAllZero).WithMessage("THAN + TP must be more than 0.");
        RuleFor(x => x.DesignNo).Must(t => (t ?? string.Empty).Length <= MaxText).WithMessage("D.N. is too long.");
        RuleFor(x => x.LotNo).Must(t => (t ?? string.Empty).Length <= MaxText).WithMessage("LOT N. is too long.");
        RuleFor(x => x).Custom((input, context) =>
        {
            var dateValid = Dates.TryParseIso(input.EntryDate, out var entryDate);
            var dispatched = 0;
            var line = 0;
            foreach (var dispatch in input.Dispatches ?? [])
            {
                line++;
                if (dispatch.Qty is null or < 1) context.AddFailure($"Dispatch {line}: JAWAK NAG must be 1 or more.");
                if (string.IsNullOrWhiteSpace(dispatch.GatePass)) context.AddFailure($"Dispatch {line}: enter the gate pass number.");
                if (!Dates.TryParseIso(dispatch.Date, out var dispatchDate)) context.AddFailure($"Dispatch {line}: enter a valid date.");
                else if (dateValid && dispatchDate < entryDate) context.AddFailure($"Dispatch {line}: date is before the inward date.");
                dispatched += dispatch.Qty ?? 0;
            }
            var available = (input.Than ?? 0) + (input.Tp ?? 0) + (input.TwoPart ?? 0);
            if (dispatched > available) context.AddFailure($"Total dispatched ({dispatched}) is more than NAG + TWO PART ({available}).");
        });
    }

    /// <summary>THAN, TP and TWO PART are all 0 (or blank) and no dispatch row is given: a slip kept for its number.</summary>
    public static bool IsAllZero(EntryInput input) =>
        AllZeroSlip.Is(input.Than ?? 0, input.Tp ?? 0, input.TwoPart ?? 0, input.Dispatches?.Count ?? 0);
}
