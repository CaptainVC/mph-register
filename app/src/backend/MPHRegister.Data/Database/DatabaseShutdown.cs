using Microsoft.Data.Sqlite;

namespace MPHRegister.Data.Database;

public static class DatabaseShutdown
{
    /// <summary>On a clean stop: refreshes SQLite's query statistics, then closes every pooled connection so the file is free.</summary>
    public static void Close(IConnectionFactory factory)
    {
        ArgumentNullException.ThrowIfNull(factory);
        try
        {
            using var connection = factory.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "PRAGMA optimize;";
            command.ExecuteNonQuery();
        }
        catch (Exception ex) when (ex is SqliteException or IOException or UnauthorizedAccessException)
        {
            // Statistics are only a hint for the query planner; the next clean stop tries again.
        }
        finally
        {
            SqliteConnection.ClearAllPools();
        }
    }
}
