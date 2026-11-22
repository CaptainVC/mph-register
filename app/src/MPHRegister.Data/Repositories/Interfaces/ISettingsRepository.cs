namespace MPHRegister.Data.Repositories.Interfaces;

public interface ISettingsRepository
{
    string? Get(string key);

    void Set(string key, string value);

    void Delete(string key);
}
