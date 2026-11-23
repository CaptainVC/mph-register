using Microsoft.Data.Sqlite;

namespace MPHRegister.Data.Database;

/// <summary>One connection per request; repositories share it and its open transaction.</summary>
public interface IDbSession : IDisposable
{
    SqliteConnection Connection { get; }

    SqliteTransaction? Transaction { get; }

    IUnitOfWork Begin(bool deferred = false);
}

public interface IUnitOfWork : IDisposable
{
    void Commit();
}

public sealed class DbSession(IConnectionFactory factory) : IDbSession
{
    private SqliteConnection? connection;

    public SqliteConnection Connection => connection ??= factory.Open();

    public SqliteTransaction? Transaction { get; private set; }

    public IUnitOfWork Begin(bool deferred = false)
    {
        if (Transaction is not null) return new NestedUnit();
        Transaction = Connection.BeginTransaction(deferred);
        return new Unit(this);
    }

    public void Dispose()
    {
        Transaction?.Dispose();
        Transaction = null;
        connection?.Dispose();
        connection = null;
    }

    private sealed class Unit(DbSession session) : IUnitOfWork
    {
        private bool done;

        public void Commit()
        {
            session.Transaction?.Commit();
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
