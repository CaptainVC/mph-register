using FluentValidation;

namespace MPHRegister.Services.Validators;

public static class ValidationExtensions
{
    public static List<string> ErrorsFor<T>(this IValidator<T> validator, T instance)
    {
        ArgumentNullException.ThrowIfNull(validator);
        return validator.Validate(instance).Errors.Select(e => e.ErrorMessage).Distinct().ToList();
    }
}
