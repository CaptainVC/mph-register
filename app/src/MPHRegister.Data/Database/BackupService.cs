using Microsoft.Data.Sqlite;
using MPHRegister.Shared.Constants;

namespace MPHRegister.Data.Database;

public interface IBackupService
{
    string Backup(SqliteConnection connection, string reason);
}

public sealed class BackupService(DataOptions options) : IBackupService
{
    public string Backup(SqliteConnection connection, string reason)
    {
        ArgumentNullException.ThrowIfNull(connection);
        Directory.CreateDirectory(options.BackupDirectory);
        var target = Path.Combine(options.BackupDirectory, $"mph-data-{DateTime.Now.ToString(Formats.BackupStamp, System.Globalization.CultureInfo.InvariantCulture)}-{reason}.db");
        using (var command = connection.CreateCommand())
        {
            command.CommandText = "VACUUM INTO $target;";
            command.Parameters.AddWithValue("$target", target);
            command.ExecuteNonQuery();
        }
        foreach (var old in Directory.GetFiles(options.BackupDirectory, "mph-data-*.db").OrderByDescending(f => f, StringComparer.Ordinal).Skip(options.BackupsToKeep))
        {
            File.Delete(old);
        }
        return target;
    }
}
