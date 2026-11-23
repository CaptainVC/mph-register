using Microsoft.Data.Sqlite;

namespace MPHRegister.Data.Database;

public interface IConnectionFactory
{
    SqliteConnection Open();
}

public sealed class SqliteConnectionFactory(DataOptions options) : IConnectionFactory
{
    public SqliteConnection Open()
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = options.DatabasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
        }.ToString());
        try
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;";
            command.ExecuteNonQuery();
            return connection;
        }
        catch
        {
            // A damaged file fails here (synchronous reads the header); release it or Windows keeps the file locked.
            connection.Dispose();
            throw;
        }
    }
}
