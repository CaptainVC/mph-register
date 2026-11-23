using System.Net;
using System.Text.RegularExpressions;
using Microsoft.Extensions.FileProviders;
using MPHRegister.Api.Configuration;
using MPHRegister.Api.Hosting;
using MPHRegister.Api.Modules;
using MPHRegister.UnitTests.TestSupport;

namespace MPHRegister.UnitTests.Api;

/// <summary>The embedded screens (app/src/frontend): every embedded file, as served paths like "/js/main.js".</summary>
internal static class WebPages
{
    public static IReadOnlyList<string> Files()
    {
        var files = new List<string>();
        void Walk(IFileProvider provider, string folder)
        {
            foreach (var item in provider.GetDirectoryContents(folder))
            {
                var path = $"{folder.TrimEnd('/')}/{item.Name}";
                if (item.IsDirectory) Walk(provider, path);
                else files.Add(path);
            }
        }
        Walk(ApiModule.WebFiles(), "/");
        return files;
    }
}

[Collection("api")]
public sealed partial class ApiWebPagesTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly string[] Pages = ["/", "/print.html", "/print-aawak.html"];

    [Fact]
    public async Task The_main_page_is_put_together_from_its_views()
    {
        var html = await factory.App().GetStringAsync(new Uri("/", UriKind.Relative));
        Assert.DoesNotContain("<!-- include", html, StringComparison.Ordinal);
        foreach (var id in new[] { "view-entry", "view-register", "view-aawak", "view-partywise", "view-bills", "view-dashboard", "view-masters", "view-settings", "view-import", "sideMenu", "appDialog", "updateDialog" })
            Assert.Contains($"id=\"{id}\"", html, StringComparison.Ordinal);
        Assert.Contains("\n    <section id=\"view-register\" class=\"view fit\">\n      <div class=\"register-panel\">", html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Every_script_stylesheet_and_icon_the_pages_load_is_served()
    {
        var app = factory.App();
        var loaded = new List<string>();
        foreach (var page in Pages)
        {
            var html = await app.GetStringAsync(new Uri(page, UriKind.Relative));
            loaded.AddRange(Linked().Matches(html).Select(m => "/" + m.Groups["path"].Value));
        }
        var css = await app.GetStringAsync(new Uri("/css/app.css", UriKind.Relative));
        loaded.AddRange(Imported().Matches(css).Select(m => "/css/" + m.Groups["path"].Value));
        Assert.Contains("/css/layout/laptop.css", loaded);
        foreach (var path in loaded.Distinct())
        {
            using var response = await app.GetAsync(new Uri(path, UriKind.Relative));
            Assert.True(response.StatusCode == HttpStatusCode.OK, $"{path}: {(int)response.StatusCode}");
        }

        // Every script and stylesheet in the app is loaded by a page: none is left over, forgotten in a split.
        var unused = WebPages.Files().Where(f => f.EndsWith(".js", StringComparison.Ordinal) || f.EndsWith(".css", StringComparison.Ordinal)).Except(loaded).ToList();
        Assert.Empty(unused);
    }

    [Fact]
    public void Every_screen_file_stays_short()
    {
        var sources = new ManifestEmbeddedFileProvider(typeof(AppOptions).Assembly, "wwwroot");
        foreach (var path in WebPages.Files().Where(f => Path.GetExtension(f) is ".html" or ".js" or ".css" or ".json"))
        {
            using var reader = new StreamReader(sources.GetFileInfo(path).CreateReadStream());
            var lines = reader.ReadToEnd().Count(c => c == '\n');
            Assert.True(lines <= 600, $"{path} has {lines} lines; split it (see app/src/frontend).");
        }
    }

    [Fact]
    public void An_include_is_indented_like_its_comment_and_a_missing_part_is_reported()
    {
        using var folder = Make.Folder();
        Directory.CreateDirectory(folder.File("views"));
        File.WriteAllText(folder.File("page.html"), "<body>\n  <!-- include views/part.html -->\n</body>\n");
        File.WriteAllText(folder.File("views/part.html"), "<div>\n  <p>Hi</p>\n</div>\n");
        File.WriteAllText(folder.File("broken.html"), "<!-- include views/none.html -->\n");
        using var physical = new PhysicalFileProvider(folder.Path);
        var pages = new PageFileProvider(physical);

        using var reader = new StreamReader(pages.GetFileInfo("/page.html").CreateReadStream());
        Assert.Equal("<body>\n  <div>\n    <p>Hi</p>\n  </div>\n</body>\n", reader.ReadToEnd());
        Assert.Equal("<div>\n  <p>Hi</p>\n</div>\n".Length, pages.GetFileInfo("/views/part.html").Length);
        Assert.Contains("views/none.html", Assert.Throws<FileNotFoundException>(() => pages.GetFileInfo("/broken.html")).Message, StringComparison.Ordinal);
    }

    [GeneratedRegex(@"(?:src|href)=""(?<path>(?:js|css|assets)/[^""]+)""")]
    private static partial Regex Linked();

    [GeneratedRegex(@"@import url\(""(?<path>[^""]+)""\)")]
    private static partial Regex Imported();
}
