using MPHRegister.Services.Settings;
using MPHRegister.Shared.Constants;

namespace MPHRegister.Services.Updates;

public sealed class UpdateOptions
{
    public Uri LatestReleaseUri { get; init; } = new(UpdateSource.LatestReleaseUrl);

    public string AssetName { get; init; } = UpdateSource.WindowsAssetName;

    /// <summary>The running Windows app (…\MPH Register.exe); null where updates cannot be installed (Mac, dotnet run, tests).</summary>
    public string? AppPath { get; init; }

    public string CurrentVersion { get; init; } = InfoService.Version;
}

/// <summary>Files next to the app: the downloaded new version and the version it replaced.</summary>
public static class UpdatePaths
{
    public static string Staged(string app) => Sibling(app, ".update.exe");

    public static string Previous(string app) => Sibling(app, ".previous.exe");

    private static string Sibling(string app, string suffix) =>
        Path.Combine(Path.GetDirectoryName(app) ?? string.Empty, Path.GetFileNameWithoutExtension(app) + suffix);
}

/// <summary>Release tags look like v0.6.0; 0.6 and 0.6.0 are the same version.</summary>
public static class ReleaseVersion
{
    public static bool TryParse(string? text, out Version version)
    {
        version = new Version(0, 0, 0);
        var trimmed = (text ?? string.Empty).Trim().TrimStart('v', 'V');
        var end = trimmed.IndexOfAny(['+', '-']);
        if (end >= 0) trimmed = trimmed[..end];
        if (!Version.TryParse(trimmed, out var parsed)) return false;
        version = new Version(parsed.Major, parsed.Minor, Math.Max(parsed.Build, 0));
        return true;
    }
}

/// <summary>
/// Puts the new app where the old one was and keeps the old one as …previous.exe. Runs once the old app has closed;
/// Windows (or an antivirus scan) can hold the old file for a moment, so moving it is retried.
/// </summary>
public static class UpdateSwap
{
    public static bool Replace(string newApp, string app, int attempts, TimeSpan pause, Action<TimeSpan>? sleep = null)
    {
        ArgumentException.ThrowIfNullOrEmpty(newApp);
        ArgumentException.ThrowIfNullOrEmpty(app);
        sleep ??= Thread.Sleep;
        var previous = UpdatePaths.Previous(app);
        var attempt = 1;
        while (File.Exists(app))
        {
            try
            {
                File.Move(app, previous, overwrite: true);
            }
            catch (Exception ex) when ((ex is IOException or UnauthorizedAccessException) && attempt < attempts)
            {
                attempt++;
                sleep(pause);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                return false;
            }
        }
        try
        {
            File.Copy(newApp, app, overwrite: false);
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Put the old app back, over any half-copied file.
            try
            {
                if (File.Exists(previous)) File.Move(previous, app, overwrite: true);
            }
            catch (Exception again) when (again is IOException or UnauthorizedAccessException)
            {
                // The old app is still there as …previous.exe.
            }
            return false;
        }
    }
}
