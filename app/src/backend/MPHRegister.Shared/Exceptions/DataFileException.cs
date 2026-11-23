namespace MPHRegister.Shared.Exceptions;

/// <summary>The data file cannot be used safely (damaged, empty, or from a newer app).</summary>
public class DataFileException : Exception
{
    public DataFileException(string message)
        : base(message)
    {
    }

    public DataFileException()
        : base("The data file cannot be used.")
    {
    }

    public DataFileException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
