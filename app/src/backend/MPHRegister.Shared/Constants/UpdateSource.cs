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

    /// <summary>
    /// Run by a copy of the app when going back: MPH Register.rollback.exe --finish-rollback &lt;app's process id&gt;
    /// &lt;app path&gt; &lt;data folder&gt; keep|restore.
    /// </summary>
    public const string FinishRollbackArgument = "--finish-rollback";

    /// <summary>Set for the app started after an update or going back, so it reuses the open window instead of opening a second one.</summary>
    public const string UpdatedVariable = "MPH_UPDATED";

    /// <summary>Set by the update step once the new app is in place, so it saves a point to go back to before it changes any data.</summary>
    public const string UpdateDoneVariable = "MPH_UPDATE_DONE";

    /// <summary>The version that was updated from, handed to the new app.</summary>
    public const string UpdatedFromVariable = "MPH_UPDATED_FROM";

    public const long MaxDownloadBytes = 512L * 1024 * 1024;
}
