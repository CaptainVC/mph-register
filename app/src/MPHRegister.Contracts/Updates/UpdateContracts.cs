namespace MPHRegister.Contracts.Updates;

/// <summary>
/// Whether a newer version is out. CanInstall is true only in the Windows app (MPH Register.exe); Checked is false when
/// nothing was asked yet (the developer's Mac and test runs do not ask GitHub on their own).
/// </summary>
public sealed record UpdateStatusDto(
    string CurrentVersion,
    string? LatestVersion,
    bool Available,
    bool CanInstall,
    bool Checked,
    string? Notes,
    string? Problem);
