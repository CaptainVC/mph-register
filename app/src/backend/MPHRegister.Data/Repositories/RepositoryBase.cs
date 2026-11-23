using System.Text.Json;
using Dapper;
using MPHRegister.Data.Database;

namespace MPHRegister.Data.Repositories;

public abstract class RepositoryBase(IDbSession session)
{
    protected IReadOnlyList<T> Query<T>(string sql, object? args = null) =>
        session.Run(() => session.Connection.Query<T>(sql, args, session.Transaction).AsList());

    protected T? First<T>(string sql, object? args = null) =>
        session.Run(() => session.Connection.QueryFirstOrDefault<T>(sql, args, session.Transaction));

    protected T? Scalar<T>(string sql, object? args = null) =>
        session.Run(() => session.Connection.ExecuteScalar<T>(sql, args, session.Transaction));

    protected int Execute(string sql, object? args = null) =>
        session.Run(() => session.Connection.Execute(sql, args, session.Transaction));

    /// <summary>A list as one JSON parameter, read with <c>IN (SELECT value FROM json_each(@list))</c>: Dapper's <c>IN @list</c>
    /// binds one parameter per value, which is slow for long lists and capped by SQLite.</summary>
    protected static string Json<T>(IEnumerable<T> values) => JsonSerializer.Serialize(values);
}
