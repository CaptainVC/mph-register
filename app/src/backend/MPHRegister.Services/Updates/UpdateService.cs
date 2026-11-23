using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using MPHRegister.Contracts.Updates;
using MPHRegister.Services.Interfaces;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Exceptions;

namespace MPHRegister.Services.Updates;

/// <summary>
/// Asks GitHub for the latest release of the public repository (no account or token needed) and downloads its Windows app.
/// The download is checked against the size and SHA-256 digest GitHub lists for the file before it is used.
/// </summary>
public sealed class UpdateService(HttpClient http, UpdateOptions options, TimeProvider clock) : IUpdateService, IDisposable
{
    private const string NotWindowsApp = "Updates install only in the Windows app (MPH Register.exe).";
    private const string Offline = "Could not check for a new version. Is the internet on?";
    private const string DownloadFailed = "Could not download the new version. Check the internet and try again.";
    private const string Damaged = "The downloaded file was not complete. Try again.";
    private static readonly TimeSpan KeepAnswer = TimeSpan.FromHours(6);
    private static readonly TimeSpan KeepProblem = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan DownloadLimit = TimeSpan.FromMinutes(30);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly SemaphoreSlim checking = new(1, 1);
    private readonly SemaphoreSlim downloading = new(1, 1);
    private UpdateStatusDto? last;
    private DateTimeOffset lastAt;

    public async Task<UpdateStatusDto> CheckAsync(bool refresh, CancellationToken cancellationToken)
    {
        // Only the Windows app asks GitHub by itself; elsewhere (the developer's Mac, tests) only when asked to.
        if (!refresh && options.AppPath is null) return Status(null, null, null, isChecked: false);
        await checking.WaitAsync(cancellationToken);
        try
        {
            if (!refresh && last is not null && clock.GetUtcNow() - lastAt < (last.Problem is null ? KeepAnswer : KeepProblem)) return last;
            var (status, _) = await LatestAsync(cancellationToken);
            last = status;
            lastAt = clock.GetUtcNow();
            return status;
        }
        finally
        {
            checking.Release();
        }
    }

    public async Task<string> DownloadAsync(CancellationToken cancellationToken)
    {
        var app = options.AppPath ?? throw new AppValidationException(NotWindowsApp);
        if (!await downloading.WaitAsync(0, cancellationToken)) throw new AppValidationException("The new version is already being downloaded.");
        try
        {
            var (status, asset) = await LatestAsync(cancellationToken);
            if (status.Problem is not null) throw new AppValidationException(status.Problem);
            if (!status.Available || asset is null) throw new AppValidationException($"Version {status.CurrentVersion} is already the newest.");
            using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            limit.CancelAfter(DownloadLimit);
            return await SaveAsync(asset, UpdatePaths.Staged(app), limit.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new AppValidationException(DownloadFailed);
        }
        finally
        {
            downloading.Release();
        }
    }

    public void Dispose()
    {
        checking.Dispose();
        downloading.Dispose();
    }

    private async Task<(UpdateStatusDto Status, Asset? Asset)> LatestAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, options.LatestReleaseUri);
            request.Headers.Accept.ParseAdd("application/vnd.github+json");
            using var response = await http.SendAsync(request, cancellationToken);
            if (response.StatusCode == HttpStatusCode.NotFound) return (Status(null, null, "No version has been published yet."), null);
            if (!response.IsSuccessStatusCode) return (Status(null, null, $"GitHub did not answer ({(int)response.StatusCode}). Try again later."), null);
            var release = await response.Content.ReadFromJsonAsync<Release>(Json, cancellationToken);
            if (release is null || !ReleaseVersion.TryParse(release.TagName, out var latest))
                return (Status(null, null, "The newest release has no version number."), null);
            var notes = string.IsNullOrWhiteSpace(release.Body) ? null : release.Body.Trim();
            if (notes is { Length: > 2000 }) notes = notes[..2000] + "…";
            var asset = release.Assets?.FirstOrDefault(a => a.Name == options.AssetName && a.Size is > 0 and <= UpdateSource.MaxDownloadBytes && IsAllowed(a.BrowserDownloadUrl));
            return (Status(asset is null ? null : latest, notes, null), asset);
        }
        catch (HttpRequestException)
        {
            return (Status(null, null, Offline), null);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return (Status(null, null, Offline), null);
        }
        catch (JsonException)
        {
            return (Status(null, null, "GitHub's answer could not be read. Try again later."), null);
        }
    }

    private async Task<string> SaveAsync(Asset asset, string target, CancellationToken cancellationToken)
    {
        var part = target + ".part";
        try
        {
            using var response = await http.GetAsync(asset.BrowserDownloadUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!response.IsSuccessStatusCode) throw new AppValidationException(DownloadFailed);
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            long total = 0;
            await using (var source = await response.Content.ReadAsStreamAsync(cancellationToken))
            await using (var file = new FileStream(part, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true))
            {
                var buffer = new byte[81920];
                int read;
                while ((read = await source.ReadAsync(buffer, cancellationToken)) > 0)
                {
                    total += read;
                    if (total > asset.Size) throw new AppValidationException(Damaged);
                    hash.AppendData(buffer, 0, read);
                    await file.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                }
            }
            if (total != asset.Size) throw new AppValidationException(Damaged);
            var digest = "sha256:" + Convert.ToHexStringLower(hash.GetHashAndReset());
            if (asset.Digest is not null && !string.Equals(asset.Digest, digest, StringComparison.OrdinalIgnoreCase)) throw new AppValidationException(Damaged);
            File.Move(part, target, overwrite: true);
            return target;
        }
        catch (HttpRequestException)
        {
            throw new AppValidationException(DownloadFailed);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new AppValidationException($"Could not save the new version next to the app: {ex.Message}");
        }
        finally
        {
            TryDelete(part);
        }
    }

    private UpdateStatusDto Status(Version? latest, string? notes, string? problem, bool isChecked = true)
    {
        var current = ReleaseVersion.TryParse(options.CurrentVersion, out var parsed) ? parsed : null;
        var available = latest is not null && current is not null && latest > current;
        return new UpdateStatusDto(options.CurrentVersion, latest?.ToString(3), available, options.AppPath is not null, isChecked, notes, problem);
    }

    // The file comes over HTTPS; plain HTTP only from this computer (the update test serves a release locally).
    private bool IsAllowed(Uri? url) =>
        url is { IsAbsoluteUri: true } && (url.Scheme == Uri.UriSchemeHttps || (url.Scheme == Uri.UriSchemeHttp && url.IsLoopback && options.LatestReleaseUri.IsLoopback));

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // A leftover part file is replaced by the next download.
        }
    }

    private sealed record Release(
        [property: JsonPropertyName("tag_name")] string? TagName,
        string? Body,
        IReadOnlyList<Asset>? Assets);

    private sealed record Asset(
        string? Name,
        long Size,
        [property: JsonPropertyName("browser_download_url")] Uri? BrowserDownloadUrl,
        string? Digest);
}
