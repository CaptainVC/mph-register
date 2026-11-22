using System.Net;
using MPHRegister.Api.Modules;
using MPHRegister.Services.Updates;
using MPHRegister.UnitTests.Api;
using static MPHRegister.UnitTests.Api.Http;

namespace MPHRegister.UnitTests.Updates;

public sealed class UpdateSwapTests : IDisposable
{
    private readonly string folder = Directory.CreateTempSubdirectory("mph-swap-").FullName;

    private string App => Path.Combine(folder, "MPH Register.exe");

    private string Previous => Path.Combine(folder, "MPH Register.previous.exe");

    private string Staged => Path.Combine(folder, "MPH Register.update.exe");

    public void Dispose() => Directory.Delete(folder, recursive: true);

    [Fact]
    public void Files_next_to_the_app_are_named_after_it()
    {
        Assert.Equal(Staged, UpdatePaths.Staged(App));
        Assert.Equal(Previous, UpdatePaths.Previous(App));
    }

    [Fact]
    public void The_new_app_takes_the_old_ones_place_and_the_old_one_is_kept()
    {
        File.WriteAllText(App, "old");
        File.WriteAllText(Previous, "older");
        File.WriteAllText(Staged, "new");

        Assert.True(UpdateSwap.Replace(Staged, App, attempts: 3, TimeSpan.Zero));

        Assert.Equal("new", File.ReadAllText(App));
        Assert.Equal("old", File.ReadAllText(Previous));
    }

    [Fact]
    public void When_the_old_app_cannot_be_moved_it_is_retried_then_left_as_it_was()
    {
        File.WriteAllText(App, "old");
        File.WriteAllText(Staged, "new");
        Directory.CreateDirectory(Previous);
        File.WriteAllText(Path.Combine(Previous, "blocker"), "x");
        var waits = 0;

        Assert.False(UpdateSwap.Replace(Staged, App, attempts: 4, TimeSpan.Zero, _ => waits++));

        Assert.Equal(3, waits);
        Assert.Equal("old", File.ReadAllText(App));
    }

    [Fact]
    public void When_the_new_app_cannot_be_copied_the_old_one_is_put_back()
    {
        File.WriteAllText(App, "old");

        Assert.False(UpdateSwap.Replace(Path.Combine(folder, "missing.exe"), App, attempts: 2, TimeSpan.Zero));

        Assert.Equal("old", File.ReadAllText(App));
        Assert.False(File.Exists(Previous));
    }

    [Theory]
    [InlineData("https://example.test/latest", "https://example.test/latest")]
    [InlineData("http://127.0.0.1:8099/latest.json", "http://127.0.0.1:8099/latest.json")]
    [InlineData("http://example.test/latest", "https://api.github.com/repos/CaptainVC/mph-register/releases/latest")]
    [InlineData("not a url", "https://api.github.com/repos/CaptainVC/mph-register/releases/latest")]
    [InlineData(null, "https://api.github.com/repos/CaptainVC/mph-register/releases/latest")]
    public void Only_https_or_this_computer_may_replace_GitHub(string? setting, string expected) =>
        Assert.Equal(new Uri(expected), UpdateModule.ReleaseUri(setting));
}

[Collection("api")]
public sealed class ApiUpdateTests
{
    [Fact]
    public async Task Outside_the_Windows_app_the_version_is_shown_and_installing_is_refused()
    {
        using var factory = new ApiFactory();
        var app = factory.App();
        var info = await app.Get("/api/info").Ok();

        var status = await app.Get("/api/updates").Ok();
        Assert.Equal(info.GetProperty("version").GetString(), status.GetProperty("currentVersion").GetString());
        Assert.False(status.GetProperty("checked").GetBoolean());
        Assert.False(status.GetProperty("canInstall").GetBoolean());
        Assert.False(status.GetProperty("available").GetBoolean());

        var errors = await app.PostAsync(new Uri("/api/updates/install", UriKind.Relative), null).Refused();
        Assert.Equal(["Updates install only in the Windows app (MPH Register.exe)."], errors);

        using var outsider = factory.CreateClient(new() { BaseAddress = new Uri("http://127.0.0.1") });
        using var refused = await outsider.PostAsync(new Uri("/api/updates/install", UriKind.Relative), null);
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);

        var rollback = await app.Get("/api/updates/rollback").Ok();
        Assert.False(rollback.GetProperty("available").GetBoolean());
        Assert.Equal(["There is no earlier version to go back to."], await app.Post("/api/updates/rollback", new { undoChanges = true }).Refused());
        using var outsiderBack = await outsider.PostAsync(new Uri("/api/updates/rollback", UriKind.Relative), null);
        Assert.Equal(HttpStatusCode.Forbidden, outsiderBack.StatusCode);
    }
}
