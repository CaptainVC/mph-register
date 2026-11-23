using Microsoft.Data.Sqlite;
using SQLitePCL;

namespace MPHRegister.Data.Database;

/// <summary>One connection per request; repositories share it and its open transaction.</summary>
public interface IDbSession : IDisposable
{
    SqliteConnection Connection { get; }

    SqliteTransaction? Transaction { get; }

    IUnitOfWork Begin(bool deferred = false);

    /// <summary>Runs a statement; outside a transaction, a statement that changed rows counts as a new data revision.</summary>
    T Run<T>(Func<T> statement);

    /// <summary>Lets SQLite refresh its query statistics (after an import); run outside a transaction.</summary>
    void Optimize();
}

public interface IUnitOfWork : IDisposable
{
    void Commit();
}

public sealed class DbSession(IConnectionFactory factory, DataRevision revision) : IDbSession
{
    private SqliteConnection? connection;

    public SqliteConnection Connection => connection ??= factory.Open();

    public SqliteTransaction? Transaction { get; private set; }

    public IUnitOfWork Begin(bool deferred = false)
    {
        if (Transaction is not null) return new NestedUnit();
        var before = Changes();
        Transaction = Connection.BeginTransaction(deferred);
        return new Unit(this, before);
    }

    public T Run<T>(Func<T> statement)
    {
        ArgumentNullException.ThrowIfNull(statement);
        if (Transaction is not null) return statement();
        var before = Changes();
        try
        {
            return statement();
        }
        finally
        {
            if (Changes() != before) revision.Bump();
        }
    }

    public void Optimize()
    {
        if (Transaction is not null) return;
        using var command = Connection.CreateCommand();
        command.CommandText = "PRAGMA optimize;";
        command.ExecuteNonQuery();
    }

    public void Dispose()
    {
        Transaction?.Dispose();
        Transaction = null;
        connection?.Dispose();
        connection = null;
    }

    private void Committed(int changesBefore)
    {
        if (Changes() != changesBefore) revision.Bump();
    }

    // Rows changed by this connection since it was opened (triggers included), so a read-only unit is not a new revision.
    private int Changes() => raw.sqlite3_total_changes(Connection.Handle);

    private sealed class Unit(DbSession session, int changesBefore) : IUnitOfWork
    {
        private bool done;

        public void Commit()
        {
            if (done) return;
            session.Transaction?.Commit();
            session.Committed(changesBefore);
            Finish();
        }

        public void Dispose()
        {
            if (!done) session.Transaction?.Rollback();
            Finish();
        }

        private void Finish()
        {
            if (done) return;
            done = true;
            session.Transaction?.Dispose();
            session.Transaction = null;
        }
    }

    private sealed class NestedUnit : IUnitOfWork
    {
        public void Commit()
        {
        }

        public void Dispose()
        {
        }
    }
}
