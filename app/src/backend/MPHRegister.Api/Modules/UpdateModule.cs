using System.Net;
using MPHRegister.Api.Hosting;
using MPHRegister.Services.Interfaces;
using MPHRegister.Services.Settings;
using MPHRegister.Services.Updates;
using MPHRegister.Shared.Constants;

namespace MPHRegister.Api.Modules;

public static class UpdateModule
{
    /// <summary>releaseUrl (MPH_UPDATE_URL) replaces GitHub for tests: HTTPS, or HTTP on this computer only.</summary>
    public static IServiceCollection AddMphUpdates(this IServiceCollection services, string? releaseUrl)
    {
        services.AddSingleton(new UpdateOptions { LatestReleaseUri = ReleaseUri(releaseUrl), AppPath = SelfUpdate.InstalledAppPath() });
        services.AddSingleton<IUpdateService>(provider => new UpdateService(
            CreateClient(), provider.GetRequiredService<UpdateOptions>(), provider.GetRequiredService<TimeProvider>()));
        services.AddSingleton<IRollbackService, RollbackService>();
        return services;
    }

    public static Uri ReleaseUri(string? text) =>
        Uri.TryCreate(text?.Trim(), UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || (uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback))
            ? uri
            : new Uri(UpdateSource.LatestReleaseUrl);

    private static HttpClient CreateClient()
    {
        var client = new HttpClient(new SocketsHttpHandler
        {
            AutomaticDecompression = DecompressionMethods.All,
            PooledConnectionLifetime = TimeSpan.FromMinutes(10),
        })
        {
            Timeout = TimeSpan.FromSeconds(30),
        };
        client.DefaultRequestHeaders.UserAgent.ParseAdd($"MPH-Register/{InfoService.Version}");
        return client;
    }
}
