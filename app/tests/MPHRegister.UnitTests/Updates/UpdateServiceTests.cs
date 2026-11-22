using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MPHRegister.Services.Updates;
using MPHRegister.Shared.Exceptions;

namespace MPHRegister.UnitTests.Updates;

public sealed class UpdateServiceTests : IDisposable
{
    private static readonly Uri Latest = new("https://api.example.test/releases/latest");
    private static readonly Uri FileUrl = new("https://files.example.test/MPH-Register-win-x64.exe");
    private static readonly byte[] NewApp = Encoding.UTF8.GetBytes("pretend this is the new MPH Register.exe");

    private readonly string folder = Directory.CreateTempSubdirectory("mph-update-").FullName;

    private string AppPath => Path.Combine(folder, "MPH Register.exe");

    public void Dispose() => Directory.Delete(folder, recursive: true);

    [Theory]
    [InlineData("v0.6.0", "0.6.0")]
    [InlineData("0.6", "0.6.0")]
    [InlineData(" V1.2.3 ", "1.2.3")]
    [InlineData("v1.2.3-beta+abc", "1.2.3")]
    public void Release_tags_read_as_versions(string tag, string expected)
    {
        Assert.True(ReleaseVersion.TryParse(tag, out var version));
        Assert.Equal(expected, version.ToString(3));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("latest")]
    public void Tags_without_a_version_are_refused(string? tag) => Assert.False(ReleaseVersion.TryParse(tag, out _));

    [Fact]
    public async Task Outside_the_Windows_app_nothing_is_asked_until_the_user_checks()
    {
        using var stub = new StubHandler(_ => Release("v0.6.0"));
        using var service = Service(stub, appPath: null);

        var quiet = await service.CheckAsync(refresh: false, CancellationToken.None);
        Assert.False(quiet.Checked);
        Assert.False(quiet.Available);
        Assert.Equal(0, stub.Calls);

        var asked = await service.CheckAsync(refresh: true, CancellationToken.None);
        Assert.True(asked.Checked);
        Assert.True(asked.Available);
        Assert.False(asked.CanInstall);
        Assert.Equal("0.6.0", asked.LatestVersion);
        Assert.Equal("- Faster bills", asked.Notes);
        Assert.Equal(1, stub.Calls);
    }

    [Fact]
    public async Task The_Windows_app_asks_once_and_keeps_the_answer_for_a_few_hours()
    {
        using var stub = new StubHandler(_ => Release("v0.6.0"));
        var clock = new MovableClock(new DateTimeOffset(2026, 11, 1, 10, 0, 0, TimeSpan.Zero));
        using var service = Service(stub, AppPath, clock);

        var first = await service.CheckAsync(refresh: false, CancellationToken.None);
        Assert.True(first.Available);
        Assert.True(first.CanInstall);
        await service.CheckAsync(refresh: false, CancellationToken.None);
        Assert.Equal(1, stub.Calls);

        clock.Now = clock.Now.AddHours(7);
        await service.CheckAsync(refresh: false, CancellationToken.None);
        Assert.Equal(2, stub.Calls);

        await service.CheckAsync(refresh: true, CancellationToken.None);
        Assert.Equal(3, stub.Calls);
    }

    [Theory]
    [InlineData("v0.5.0")]
    [InlineData("v0.4.9")]
    public async Task The_same_or_an_older_release_is_not_offered(string tag)
    {
        using var stub = new StubHandler(_ => Release(tag));
        using var service = Service(stub, AppPath);
        var status = await service.CheckAsync(refresh: true, CancellationToken.None);
        Assert.True(status.Checked);
        Assert.False(status.Available);
        Assert.Null(status.Problem);
    }

    [Fact]
    public async Task A_release_without_the_Windows_file_or_with_a_plain_http_link_is_not_offered()
    {
        using var missing = new StubHandler(_ => Release("v0.6.0", assetName: "something-else.zip"));
        using var noFile = Service(missing, AppPath);
        Assert.False((await noFile.CheckAsync(refresh: true, CancellationToken.None)).Available);

        using var plain = new StubHandler(_ => Release("v0.6.0", url: new Uri("http://files.example.test/MPH-Register-win-x64.exe")));
        using var insecure = Service(plain, AppPath);
        Assert.False((await insecure.CheckAsync(refresh: true, CancellationToken.None)).Available);
    }

    [Fact]
    public async Task Problems_are_told_in_plain_words()
    {
        using var none = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound));
        using var unpublished = Service(none, AppPath);
        Assert.Equal("No version has been published yet.", (await unpublished.CheckAsync(refresh: true, CancellationToken.None)).Problem);

        using var down = new StubHandler(_ => throw new HttpRequestException("no route"));
        using var offline = Service(down, AppPath);
        Assert.Equal("Could not check for a new version. Is the internet on?", (await offline.CheckAsync(refresh: true, CancellationToken.None)).Problem);

        using var busy = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.Forbidden));
        using var limited = Service(busy, AppPath);
        Assert.Equal("GitHub did not answer (403). Try again later.", (await limited.CheckAsync(refresh: true, CancellationToken.None)).Problem);

        using var garbled = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{not json") });
        using var unreadable = Service(garbled, AppPath);
        Assert.Equal("GitHub's answer could not be read. Try again later.", (await unreadable.CheckAsync(refresh: true, CancellationToken.None)).Problem);
    }

    [Fact]
    public async Task The_new_version_is_downloaded_next_to_the_app_after_its_digest_matches()
    {
        using var stub = new StubHandler(request => request.RequestUri == FileUrl ? File(NewApp) : Release("v0.6.0"));
        using var service = Service(stub, AppPath);

        var staged = await service.DownloadAsync(CancellationToken.None);

        Assert.Equal(Path.Combine(folder, "MPH Register.update.exe"), staged);
        Assert.Equal(NewApp, await System.IO.File.ReadAllBytesAsync(staged));
        Assert.False(System.IO.File.Exists(staged + ".part"));
    }

    [Fact]
    public async Task A_damaged_download_is_thrown_away()
    {
        var damaged = NewApp.ToArray();
        damaged[0] ^= 0xFF;
        using var wrongBytes = new StubHandler(request => request.RequestUri == FileUrl ? File(damaged) : Release("v0.6.0"));
        using var service = Service(wrongBytes, AppPath);
        var error = await Assert.ThrowsAsync<AppValidationException>(() => service.DownloadAsync(CancellationToken.None));
        Assert.Equal("The downloaded file was not complete. Try again.", error.Message);

        using var shortFile = new StubHandler(request => request.RequestUri == FileUrl ? File(NewApp[..10]) : Release("v0.6.0"));
        using var cut = Service(shortFile, AppPath);
        await Assert.ThrowsAsync<AppValidationException>(() => cut.DownloadAsync(CancellationToken.None));

        Assert.Empty(Directory.GetFiles(folder));
    }

    [Fact]
    public async Task Downloads_are_refused_outside_the_Windows_app_and_when_nothing_is_newer()
    {
        using var stub = new StubHandler(_ => Release("v0.5.0"));
        using var mac = Service(stub, appPath: null);
        var outside = await Assert.ThrowsAsync<AppValidationException>(() => mac.DownloadAsync(CancellationToken.None));
        Assert.Equal("Updates install only in the Windows app (MPH Register.exe).", outside.Message);

        using var windows = Service(stub, AppPath);
        var newest = await Assert.ThrowsAsync<AppValidationException>(() => windows.DownloadAsync(CancellationToken.None));
        Assert.Equal("Version 0.5.0 is already the newest.", newest.Message);
    }

    private static UpdateService Service(StubHandler handler, string? appPath, TimeProvider? clock = null) =>
        new(new HttpClient(handler), new UpdateOptions { LatestReleaseUri = Latest, AppPath = appPath, CurrentVersion = "0.5.0" }, clock ?? TimeProvider.System);

    private static HttpResponseMessage Release(string tag, string assetName = "MPH-Register-win-x64.exe", Uri? url = null)
    {
        var json = JsonSerializer.Serialize(new
        {
            tag_name = tag,
            body = "  - Faster bills\n",
            assets = new[]
            {
                new { name = assetName, size = NewApp.Length, browser_download_url = (url ?? FileUrl).AbsoluteUri, digest = "sha256:" + Convert.ToHexStringLower(SHA256.HashData(NewApp)) },
            },
        });
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
    }

    private static HttpResponseMessage File(byte[] bytes) => new(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) };

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> answer) : HttpMessageHandler
    {
        public int Calls { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri == Latest) Calls++;
            return Task.FromResult(answer(request));
        }
    }

    private sealed class MovableClock(DateTimeOffset start) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = start;

        public override DateTimeOffset GetUtcNow() => Now;
    }
}
