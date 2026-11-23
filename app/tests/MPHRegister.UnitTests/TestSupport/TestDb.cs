using Microsoft.Data.Sqlite;

namespace MPHRegister.UnitTests.TestSupport;

/// <summary>
/// A test's own connection to the data file of a running app. It uses the app's journal mode: on Windows the app's pooled
/// connections keep the TRUNCATE journal open, so a connection in the default DELETE mode could not delete it after a
/// write ("disk I/O error").
/// </summary>
public static class TestDb
{
    public static SqliteConnection Open(string dataDirectory)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(dataDirectory, "mph-data.db"), Pooling = false,
        }.ToString());
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA busy_timeout = 5000; PRAGMA journal_mode = TRUNCATE;";
        command.ExecuteNonQuery();
        return connection;
    }
}
