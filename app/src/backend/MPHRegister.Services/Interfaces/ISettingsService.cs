using MPHRegister.Contracts.Settings;

namespace MPHRegister.Services.Interfaces;

public interface ISettingsService
{
    SettingsDto Get(string? fy);

    SettingsDto Save(SettingsInput input);

    /// <summary>Current firm details and bill rules, as copied onto a new bill.</summary>
    FirmSettings Snapshot();

    int NextSerial(string fy);

    void SetNextSerial(string fy, int next);

    (byte[] Image, string ContentType)? Signature();

    void SaveSignature(byte[] image);

    void DeleteSignature();

    PrintContextDto PrintContext();

    SettingsDto ReloadConfig();
}
