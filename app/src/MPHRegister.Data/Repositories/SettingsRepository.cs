using MPHRegister.Data.Database;
using MPHRegister.Data.Repositories.Interfaces;

namespace MPHRegister.Data.Repositories;

public sealed class SettingsRepository(IDbSession session) : RepositoryBase(session), ISettingsRepository
{
    public string? Get(string key) => First<string>("SELECT value FROM settings WHERE key = @key;", new { key });

    public void Set(string key, string value) => Execute(
        "INSERT INTO settings(key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
        new { key, value });

    public void Delete(string key) => Execute("DELETE FROM settings WHERE key = @key;", new { key });
}
