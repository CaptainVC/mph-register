using System.Collections.Concurrent;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Primitives;

namespace MPHRegister.Api.Hosting;

/// <summary>
/// Serves the screens (app/src/frontend), putting each page together from its parts: a line holding only
/// <c>&lt;!-- include views/entry.html --&gt;</c> is replaced by that file, indented like the comment, so index.html stays a
/// short outline of the screens. Each page is put together once: the embedded files never change while the app runs.
/// </summary>
public sealed partial class PageFileProvider(IFileProvider files) : IFileProvider
{
    private const int MaxDepth = 4;
    private readonly ConcurrentDictionary<string, IFileInfo> pages = new(StringComparer.Ordinal);

    public IFileInfo GetFileInfo(string subpath)
    {
        ArgumentNullException.ThrowIfNull(subpath);
        var file = files.GetFileInfo(subpath);
        if (!file.Exists || file.IsDirectory || !subpath.EndsWith(".html", StringComparison.OrdinalIgnoreCase)) return file;
        return pages.GetOrAdd(subpath, path => new PageFile(file.Name, Encoding.UTF8.GetBytes(Compose(file, path, 0)), file.LastModified));
    }

    public IDirectoryContents GetDirectoryContents(string subpath) => files.GetDirectoryContents(subpath);

    public IChangeToken Watch(string filter) => files.Watch(filter);

    private string Compose(IFileInfo file, string path, int depth)
    {
        string text;
        using (var reader = new StreamReader(file.CreateReadStream(), Encoding.UTF8))
            text = reader.ReadToEnd();
        return Include().Replace(text, match =>
        {
            var partPath = match.Groups["path"].Value;
            if (depth >= MaxDepth) throw new InvalidOperationException($"{path} includes {partPath} too deep (an include loop?).");
            var part = files.GetFileInfo(partPath);
            if (!part.Exists || part.IsDirectory) throw new FileNotFoundException($"{path} includes {partPath}, which is not in the app.");
            var indent = match.Groups["indent"].Value;
            var lines = Compose(part, partPath, depth + 1).TrimEnd('\r', '\n').Split('\n');
            return string.Join('\n', lines.Select(line => line.Length == 0 ? line : indent + line));
        });
    }

    [GeneratedRegex(@"^(?<indent>[ \t]*)<!--\s*include\s+(?<path>[\w./-]+)\s*-->[ \t]*$", RegexOptions.Multiline, 1000)]
    private static partial Regex Include();

    private sealed class PageFile(string name, byte[] content, DateTimeOffset lastModified) : IFileInfo
    {
        public bool Exists => true;

        public long Length => content.Length;

        public string? PhysicalPath => null;

        public string Name => name;

        public DateTimeOffset LastModified => lastModified;

        public bool IsDirectory => false;

        public Stream CreateReadStream() => new MemoryStream(content, writable: false);
    }
}
