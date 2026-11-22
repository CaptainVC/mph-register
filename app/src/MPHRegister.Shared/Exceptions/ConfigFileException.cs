namespace MPHRegister.Shared.Exceptions;

/// <summary>The config file cannot be read or written; the message says what to do.</summary>
public sealed class ConfigFileException : DataFileException
{
    public ConfigFileException()
    {
    }

    public ConfigFileException(string message)
        : base(message)
    {
    }

    public ConfigFileException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
