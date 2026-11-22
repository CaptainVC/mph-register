using System.Diagnostics;
using System.Globalization;
using MPHRegister.Services.Updates;
using MPHRegister.Shared.Constants;

namespace MPHRegister.Api.Hosting;

/// <summary>
/// Putting a new version in place. Windows does not let a running app overwrite its own file, so the downloaded app does it:
/// the old app starts "MPH Register.update.exe --finish-update &lt;its process id&gt; &lt;its path&gt;" and closes; the new
/// file waits for it to close, copies itself over MPH Register.exe (the old one stays as MPH Register.previous.exe) and
/// starts it in the same console window. The data folder is not touched; the new app backs it up when it starts.
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

    /// <summary>Runs the --finish-update step; returns false when the app was started normally.</summary>
    public static bool TryFinish(string[] args)
    {
        ArgumentNullException.ThrowIfNull(args);
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
        return true;
    }

    /// <summary>Starts the downloaded app, which waits for this one to close before it takes its place.</summary>
    public static void Launch(string staged, string app)
    {
        var start = new ProcessStartInfo(staged) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(app) ?? string.Empty };
        start.ArgumentList.Add(UpdateSource.FinishArgument);
        start.ArgumentList.Add(Environment.ProcessId.ToString(CultureInfo.InvariantCulture));
        start.ArgumentList.Add(app);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("The new version did not start.");
    }

    /// <summary>True (once) for the app started by an update.</summary>
    public static bool TakeUpdatedFlag()
    {
        var updated = Environment.GetEnvironmentVariable(UpdateSource.UpdatedVariable) == "1";
        if (updated) Environment.SetEnvironmentVariable(UpdateSource.UpdatedVariable, null);
        return updated;
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

    /// <summary>Deletes the downloaded copy once the update step that ran from it has closed.</summary>
    public static void RemoveLeftovers(string? app)
    {
        if (app is null) return;
        var staged = UpdatePaths.Staged(app);
        if (!File.Exists(staged)) return;
        _ = Task.Run(async () =>
        {
            for (var attempt = 0; attempt < 30 && File.Exists(staged); attempt++)
            {
                try
                {
                    File.Delete(staged);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    await Task.Delay(TimeSpan.FromSeconds(1));
                }
            }
        });
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
