using Microsoft.Data.Sqlite;

namespace MPHRegister.Data.Database;

public interface IConnectionFactory
{
    SqliteConnection Open();
}

/// <summary>
/// Pooled connections: a request reuses an open file handle with its schema and page cache instead of opening the file again.
/// An idle pooled connection holds no lock, but it does keep the file open, so <see cref="SqliteConnection.ClearAllPools"/>
/// must run before the data file is moved, replaced or deleted (Windows refuses while a handle is open).
/// </summary>
public sealed class SqliteConnectionFactory(DataOptions options) : IConnectionFactory
{
    public SqliteConnection Open()
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = options.DatabasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = true,
            ForeignKeys = true,
        }.ToString());
        try
        {
            connection.Open();
            using var command = connection.CreateCommand();
            // Per connection, so on every open: TRUNCATE keeps one journal file instead of creating and deleting it on each
            // commit (Windows Defender scans every new file); FULL keeps every commit safe on a power cut.
            command.CommandText = "PRAGMA busy_timeout = 5000; PRAGMA journal_mode = TRUNCATE; PRAGMA synchronous = FULL;";
            command.ExecuteNonQuery();
            return connection;
        }
        catch
        {
            // A damaged file fails here (synchronous reads the header); release it or Windows keeps the file locked.
            SqliteConnection.ClearPool(connection);
            connection.Dispose();
            throw;
        }
    }
}
