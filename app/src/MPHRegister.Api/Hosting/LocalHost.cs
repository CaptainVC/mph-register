using System.Diagnostics;
using System.Net;
using System.Net.Sockets;

namespace MPHRegister.Api.Hosting;

public static class LocalHost
{
    public static bool IsPortInUse(int port)
    {
        try
        {
            using var listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start();
            listener.Stop();
            return false;
        }
        catch (SocketException)
        {
            return true;
        }
    }

    /// <summary>Opens the app in an Edge app window on Windows, else the default browser.</summary>
    public static void OpenWindow(Uri url)
    {
        ArgumentNullException.ThrowIfNull(url);
        try
        {
            // Browser launchers intentionally resolve via OS PATH / shell association.
#pragma warning disable S4036
            if (OperatingSystem.IsWindows())
            {
                try
                {
                    Process.Start(new ProcessStartInfo("msedge", $"--app={url.AbsoluteUri}") { UseShellExecute = true });
                }
                catch (System.ComponentModel.Win32Exception)
                {
                    Process.Start(new ProcessStartInfo(url.AbsoluteUri) { UseShellExecute = true });
                }
            }
            else if (OperatingSystem.IsMacOS())
            {
                Process.Start("open", url.AbsoluteUri);
            }
            else
            {
                Process.Start("xdg-open", url.AbsoluteUri);
            }
#pragma warning restore S4036
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            Console.WriteLine($"Open {url} in a browser.");
        }
    }
}
