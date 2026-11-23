using System.Buffers.Binary;
using System.Text.Json;

namespace MPHRegister.Data.Database;

/// <summary>
/// The data file as it was when the start-up check passed and its "start" backup was made: size, last write time and SQLite's
/// change counter, noted in backups/start-check.json. A start that finds the file exactly so, with that backup still the newest
/// one, skips both, as the backup already holds this data. Any doubt (no note, a different file, a newer or missing backup, a
/// journal left by a crash) means the full check and a new backup.
/// </summary>
internal static class StartCheck
{
    private const string FileName = "start-check.json";

    public static bool Unchanged(DataOptions options)
    {
        try
        {
            var notePath = Path.Combine(options.BackupDirectory, FileName);
            if (!File.Exists(notePath)) return false;
            var note = JsonSerializer.Deserialize<Note>(File.ReadAllText(notePath));
            if (note is null || note.Counter < 0 || string.IsNullOrEmpty(note.Backup)) return false;
            foreach (var leftover in new[] { "-journal", "-wal" })
            {
                var path = options.DatabasePath + leftover;
                if (File.Exists(path) && new FileInfo(path).Length > 0) return false;
            }
            var data = new FileInfo(options.DatabasePath);
            if (!data.Exists || data.Length != note.Size || data.LastWriteTimeUtc.Ticks != note.WrittenUtcTicks) return false;
            if (FileCounter(options.DatabasePath) != note.Counter) return false;
            var newest = Directory.GetFiles(options.BackupDirectory, "mph-data-*.db").Select(Path.GetFileName).Max(StringComparer.Ordinal);
            var backup = new FileInfo(Path.Combine(options.BackupDirectory, note.Backup));
            return string.Equals(newest, note.Backup, StringComparison.Ordinal) && backup.Exists && backup.Length > 0;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            return false;
        }
    }

    /// <summary>
    /// The data file as it is after the start-up check, before the app opens it. Read while no connection of this process
    /// holds a lock on the file: on macOS and Linux closing any other handle to it drops SQLite's locks.
    /// </summary>
    public static (long Size, long WrittenUtcTicks, long Counter) Take(DataOptions options)
    {
        var data = new FileInfo(options.DatabasePath);
        return (data.Length, data.LastWriteTimeUtc.Ticks, FileCounter(options.DatabasePath));
    }

    /// <summary>Notes the data file as <see cref="Take"/> found it, once the backup made from it is there.</summary>
    public static void Record(DataOptions options, (long Size, long WrittenUtcTicks, long Counter) file, string backup)
    {
        var notePath = Path.Combine(options.BackupDirectory, FileName);
        try
        {
            var note = new Note(file.Size, file.WrittenUtcTicks, file.Counter, Path.GetFileName(backup));
            var temp = notePath + ".saving";
            File.WriteAllText(temp, JsonSerializer.Serialize(note));
            File.Move(temp, notePath, overwrite: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Without the note the next start only does the full check again.
        }
    }

    /// <summary>The SQLite header's file change counter (bytes 24–27, raised by every commit), or -1 when it cannot be read.</summary>
    private static long FileCounter(string path)
    {
        try
        {
            using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            Span<byte> header = stackalloc byte[28];
            return file.ReadAtLeast(header, header.Length, throwOnEndOfStream: false) < header.Length ? -1 : BinaryPrimitives.ReadUInt32BigEndian(header[24..]);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return -1;
        }
    }

    private sealed record Note(long Size, long WrittenUtcTicks, long Counter, string Backup);
}
