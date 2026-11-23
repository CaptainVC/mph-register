using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using MPHRegister.Shared.Constants;

namespace MPHRegister.Services.Updates;

/// <summary>
/// What the data looked like when the app was updated: the version before and after, and the formats of the data file
/// (SQLite user_version) and the config file (configVersion). A copy of both files is kept next to it.
/// </summary>
public sealed record RollbackPoint(string FromVersion, string ToVersion, int DataFormat, int ConfigFormat, DateTimeOffset UpdatedAt);

/// <summary>
/// Going back to the version before an update. The files live in the data folder's "rollback" folder:
/// point.json and a copy of mph-data.db and mph-config.json taken just before the newer version first opened them,
/// skipped.json (the version gone back from, not offered again by itself) and kept-… folders with the data as it was
/// when going back undid changes, so nothing is lost.
/// </summary>
public static class RollbackFiles
{
    public const string FolderName = "rollback";
    private const string PointFile = "point.json";
    private const string SkippedFile = "skipped.json";
    private const int NoFile = -1;
    private const int Unreadable = -2;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public static string Folder(string dataDirectory) => Path.Combine(dataDirectory, FolderName);

    /// <summary>Copies the data and config file and notes their formats; run before the newer version changes them.</summary>
    public static RollbackPoint CreatePoint(string dataDirectory, string fromVersion, string toVersion, DateTimeOffset now)
    {
        var folder = Folder(dataDirectory);
        Directory.CreateDirectory(folder);
        TryDelete(Path.Combine(folder, SkippedFile));
        var data = Path.Combine(dataDirectory, Formats.DataFileName);
        var dataCopy = Path.Combine(folder, Formats.DataFileName);
        if (File.Exists(data)) CopyDatabase(data, dataCopy);
        else TryDelete(dataCopy);
        var config = Path.Combine(dataDirectory, Formats.ConfigFileName);
        var configCopy = Path.Combine(folder, Formats.ConfigFileName);
        if (File.Exists(config)) Replace(config, configCopy);
        else TryDelete(configCopy);
        var point = new RollbackPoint(fromVersion, toVersion, DataFormat(dataCopy), ConfigFormat(configCopy), now);
        WriteJson(Path.Combine(folder, PointFile), point);
        return point;
    }

    public static RollbackPoint? ReadPoint(string dataDirectory) => ReadJson<RollbackPoint>(Path.Combine(Folder(dataDirectory), PointFile));

    /// <summary>True when the older version could not read the data or config file as they are now.</summary>
    public static bool NeedsRestore(string dataDirectory, RollbackPoint point)
    {
        ArgumentNullException.ThrowIfNull(point);
        return DataFormat(Path.Combine(dataDirectory, Formats.DataFileName)) != point.DataFormat
            || ConfigFormat(Path.Combine(dataDirectory, Formats.ConfigFileName)) != point.ConfigFormat;
    }

    public static string? SkippedVersion(string dataDirectory) => ReadJson<Skipped>(Path.Combine(Folder(dataDirectory), SkippedFile))?.Version;

    /// <summary>
    /// Run once the newer app has closed: the two versions change places (the newer one stays as …previous.exe) and, when
    /// restore is set, the data and config file go back to the copies from the update after today's are kept in a kept-…
    /// folder. When something fails, everything is put back as it was and false is returned.
    /// </summary>
    public static bool Apply(string app, string dataDirectory, bool restore, string newerVersion, DateTimeOffset now, int attempts, TimeSpan pause, Action<TimeSpan>? sleep = null)
    {
        ArgumentException.ThrowIfNullOrEmpty(app);
        ArgumentException.ThrowIfNullOrEmpty(dataDirectory);
        sleep ??= Thread.Sleep;
        var previous = UpdatePaths.Previous(app);
        if (!File.Exists(previous) || !SwapApps(app, attempts, pause, sleep)) return false;
        if (restore && !RestoreData(dataDirectory, newerVersion, now))
        {
            SwapApps(app, attempts, pause, sleep);
            return false;
        }
        TryDelete(Path.Combine(Folder(dataDirectory), PointFile));
        TryWrite(Path.Combine(Folder(dataDirectory), SkippedFile), new Skipped(newerVersion));
        return true;
    }

    private static bool SwapApps(string app, int attempts, TimeSpan pause, Action<TimeSpan> sleep)
    {
        var previous = UpdatePaths.Previous(app);
        var swapping = UpdatePaths.Swapping(app);
        if (!Move(app, swapping, attempts, pause, sleep)) return false;
        if (!Move(previous, app, attempts, pause, sleep))
        {
            Move(swapping, app, attempts, pause, sleep);
            return false;
        }
        Move(swapping, previous, attempts, pause, sleep);
        return true;
    }

    private static bool RestoreData(string dataDirectory, string newerVersion, DateTimeOffset now)
    {
        var folder = Folder(dataDirectory);
        var stamp = now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);
        var kept = Path.Combine(folder, $"kept-{stamp}-from-{Safe(newerVersion)}");
        string[] names = [Formats.DataFileName, Formats.DataFileName + "-journal", Formats.ConfigFileName];
        try
        {
            Directory.CreateDirectory(kept);
            foreach (var name in names)
            {
                var live = Path.Combine(dataDirectory, name);
                if (File.Exists(live)) File.Copy(live, Path.Combine(kept, name), overwrite: true);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
        try
        {
            Put(Path.Combine(folder, Formats.DataFileName), Path.Combine(dataDirectory, Formats.DataFileName));
            var journal = Path.Combine(dataDirectory, Formats.DataFileName + "-journal");
            if (File.Exists(journal)) File.Delete(journal);
            Put(Path.Combine(folder, Formats.ConfigFileName), Path.Combine(dataDirectory, Formats.ConfigFileName));
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            foreach (var name in names)
            {
                var copy = Path.Combine(kept, name);
                try
                {
                    if (File.Exists(copy)) File.Copy(copy, Path.Combine(dataDirectory, name), overwrite: true);
                }
                catch (Exception again) when (again is IOException or UnauthorizedAccessException)
                {
                    // The copy stays in the kept folder.
                }
            }
            return false;
        }
    }

    // The copy from the update replaces the file; no copy means there was no such file at the update.
    private static void Put(string copy, string live)
    {
        if (File.Exists(copy)) Replace(copy, live);
        else if (File.Exists(live)) File.Delete(live);
    }

    private static void Replace(string source, string target)
    {
        var temp = target + ".restoring";
        File.Copy(source, temp, overwrite: true);
        File.Move(temp, target, overwrite: true);
    }

    private static void CopyDatabase(string source, string target)
    {
        var temp = target + ".saving";
        TryDelete(temp);
        using (var from = Open(source, SqliteOpenMode.ReadOnly))
        using (var to = Open(temp, SqliteOpenMode.ReadWriteCreate))
        {
            from.BackupDatabase(to);
        }
        File.Move(temp, target, overwrite: true);
    }

    private static int DataFormat(string path)
    {
        if (!File.Exists(path)) return NoFile;
        try
        {
            using var connection = Open(path, SqliteOpenMode.ReadOnly);
            using var command = connection.CreateCommand();
            command.CommandText = "PRAGMA user_version;";
            return Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture);
        }
        catch (SqliteException)
        {
            return Unreadable;
        }
    }

    private static int ConfigFormat(string path)
    {
        if (!File.Exists(path)) return NoFile;
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(path), new JsonDocumentOptions { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true });
            return document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty("configVersion", out var version) && version.TryGetInt32(out var number)
                ? number
                : NoFile;
        }
        catch (Exception ex) when (ex is JsonException or IOException)
        {
            return Unreadable;
        }
    }

    private static SqliteConnection Open(string path, SqliteOpenMode mode)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Mode = mode, Pooling = false }.ToString());
        connection.Open();
        return connection;
    }

    private static bool Move(string from, string to, int attempts, TimeSpan pause, Action<TimeSpan> sleep)
    {
        var attempt = 1;
        while (true)
        {
            try
            {
                File.Move(from, to, overwrite: true);
                return true;
            }
            catch (Exception ex) when ((ex is IOException or UnauthorizedAccessException) && attempt < attempts)
            {
                attempt++;
                sleep(pause);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                return false;
            }
        }
    }

    private static string Safe(string text) => string.Concat((text.Length == 0 ? "unknown" : text).Select(c => char.IsLetterOrDigit(c) || c == '.' ? c : '_'));

    private static T? ReadJson<T>(string path)
        where T : class
    {
        try
        {
            return File.Exists(path) ? JsonSerializer.Deserialize<T>(File.ReadAllText(path), Json) : null;
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static void WriteJson<T>(string path, T value)
    {
        var temp = path + ".saving";
        File.WriteAllText(temp, JsonSerializer.Serialize(value, Json));
        File.Move(temp, path, overwrite: true);
    }

    private static void TryWrite<T>(string path, T value)
    {
        try
        {
            WriteJson(path, value);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Only means the version gone back from is offered again.
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Left over; replaced next time.
        }
    }

    private sealed record Skipped(string Version);
}
