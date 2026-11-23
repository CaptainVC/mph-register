namespace MPHRegister.Shared.Exceptions;

/// <summary>Input or business-rule problems the user can fix; shown as a list.</summary>
public sealed class AppValidationException : Exception
{
    public AppValidationException(IEnumerable<string> errors)
        : base(string.Join(" ", errors))
    {
        Errors = errors.ToList();
    }

    public AppValidationException(string error)
        : this([error])
    {
    }

    public AppValidationException()
        : this("The request is not valid.")
    {
    }

    public AppValidationException(string message, Exception innerException)
        : base(message, innerException)
    {
        Errors = [message];
    }

    public IReadOnlyList<string> Errors { get; }
}
