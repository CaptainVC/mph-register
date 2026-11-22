using Dapper;
using MPHRegister.Data.Database;

namespace MPHRegister.Data.Repositories;

public abstract class RepositoryBase(IDbSession session)
{
    protected IReadOnlyList<T> Query<T>(string sql, object? args = null) =>
        session.Connection.Query<T>(sql, args, session.Transaction).AsList();

    protected T? First<T>(string sql, object? args = null) =>
        session.Connection.QueryFirstOrDefault<T>(sql, args, session.Transaction);

    protected T? Scalar<T>(string sql, object? args = null) =>
        session.Connection.ExecuteScalar<T>(sql, args, session.Transaction);

    protected int Execute(string sql, object? args = null) =>
        session.Connection.Execute(sql, args, session.Transaction);
}
