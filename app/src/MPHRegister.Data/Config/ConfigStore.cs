using System.Text;
using System.Text.Json;
using MPHRegister.Data.Database;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Exceptions;

namespace MPHRegister.Data.Config;

public sealed record ConfigStatus(string Path, string? LoadedAt, string? SavedAt, IReadOnlyList<string> Notices, string? Problem);

/// <summary>The config file: read at start-up, re-read when it changes on disk, and written in one piece on every change.</summary>
public interface IConfigStore
{
    string FilePath { get; }

    bool FileExists { get; }

    /// <summary>The latest config; re-read first when the file was changed outside the app.</summary>
    AppConfig Current { get; }

    ConfigStatus Status { get; }

    /// <summary>Reads the file; throws <see cref="ConfigFileException"/> when it cannot be used.</summary>
    AppConfig Load();

    AppConfig Save(AppConfig config);

    /// <summary>Applies a change to the latest config and saves it, one change at a time.</summary>
    AppConfig Update(Func<AppConfig, AppConfig> change);

    /// <summary>Re-reads the file now; when it cannot be read the last good config stays and <see cref="ConfigStatus.Problem"/> says why.</summary>
    AppConfig Reload();

    string? Backup(string reason);

    /// <summary>Puts a backup copy back as the config file (used when the file has gone missing).</summary>
    bool RestoreNewestBackup();

    void AddNotices(IEnumerable<string> notices);
}

public sealed class ConfigStore(DataOptions options, TimeProvider clock) : IConfigStore
{
    private const int FreshnessMilliseconds = 1000;
    private const int MaxNotices = 50;
    private const int Attempts = 8;
    private const string BackupPattern = "mph-config-*.json";

    private readonly Lock gate = new();
    private readonly List<string> messages = [];
    private AppConfig? current;
    private FileStamp stamp;
    private long checkedAt;
    private string? loadedAt;
    private string? savedAt;
    private string? problem;

    public string FilePath => options.ConfigPath;

    public bool FileExists => File.Exists(FilePath);

    public AppConfig Current
    {
        get
        {
            if (current is null)
            {
                lock (gate)
                {
                    current ??= FileExists ? LoadUnlocked() : DefaultConfig.Skeleton();
                }
            }
            var now = Environment.TickCount64;
            if (now - Interlocked.Read(ref checkedAt) >= FreshnessMilliseconds)
            {
                Interlocked.Exchange(ref checkedAt, now);
                RefreshIfChanged();
            }
            return current;
        }
    }

    public ConfigStatus Status
    {
        get
        {
            lock (gate)
            {
                return new ConfigStatus(FilePath, loadedAt, savedAt, messages.ToList(), problem);
            }
        }
    }

    public AppConfig Load()
    {
        lock (gate)
        {
            return LoadUnlocked();
        }
    }

    public AppConfig Save(AppConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);
        lock (gate)
        {
            return SaveUnlocked(config);
        }
    }

    public AppConfig Update(Func<AppConfig, AppConfig> change)
    {
        ArgumentNullException.ThrowIfNull(change);
        lock (gate)
        {
            RefreshUnlocked();
            return SaveUnlocked(change(current ?? DefaultConfig.Skeleton()));
        }
    }

    public AppConfig Reload()
    {
        lock (gate)
        {
            stamp = default;
            RefreshUnlocked();
            return current ?? DefaultConfig.Skeleton();
        }
    }

    public string? Backup(string reason)
    {
        lock (gate)
        {
            return CopyToBackups(reason);
        }
    }

    public bool RestoreNewestBackup()
    {
        lock (gate)
        {
            if (FileExists || !Directory.Exists(options.BackupDirectory)) return false;
            foreach (var candidate in Directory.GetFiles(options.BackupDirectory, BackupPattern).OrderByDescending(f => f, StringComparer.Ordinal))
            {
                try
                {
                    ConfigJson.Deserialize(ReadText(candidate));
                }
                catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException or ConfigFileException)
                {
                    continue;
                }
                File.Copy(candidate, FilePath, overwrite: false);
                AddNoticesUnlocked([$"The config file was missing, so the newest good backup ({Path.GetFileName(candidate)}) was put back."]);
                LoadUnlocked();
                return true;
            }
            return false;
        }
    }

    public void AddNotices(IEnumerable<string> notices)
    {
        ArgumentNullException.ThrowIfNull(notices);
        lock (gate)
        {
            AddNoticesUnlocked(notices);
        }
    }

    private AppConfig LoadUnlocked()
    {
        var (config, found, readStamp) = Read(FileStamp.Of(FilePath));
        current = config;
        stamp = readStamp;
        loadedAt = Now();
        problem = null;
        AddNoticesUnlocked(found);
        return config;
    }

    private void RefreshIfChanged()
    {
        if (FileStamp.Of(FilePath) == stamp) return;
        lock (gate)
        {
            RefreshUnlocked();
        }
    }

    private void RefreshUnlocked()
    {
        var onDisk = FileStamp.Of(FilePath);
        if (onDisk == stamp && current is not null) return;
        stamp = onDisk;
        if (!onDisk.Exists)
        {
            if (current is not null) problem = "The config file was removed outside the app. The last version read is still used and is written back on the next change.";
            current ??= DefaultConfig.Skeleton();
            return;
        }
        try
        {
            var (config, found, readStamp) = Read(onDisk);
            current = config;
            stamp = readStamp;
            loadedAt = Now();
            problem = null;
            AddNoticesUnlocked(found);
        }
        catch (ConfigFileException ex)
        {
            if (current is null) throw;
            problem = $"{ex.Message} The last good version is still used; saving a change from the app will replace the file (a copy of it is kept in the backups folder).";
        }
    }

    private AppConfig SaveUnlocked(AppConfig config)
    {
        var found = new List<string>();
        var normalized = ConfigNormalizer.Normalize(config, found);
        if (problem is not null && FileExists) CopyToBackups("unreadable");
        Write(ConfigJson.Serialize(normalized));
        current = normalized;
        stamp = FileStamp.Of(FilePath);
        savedAt = Now();
        problem = null;
        AddNoticesUnlocked(found);
        return normalized;
    }

    private (AppConfig Config, List<string> Notices, FileStamp Stamp) Read(FileStamp onDisk)
    {
        var path = FilePath;
        string text;
        try
        {
            text = ReadText(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new ConfigFileException($"The config file {path} could not be read ({ex.Message}). Close it in other programs and try again.", ex);
        }
        if (string.IsNullOrWhiteSpace(text))
            throw new ConfigFileException($"The config file {path} is empty. Put back the newest copy from {options.BackupDirectory} (mph-config-…json).");
        AppConfig raw;
        try
        {
            raw = ConfigJson.Deserialize(text);
        }
        catch (JsonException ex)
        {
            var where = ex.LineNumber is { } line ? $" at line {line + 1}" : string.Empty;
            throw new ConfigFileException(
                $"The config file {path} has a mistake{where}: {FirstSentence(ex.Message)} Fix it in a text editor or put back the newest copy from {options.BackupDirectory}.", ex);
        }
        if (raw.ConfigVersion > AppConfig.CurrentVersion)
            throw new ConfigFileException($"The config file {path} was made by a newer MPH Register (config version {raw.ConfigVersion}). Use the newer app.");
        var found = new List<string>();
        var normalized = ConfigNormalizer.Normalize(raw, found);
        if (raw.Parties?.Any(p => !string.IsNullOrWhiteSpace(p?.BillTo)) == true && FileStamp.Of(path) == onDisk)
        {
            CopyToBackups("before-sister-firms");
            Write(ConfigJson.Serialize(normalized));
            onDisk = FileStamp.Of(path);
        }
        return (normalized, found, onDisk);
    }

    private void Write(string text)
    {
        Directory.CreateDirectory(options.DataDirectory);
        var temp = FilePath + ".saving";
        var bytes = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false).GetBytes(text);
        try
        {
            Retry(() =>
            {
                using (var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
                {
                    stream.Write(bytes);
                    stream.Flush(flushToDisk: true);
                }
                File.Move(temp, FilePath, overwrite: true);
            });
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new ConfigFileException(
                $"The config file {FilePath} could not be saved ({ex.Message}). If it is open in another program, close it and try again. Nothing was changed.", ex);
        }
        finally
        {
            try
            {
                if (File.Exists(temp)) File.Delete(temp);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // Best-effort cleanup of temporary file.
            }
        }
    }

    private string? CopyToBackups(string reason)
    {
        if (!FileExists) return null;
        Directory.CreateDirectory(options.BackupDirectory);
        var target = Path.Combine(options.BackupDirectory,
            $"mph-config-{clock.GetLocalNow().ToString(Formats.BackupStamp, System.Globalization.CultureInfo.InvariantCulture)}-{reason}.json");
        Retry(() => File.Copy(FilePath, target, overwrite: true));
        foreach (var old in Directory.GetFiles(options.BackupDirectory, BackupPattern).OrderByDescending(f => f, StringComparer.Ordinal).Skip(options.BackupsToKeep))
        {
            File.Delete(old);
        }
        return target;
    }

    private void AddNoticesUnlocked(IEnumerable<string> list)
    {
        foreach (var notice in list)
        {
            messages.Remove(notice);
            messages.Add(notice);
        }
        if (messages.Count > MaxNotices) messages.RemoveRange(0, messages.Count - MaxNotices);
    }

    private string Now() => Shared.Helpers.Dates.Timestamp(clock.GetLocalNow());

    private static string ReadText(string path)
    {
        string? text = null;
        Retry(() =>
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
            text = reader.ReadToEnd();
        });
        return text ?? string.Empty;
    }

    /// <summary>Windows virus scanners and indexers hold new files for a moment; try again before giving up.</summary>
    private static void Retry(Action action)
    {
        for (var attempt = 1; attempt <= Attempts; attempt++)
        {
            try
            {
                action();
                return;
            }
            catch (Exception ex) when (attempt < Attempts && ex is IOException or UnauthorizedAccessException && ex is not (FileNotFoundException or DirectoryNotFoundException))
            {
                Thread.Sleep(50 * attempt);
            }
        }
    }

    private static string FirstSentence(string message)
    {
        var end = message.IndexOf(". ", StringComparison.Ordinal);
        return end > 0 ? message[..(end + 1)] : message;
    }

    private readonly record struct FileStamp(bool Exists, DateTime WrittenUtc, long Length)
    {
        public static FileStamp Of(string path)
        {
            var info = new FileInfo(path);
            return info.Exists ? new FileStamp(true, info.LastWriteTimeUtc, info.Length) : default;
        }
    }
}
