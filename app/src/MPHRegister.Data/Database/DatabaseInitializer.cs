using System.Globalization;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.Sqlite;
using MPHRegister.Data.Config;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Exceptions;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Data.Database;

public interface IDatabaseInitializer
{
    void Initialize();
}

/// <summary>
/// Start-up of the data folder: checks and backs up the data file and the config file, applies the embedded SQL migrations
/// in order (v0.4 lists move into the config file on the way), turns unbilled entries marked R into repairs once, and makes
/// sure every party and finish the entries use is in the config file.
/// </summary>
public sealed partial class DatabaseInitializer(DataOptions options, IConnectionFactory factory, IBackupService backups, IConfigStore config) : IDatabaseInitializer
{
    private const int ConfigFileMigration = 4;

    public static int LatestVersion => Migrations().Max(m => m.Version);

    public void Initialize()
    {
        Directory.CreateDirectory(options.DataDirectory);
        var existed = File.Exists(options.DatabasePath);
        if (existed) CheckExistingFile();
        var hadConfig = config.FileExists;
        if (hadConfig) config.Load();
        using var connection = factory.Open();
        if (existed) backups.Backup(connection, "start");
        if (hadConfig) config.Backup("start");

        var version = Convert.ToInt32(Scalar(connection, "PRAGMA user_version;"), CultureInfo.InvariantCulture);
        if (version > LatestVersion)
            throw new DataFileException("This data file was created by a newer version of MPH Register. Use the newer app.");
        if (version == 0) Scalar(connection, "PRAGMA journal_mode = DELETE;");

        foreach (var migration in Migrations().Where(m => m.Version > version).OrderBy(m => m.Version))
        {
            using var transaction = connection.BeginTransaction();
            if (migration.Version == ConfigFileMigration) MoveListsToConfig(connection, transaction, hadConfig);
            using (var command = connection.CreateCommand())
            {
                command.Transaction = transaction;
                command.CommandText = migration.Sql;
                command.ExecuteNonQuery();
            }
            using (var command = connection.CreateCommand())
            {
                command.Transaction = transaction;
                // SQLite PRAGMA statements do not accept bind parameters; migration.Version is an int.
#pragma warning disable S2077
                command.CommandText = $"PRAGMA user_version = {migration.Version};";
#pragma warning restore S2077
                command.ExecuteNonQuery();
            }
            transaction.Commit();
        }

        if (!config.FileExists && !(HasEntries(connection) && config.RestoreNewestBackup()))
        {
            config.Save(DefaultConfig.Skeleton());
            if (HasEntries(connection)) config.AddNotices(["The config file was missing and no backup of it was found, so an empty one was started."]);
        }
        MarkRepairsOnce(connection);
        AddMissingNames(connection);
    }

    /// <summary>
    /// Entries imported or typed before R in LOT N. or D.N. counted as a repair may still have REP. No and wait for a bill.
    /// Once per data file those not billed yet become repairs (not charged); a later REP. No is the user's choice and stays.
    /// </summary>
    private void MarkRepairsOnce(SqliteConnection connection)
    {
        var key = SettingKeys.RepairMarksChecked;
        if (connection.ExecuteScalar<long>("SELECT COUNT(*) FROM settings WHERE key = @key;", new { key }) > 0) return;
        var marked = connection.Query<(long Id, string RegisterMonth, int InwardNo, string Party, string DesignNo, string LotNo)>(
            """
            SELECT e.id, e.register_month, e.inward_no, e.party, e.design_no, e.lot_no FROM entries e
            WHERE e.repair = 0
              AND NOT EXISTS (SELECT 1 FROM invoice_entries ie JOIN invoices i ON i.id = ie.invoice_id WHERE ie.entry_id = e.id AND i.status = 'saved')
              AND NOT EXISTS (SELECT 1 FROM billed_elsewhere b WHERE b.entry_id = e.id)
            ORDER BY e.register_month, e.inward_no, e.id;
            """).Where(e => RepairMark.In(e.LotNo, e.DesignNo)).ToList();
        using (var transaction = connection.BeginTransaction())
        {
            // updated_at stays: the entry still matches its workbook row as the reader reads it now, so a later import of the
            // month keeps treating it as untouched in the app.
            if (marked.Count > 0) connection.Execute("UPDATE entries SET repair = 1 WHERE id IN @ids;", new { ids = marked.Select(e => e.Id) }, transaction);
            connection.Execute("INSERT INTO settings(key, value) VALUES (@key, @value);", new { key, value = marked.Count.ToString(CultureInfo.InvariantCulture) }, transaction);
            transaction.Commit();
        }
        if (marked.Count == 0) return;
        var one = marked.Count == 1;
        var list = string.Join("; ", marked.Select(e => $"{e.RegisterMonth} INW. NO. {e.InwardNo} {e.Party}"));
        config.AddNotices([$"{marked.Count} unbilled entr{(one ? "y has" : "ies have")} R (repair) in LOT N. or D.N., so REP. was set to Yes and {(one ? "it is" : "they are")} not charged: {list}. Set REP. back to No in the Register if {(one ? "it" : "one")} should be charged."]);
    }

    private void MoveListsToConfig(SqliteConnection connection, SqliteTransaction transaction, bool hadConfig)
    {
        var hasLists = LegacyMastersExporter.HasAny(connection, transaction);
        if (hadConfig)
        {
            if (hasLists) config.AddNotices(["The data file's old party and finish lists were not used because a config file was already there."]);
            return;
        }
        config.Save(LegacyMastersExporter.Export(connection, transaction));
        if (hasLists) config.AddNotices(["Parties, finishes, rates, bill styles, firm details and the signature moved from the data file into the config file."]);
    }

    /// <summary>Entries and bills may name parties or finishes the config file lacks (hand edits, an older file); they come back as inactive.</summary>
    private void AddMissingNames(SqliteConnection connection)
    {
        var index = ConfigIndex.For(config.Current);
        var parties = connection.Query<string>("SELECT DISTINCT party FROM entries UNION SELECT DISTINCT party FROM invoices UNION SELECT DISTINCT party FROM arrivals;")
            .Select(n => n.NormalizeName()).Where(n => n.Length > 0 && index.Party(n) is null).Order(StringComparer.Ordinal).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var finishes = connection.Query<string>("SELECT DISTINCT finish FROM entries;")
            .Select(n => n.NormalizeName()).Where(n => n.Length > 0 && index.Finish(n) is null).Order(StringComparer.Ordinal).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var transporters = connection.Query<string>("SELECT DISTINCT transporter FROM arrivals UNION SELECT DISTINCT transporter FROM deleted_arrivals;")
            .Select(n => n.NormalizeName()).Where(n => n.Length > 0 && index.Transporter(n) is null).Order(StringComparer.Ordinal).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (parties.Count == 0 && finishes.Count == 0 && transporters.Count == 0) return;
        config.Update(c => c with
        {
            Parties = [.. c.Parties, .. parties.Select(n => new PartyConfig { Name = n, Active = false, BillingStyle = ConfigIndex.For(c).FallbackStyle.Name })],
            Finishes = [.. c.Finishes, .. finishes.Select(n => new FinishConfig { Name = n, Active = false })],
            Transporters = [.. c.Transporters, .. transporters.Select(n => new TransporterConfig { Name = n, Active = false })],
        });
        var added = new List<string>();
        if (parties.Count > 0) added.Add($"{parties.Count} part{(parties.Count == 1 ? "y" : "ies")} used by entries or bills were not in the config file and were added as inactive: {string.Join(", ", parties)}.");
        if (transporters.Count > 0) added.Add($"{transporters.Count} lorry wala{(transporters.Count == 1 ? string.Empty : "s")} used by AAWAK rows were not in the config file and were added as inactive: {string.Join(", ", transporters)}.");
        if (finishes.Count > 0) added.Add($"{finishes.Count} finish{(finishes.Count == 1 ? string.Empty : "es")} used by entries were not in the config file and were added as inactive: {string.Join(", ", finishes)}.");
        config.AddNotices(added);
    }

    private static bool HasEntries(SqliteConnection connection) =>
        connection.ExecuteScalar<long>("SELECT (SELECT COUNT(*) FROM entries) + (SELECT COUNT(*) FROM invoices);") > 0;

    private void CheckExistingFile()
    {
        string? problem;
        if (new FileInfo(options.DatabasePath).Length == 0)
        {
            problem = "the file is empty";
        }
        else
        {
            try
            {
                using var connection = factory.Open();
                var check = Scalar(connection, "PRAGMA quick_check;")?.ToString();
                problem = check == "ok" ? null : check;
            }
            catch (SqliteException ex)
            {
                problem = ex.Message;
            }
        }
        if (problem is null) return;
        if (problem.Length > 200) problem = problem[..200] + "…";
        throw new DataFileException(
            $"The data file {options.DatabasePath} is damaged ({problem}). Nothing was changed. Restore the newest file from: {options.BackupDirectory}");
    }

    private static object? Scalar(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return command.ExecuteScalar();
    }

    private static IEnumerable<(int Version, string Sql)> Migrations()
    {
        var assembly = typeof(DatabaseInitializer).Assembly;
        foreach (var name in assembly.GetManifestResourceNames())
        {
            var match = MigrationName().Match(name);
            if (!match.Success) continue;
            using var stream = assembly.GetManifestResourceStream(name)!;
            using var reader = new StreamReader(stream);
            yield return (int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture), reader.ReadToEnd());
        }
    }

    [GeneratedRegex(@"^Migrations\.(\d{4})_[a-z0-9_]+\.sql$")]
    private static partial Regex MigrationName();
}
