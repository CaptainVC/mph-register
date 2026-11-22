using System.Diagnostics;
using System.Globalization;
using MPHRegister.Services.Interfaces;
using MPHRegister.Services.Settings;
using MPHRegister.Services.Updates;
using MPHRegister.Shared.Constants;

namespace MPHRegister.Api.Hosting;

/// <summary>
/// Putting a new version in place. Windows does not let a running app overwrite its own file, so the downloaded app does it:
/// the old app starts "MPH Register.update.exe --finish-update &lt;its process id&gt; &lt;its path&gt;" and closes; the new
/// file waits for it to close, copies itself over MPH Register.exe (the old one stays as MPH Register.previous.exe) and
/// starts it in the same console window. The data folder is not touched; the new app saves a point to go back to (and
/// backs the data up) before it opens the data. Going back works the same way with a copy of the newer app
/// (MPH Register.rollback.exe --finish-rollback …).
/// </summary>
public static class SelfUpdate
{
    private static volatile bool pageSeen;

    /// <summary>The running Windows app, or null where updates cannot be installed (Mac, dotnet run, a build folder, tests).</summary>
    public static string? InstalledAppPath()
    {
        if (!OperatingSystem.IsWindows()) return null;
        var path = Environment.ProcessPath;
        if (string.IsNullOrEmpty(path) || !path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) return null;
        // A published single-file app carries its code inside the exe; a build folder has the dll next to it.
        var dll = typeof(SelfUpdate).Assembly.GetName().Name + ".dll";
        return File.Exists(Path.Combine(AppContext.BaseDirectory, dll)) ? null : path;
    }

    /// <summary>Runs the --finish-update or --finish-rollback step; returns false when the app was started normally.</summary>
    public static bool TryFinish(string[] args)
    {
        ArgumentNullException.ThrowIfNull(args);
        if (args.Length > 0 && args[0] == UpdateSource.FinishRollbackArgument) return FinishRollback(args);
        if (args.Length == 0 || args[0] != UpdateSource.FinishArgument) return false;
        if (args.Length != 3 || !int.TryParse(args[1], NumberStyles.None, CultureInfo.InvariantCulture, out var oldApp) || string.IsNullOrWhiteSpace(args[2]))
        {
            Console.Error.WriteLine($"Usage: {UpdateSource.FinishArgument} <process id> <path of MPH Register.exe>");
            return true;
        }
        var app = Path.GetFullPath(args[2]);
        Console.WriteLine("Updating MPH Register. It opens again in a few seconds…");
        WaitForExit(oldApp, TimeSpan.FromMinutes(1));
        var self = Environment.ProcessPath;
        var replaced = self is not null && UpdateSwap.Replace(self, app, attempts: 30, pause: TimeSpan.FromSeconds(1));
        if (!replaced) Console.WriteLine("The new version could not be put in place, so the app opens as it was.");
        Environment.SetEnvironmentVariable(UpdateSource.UpdateDoneVariable, replaced ? "1" : null);
        StartAgain(app);
        return true;
    }

    // --finish-rollback <process id> <app path> <data folder> keep|restore
    private static bool FinishRollback(string[] args)
    {
        if (args.Length != 5 || !int.TryParse(args[1], NumberStyles.None, CultureInfo.InvariantCulture, out var newerApp)
            || string.IsNullOrWhiteSpace(args[2]) || string.IsNullOrWhiteSpace(args[3]) || args[4] is not ("keep" or "restore"))
        {
            Console.Error.WriteLine($"Usage: {UpdateSource.FinishRollbackArgument} <process id> <path of MPH Register.exe> <data folder> keep|restore");
            return true;
        }
        var app = Path.GetFullPath(args[2]);
        Console.WriteLine("Going back to the older version of MPH Register. It opens again in a few seconds…");
        WaitForExit(newerApp, TimeSpan.FromMinutes(1));
        var done = RollbackFiles.Apply(app, Path.GetFullPath(args[3]), args[4] == "restore", InfoService.Version, DateTimeOffset.Now, attempts: 30, pause: TimeSpan.FromSeconds(1));
        if (!done) Console.WriteLine("Could not go back, so the app opens as it was.");
        Environment.SetEnvironmentVariable(UpdateSource.UpdateDoneVariable, null);
        Environment.SetEnvironmentVariable(UpdateSource.UpdatedFromVariable, null);
        StartAgain(app);
        return true;
    }

    private static void StartAgain(string app)
    {
        Environment.SetEnvironmentVariable(UpdateSource.UpdatedVariable, "1");
        var start = File.Exists(app) ? app : UpdatePaths.Previous(app);
        try
        {
            using var process = Process.Start(new ProcessStartInfo(start) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(start) ?? string.Empty });
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            Console.Error.WriteLine($"Could not start {start}: {ex.Message}. Open MPH Register again from the desktop.");
            Console.ReadLine();
        }
    }

    /// <summary>Starts the downloaded app, which waits for this one to close before it takes its place.</summary>
    public static void Launch(string staged, string app)
    {
        var start = new ProcessStartInfo(staged) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(app) ?? string.Empty };
        start.ArgumentList.Add(UpdateSource.FinishArgument);
        start.ArgumentList.Add(Environment.ProcessId.ToString(CultureInfo.InvariantCulture));
        start.ArgumentList.Add(app);
        start.Environment[UpdateSource.UpdatedFromVariable] = InfoService.Version;
        using var process = Process.Start(start) ?? throw new InvalidOperationException("The new version did not start.");
    }

    /// <summary>Starts the copy of this app that waits for it to close and then puts the older version back.</summary>
    public static void LaunchRollback(RollbackPlan plan)
    {
        ArgumentNullException.ThrowIfNull(plan);
        var start = new ProcessStartInfo(plan.Helper) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(plan.App) ?? string.Empty };
        start.ArgumentList.Add(UpdateSource.FinishRollbackArgument);
        start.ArgumentList.Add(Environment.ProcessId.ToString(CultureInfo.InvariantCulture));
        start.ArgumentList.Add(plan.App);
        start.ArgumentList.Add(plan.DataDirectory);
        start.ArgumentList.Add(plan.Restore ? "restore" : "keep");
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Going back did not start.");
    }

    /// <summary>
    /// Read once at start-up: whether an update or going back started this app, whether an update put it in place, and the
    /// version it was updated from.
    /// </summary>
    public static StartReason TakeStartReason()
    {
        var reason = new StartReason(
            Environment.GetEnvironmentVariable(UpdateSource.UpdatedVariable) == "1",
            Environment.GetEnvironmentVariable(UpdateSource.UpdateDoneVariable) == "1",
            Environment.GetEnvironmentVariable(UpdateSource.UpdatedFromVariable));
        Environment.SetEnvironmentVariable(UpdateSource.UpdatedVariable, null);
        Environment.SetEnvironmentVariable(UpdateSource.UpdateDoneVariable, null);
        Environment.SetEnvironmentVariable(UpdateSource.UpdatedFromVariable, null);
        return reason;
    }

    /// <summary>Right after an update, before the newer version opens the data: keeps a copy to go back to.</summary>
    public static void SaveRollbackPoint(StartReason reason, string dataDirectory)
    {
        ArgumentNullException.ThrowIfNull(reason);
        var app = InstalledAppPath();
        if (!reason.Updated || app is null) return;
        var previous = UpdatePaths.Previous(app);
        if (!File.Exists(previous)) return;
        var from = ReleaseVersion.TryParse(reason.FromVersion, out var given) ? given.ToString(3) : FileVersion(previous);
        try
        {
            RollbackFiles.CreatePoint(dataDirectory, from, InfoService.Version, DateTimeOffset.Now);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or Microsoft.Data.Sqlite.SqliteException)
        {
            Console.WriteLine($"Note: going back to the older version will not be possible: {ex.Message}");
        }
    }

    private static string FileVersion(string path)
    {
        try
        {
            return ReleaseVersion.TryParse(FileVersionInfo.GetVersionInfo(path).ProductVersion, out var version) ? version.ToString(3) : string.Empty;
        }
        catch (FileNotFoundException)
        {
            return string.Empty;
        }
    }

    public static void NotePageRequest() => pageSeen = true;

    /// <summary>
    /// After an update the window from before keeps asking for the app and reloads itself; a new window opens only when
    /// that one was closed in the meantime.
    /// </summary>
    public static void OpenWindowUnlessPageReturns(Uri url, TimeSpan wait) => _ = Task.Run(async () =>
    {
        await Task.Delay(wait);
        if (!pageSeen) LocalHost.OpenWindow(url);
    });

    /// <summary>Deletes the copies the update or going-back step ran from, once they have closed.</summary>
    public static void RemoveLeftovers(string? app)
    {
        if (app is null) return;
        foreach (var leftover in new[] { UpdatePaths.Staged(app), UpdatePaths.RollbackHelper(app) })
        {
            if (!File.Exists(leftover)) continue;
            _ = Task.Run(async () =>
            {
                for (var attempt = 0; attempt < 30 && File.Exists(leftover); attempt++)
                {
                    try
                    {
                        File.Delete(leftover);
                    }
                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                    {
                        await Task.Delay(TimeSpan.FromSeconds(1));
                    }
                }
            });
        }
    }

    private static void WaitForExit(int processId, TimeSpan timeout)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            process.WaitForExit(timeout);
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        {
            // Already closed.
        }
    }
}

/// <summary>Updated: started by an update step that put this app in place.</summary>
public sealed record StartReason(bool AfterUpdate, bool Updated, string? FromVersion);
