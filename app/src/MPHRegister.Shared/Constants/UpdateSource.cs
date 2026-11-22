namespace MPHRegister.Shared.Constants;

/// <summary>
/// New versions come from the latest release of the public GitHub repository (made by .github/workflows/release.yml).
/// </summary>
public static class UpdateSource
{
    // The one place the address of the releases is kept.
#pragma warning disable S1075
    public const string LatestReleaseUrl = "https://api.github.com/repos/CaptainVC/mph-register/releases/latest";
#pragma warning restore S1075

    public const string WindowsAssetName = "MPH-Register-win-x64.exe";

    /// <summary>Run by the downloaded app: MPH Register.update.exe --finish-update &lt;old app's process id&gt; &lt;app path&gt;.</summary>
    public const string FinishArgument = "--finish-update";

    /// <summary>Set for the app started after an update, so it reuses the open window instead of opening a second one.</summary>
    public const string UpdatedVariable = "MPH_UPDATED";

    public const long MaxDownloadBytes = 512L * 1024 * 1024;
}
