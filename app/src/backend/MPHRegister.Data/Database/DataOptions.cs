using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Enums;

namespace MPHRegister.Data.Database;

public sealed class DataOptions
{
    public string DataDirectory { get; set; } = string.Empty;

    public DataFolderSource Source { get; set; } = DataFolderSource.Environment;

    public int BackupsToKeep { get; set; } = Limits.BackupsToKeep;

    public string DatabasePath => Path.Combine(DataDirectory, Formats.DataFileName);

    public string ConfigPath => Path.Combine(DataDirectory, Formats.ConfigFileName);

    public string BackupDirectory => Path.Combine(DataDirectory, "backups");
}
