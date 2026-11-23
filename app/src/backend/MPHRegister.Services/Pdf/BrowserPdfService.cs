using System.Diagnostics;
using System.Globalization;
using MPHRegister.Services.Interfaces;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Exceptions;

namespace MPHRegister.Services.Pdf;

/// <summary>
/// Prints the app's own bill page to PDF with the installed Edge (or Chrome), headless, through the DevTools protocol:
/// it waits until the page says every bill is drawn, then prints with the page's own paper size and margins.
/// Uses a throw-away browser profile; nothing leaves the computer.
/// </summary>
public sealed class BrowserPdfService : IInvoicePdfService, IDisposable
{
    private const string ReadyCheck = "document.body && document.body.dataset.ready === '1' ? 'ready' : (document.getElementById('status')?.textContent || '')";
    private readonly Lazy<string?> browser = new(FindBrowser);
    private readonly SemaphoreSlim oneAtATime = new(1, 1);
    private readonly Lock gate = new();
    private Task cleaning = Task.CompletedTask;

    public bool IsAvailable => browser.Value is not null;

    public void Dispose()
    {
        // Lets a browser still closing in the background finish, so none is left running when the app stops.
        Task pending;
        lock (gate) pending = cleaning;
        pending.Wait(TimeSpan.FromSeconds(10));
        oneAtATime.Dispose();
    }

    public async Task<byte[]> RenderAsync(Uri printPage, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(printPage);
        var executable = browser.Value ?? throw new AppValidationException("Microsoft Edge or Google Chrome is needed to make a PDF. Use Print instead.");
        if (!await oneAtATime.WaitAsync(TimeSpan.FromSeconds(Limits.PdfTimeoutSeconds), cancellationToken))
            throw new AppValidationException("Another PDF is still being made. Try again in a moment.");
        DirectoryInfo? profile = null;
        Process? process = null;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(Limits.PdfTimeoutSeconds));
        try
        {
            profile = Directory.CreateTempSubdirectory("mph-pdf-");
            process = Start(executable, profile.FullName);
            var endpoint = await WaitForEndpoint(profile.FullName, process, timeout.Token);
            await using var devTools = await DevToolsClient.ConnectAsync(endpoint, timeout.Token);
            var target = await devTools.SendAsync("Target.createTarget", new { url = "about:blank" }, null, timeout.Token);
            var attached = await devTools.SendAsync("Target.attachToTarget", new { targetId = target.GetProperty("targetId").GetString(), flatten = true }, null, timeout.Token);
            var session = attached.GetProperty("sessionId").GetString();
            await devTools.SendAsync("Page.enable", null, session, timeout.Token);
            await devTools.SendAsync("Page.navigate", new { url = printPage.AbsoluteUri }, session, timeout.Token);

            var state = string.Empty;
            for (var attempt = 0; attempt < 300 && state != "ready"; attempt++)
            {
                await Task.Delay(200, timeout.Token);
                var check = await devTools.SendAsync("Runtime.evaluate", new { expression = ReadyCheck, returnByValue = true }, session, timeout.Token);
                state = check.GetProperty("result").TryGetProperty("value", out var value) ? value.GetString() ?? string.Empty : string.Empty;
                if (state.StartsWith("Could not", StringComparison.Ordinal) || state.StartsWith("No bills", StringComparison.Ordinal))
                    throw new AppValidationException($"The bill page could not be drawn: {state}");
            }
            if (state != "ready") throw new AppValidationException("The bill page did not finish drawing. Use Print instead.");

            var pdf = await devTools.SendAsync("Page.printToPDF", new
            {
                printBackground = true,
                preferCSSPageSize = true,
                displayHeaderFooter = false,
                scale = 1,
                paperWidth = 8.5,
                paperHeight = 11,
                marginTop = 0,
                marginBottom = 0,
                marginLeft = 0,
                marginRight = 0,
            }, session, timeout.Token);
            try
            {
                using var closing = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                await devTools.SendAsync("Browser.close", null, null, closing.Token);
            }
            catch (Exception ex) when (ex is InvalidOperationException or System.Net.WebSockets.WebSocketException or OperationCanceledException)
            {
                // Best-effort graceful browser close; process is terminated in finally.
            }
            return Convert.FromBase64String(pdf.GetProperty("data").GetString() ?? string.Empty);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new AppValidationException("Making the PDF took too long. Use Print instead.");
        }
        finally
        {
            // The PDF goes back at once: the browser stops and its profile goes in the background, and the next PDF need not wait.
            oneAtATime.Release();
            var cleanup = CleanUpAsync(process, profile);
            lock (gate) cleaning = cleaning.IsCompleted ? cleanup : Task.WhenAll(cleaning, cleanup);
        }
    }

    private static async Task CleanUpAsync(Process? process, DirectoryInfo? profile)
    {
        await Task.Yield();
        if (process is not null) await StopAsync(process);
        if (profile is not null) await TryDeleteAsync(profile);
    }

    private static Process Start(string executable, string profile)
    {
        var start = new ProcessStartInfo(executable)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
        };
        foreach (var arg in new[]
        {
            "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
            "--disable-sync", "--disable-background-networking", "--disable-component-update", "--hide-scrollbars",
            "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", $"--user-data-dir={profile}", "about:blank",
        })
        {
            start.ArgumentList.Add(arg);
        }
        var process = Process.Start(start) ?? throw new AppValidationException("Could not start the browser to make the PDF.");
        process.OutputDataReceived += (_, _) => { };
        process.ErrorDataReceived += (_, _) => { };
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        return process;
    }

    /// <summary>The browser writes its DevTools port and path to DevToolsActivePort in the profile folder.</summary>
    private static async Task<Uri> WaitForEndpoint(string profile, Process process, CancellationToken cancellationToken)
    {
        var file = Path.Combine(profile, "DevToolsActivePort");
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (process.HasExited) throw new AppValidationException("The browser closed before it could make the PDF.");
            if (File.Exists(file))
            {
                var lines = (await File.ReadAllLinesAsync(file, cancellationToken)).Where(l => l.Length > 0).ToArray();
                if (lines.Length >= 2 && int.TryParse(lines[0], NumberStyles.None, CultureInfo.InvariantCulture, out var port))
                    return new Uri($"ws://127.0.0.1:{port}{lines[1]}");
            }
            await Task.Delay(100, cancellationToken);
        }
    }

    private static async Task StopAsync(Process process)
    {
        try
        {
            if (!await ExitsWithin(process, TimeSpan.FromSeconds(2))) process.Kill(entireProcessTree: true);
            await ExitsWithin(process, TimeSpan.FromSeconds(5));
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            // Process already exited, or could not be stopped (it ends with its last window).
        }
        finally
        {
            process.Dispose();
        }
    }

    private static async Task<bool> ExitsWithin(Process process, TimeSpan time)
    {
        using var wait = new CancellationTokenSource(time);
        try
        {
            await process.WaitForExitAsync(wait.Token);
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    private static string? FindBrowser()
    {
        var candidates = new List<string>();
        if (OperatingSystem.IsWindows())
        {
            foreach (var root in new[]
            {
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            }.Where(r => r.Length > 0))
            {
                candidates.Add(Path.Combine(root, "Microsoft", "Edge", "Application", "msedge.exe"));
                candidates.Add(Path.Combine(root, "Google", "Chrome", "Application", "chrome.exe"));
            }
        }
        else if (OperatingSystem.IsMacOS())
        {
            candidates.Add("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
            candidates.Add("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
            candidates.Add("/Applications/Chromium.app/Contents/MacOS/Chromium");
        }
        else
        {
            candidates.AddRange(["/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]);
        }
        return candidates.FirstOrDefault(File.Exists);
    }

    private static async Task TryDeleteAsync(DirectoryInfo directory)
    {
        for (var attempt = 0; attempt < 10; attempt++)
        {
            try
            {
                directory.Refresh();
                if (directory.Exists) directory.Delete(recursive: true);
                return;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // The browser's helper processes may still hold the profile for a moment.
                await Task.Delay(300);
            }
        }
    }
}
