namespace MPHRegister.Data.Database;

/// <summary>
/// Says whether the data may have changed: the app's own commits count up, and the data file's size and last write time
/// (read with stat, never by opening the file next to SQLite) also catch a change made by another program. An answer cached
/// under a <see cref="Stamp"/> taken before its data was read is never older than the data under the same stamp.
/// </summary>
public sealed class DataRevision(DataOptions options)
{
    private readonly string run = Guid.NewGuid().ToString("N")[..8];
    private long writes;

    public void Bump() => Interlocked.Increment(ref writes);

    public string Stamp()
    {
        var file = new FileInfo(options.DatabasePath);
        var seen = file.Exists ? $"{file.Length}.{file.LastWriteTimeUtc.Ticks}" : "none";
        return $"{run}.{Interlocked.Read(ref writes)}.{seen}";
    }
}
