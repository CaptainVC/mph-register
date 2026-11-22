using System.Globalization;
using MPHRegister.Data.Database;
using MPHRegister.Shared.Enums;

namespace MPHRegister.Api.Configuration;

/// <summary>Start-up settings, all optional: MPH_PORT, MPH_DATA_DIR, MPH_NO_BROWSER=1 and MPH_UPDATE_URL (tests only).</summary>
public sealed class AppOptions
{
    public const int DefaultPort = 5151;

    public int Port { get; init; } = DefaultPort;

    public string DataDirectory { get; init; } = string.Empty;

    public DataFolderSource DataFolderSource { get; init; } = DataFolderSource.Environment;

    public bool OpenBrowser { get; init; } = true;

    /// <summary>Where to look for a new version instead of GitHub (the update test serves a release on this computer).</summary>
    public string? UpdateUrl { get; init; }

    public Uri BaseUri => new($"http://127.0.0.1:{Port}");

    public static AppOptions FromEnvironment()
    {
        var port = int.TryParse(Environment.GetEnvironmentVariable("MPH_PORT"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var custom)
            && custom is > 1024 and < 65536 ? custom : DefaultPort;
        var (folder, source) = DataFolder.Resolve(
            Environment.GetEnvironmentVariable("MPH_DATA_DIR"),
            AppContext.BaseDirectory,
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments));
        return new AppOptions
        {
            Port = port,
            DataDirectory = folder,
            DataFolderSource = source,
            OpenBrowser = Environment.GetEnvironmentVariable("MPH_NO_BROWSER") != "1",
            UpdateUrl = Environment.GetEnvironmentVariable("MPH_UPDATE_URL"),
        };
    }
}
