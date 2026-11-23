using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.Sqlite;
using MPHRegister.Data.Config;
using MPHRegister.Data.Database;
using MPHRegister.Data.Repositories;
using MPHRegister.Shared.Extensions;
using MPHRegister.UnitTests.TestSupport;

namespace MPHRegister.UnitTests.Data;

/// <summary>Lists of ids passed as one JSON parameter, the data revision, and the start-up check skipped for an unchanged file.</summary>
public sealed partial class RepositoryListTests : IDisposable
{
    private const int Entries = 1500;
    private readonly TempFolder folder = Make.Folder();

    public RepositoryListTests() => DapperSetup.Configure();

    private DataOptions Options => new() { DataDirectory = folder.Path };

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        folder.Dispose();
    }

    private void Initialize()
    {
        var options = Options;
        new DatabaseInitializer(options, new SqliteConnectionFactory(options), new BackupService(options), new ConfigStore(options, TimeProvider.System)).Initialize();
    }

    private DbSession Session(DataRevision? revision = null) => new(new SqliteConnectionFactory(Options), revision ?? new DataRevision(Options));

    /// <summary>1,500 made-up entries over three months, each with a dispatch, an Aawak link, an import mark and a "no Aawak" mark.</summary>
    private void Fill()
    {
        Initialize();
        using var c = new SqliteConnectionFactory(Options).Open();
        using var t = c.BeginTransaction();
        c.Execute("INSERT INTO import_batches(id, file_name, sha256, register_month, imported_at, entry_count, dispatch_count) VALUES (1, 'made-up.xlsm', 'X', '2026-10', '2026-10-05 10:00:00', 0, 0);", transaction: t);
        c.Execute(
            """
            INSERT INTO arrivals(id, aawak_month, aawak_no, arrival_date, party, nag, transporter, created_at, updated_at)
            VALUES (1, '2026-10', 1, '2026-10-02', 'LIST PARTY', 10, 'LIST LORRY', '2026-10-02 10:00:00', '2026-10-02 10:00:00');
            """,
            transaction: t);
        for (var id = 1; id <= Entries; id++)
        {
            var args = new { id, month = $"2026-{10 + id % 3}", inward = id / 2 + 1, date = $"2026-{10 + id % 3}-02" };
            c.Execute(
                """
                INSERT INTO entries(id, register_month, inward_no, entry_date, party, design_no, lot_no, repair, than, tp, two_part, finish, carried_over, created_at, updated_at)
                VALUES (@id, @month, @inward, @date, 'LIST PARTY', '', '', 0, 10, 0, 0, 'F1', 0, '2026-10-02 10:00:00', '2026-10-02 10:00:00');
                INSERT INTO dispatches(entry_id, seq, qty, gate_pass, dispatch_date) VALUES (@id, 1, 10, 'G', @date);
                INSERT INTO arrival_entries(arrival_id, entry_id, how, created_at) VALUES (1, @id, 'auto', '2026-10-02 10:00:00');
                INSERT INTO import_batch_entries(batch_id, entry_id, action) VALUES (1, @id, 'added');
                INSERT INTO entry_no_arrival(entry_id, note, created_at) VALUES (@id, 'n', '2026-10-02 10:00:00');
                """,
                args,
                t);
        }
        t.Commit();
    }

    [Fact]
    public void Lists_longer_than_SQLite_takes_parameters_are_read_in_one_query()
    {
        Fill();
        // 40,000 ids that are not there plus every real one: one parameter each would be more than SQLite allows (32,766).
        var ids = Enumerable.Range(1, 40_000).Select(i => 1_000_000L + i).Concat(Enumerable.Range(1, Entries).Select(i => (long)i)).ToList();
        using var session = Session();
        var entries = new EntryRepository(session);
        var arrivals = new ArrivalRepository(session);
        Assert.Equal(Entries, entries.ByIds(ids).Count);
        Assert.Equal(Entries, entries.Dispatches(ids).Count);
        Assert.Equal(Entries, entries.UnbilledByIds(ids, ["list party"]).Count);
        Assert.Empty(entries.UnbilledByIds(ids, ["OTHER PARTY"]));
        Assert.Equal(Entries, new ImportLogRepository(session).LatestImportMarks(ids).Count);
        Assert.Equal(Entries, arrivals.EntryArrivals(ids).Count);
        Assert.Equal(Entries, arrivals.NoArrival(ids).Count);
        Assert.Equal(Entries, arrivals.SlipsByIds(ids).Count);
        Assert.Equal(Entries, arrivals.LinksOfEntries(ids).Count);
        var numbers = Enumerable.Range(1, 40_000).ToList();
        Assert.Equal(Entries, entries.SlipsWithNumbers(numbers).Count);
        Assert.Equal(Entries, arrivals.Slips(numbers, "2026-01-01", "2026-12-31").Count);
        // INW. NO. n is used twice in each month only where two ids of the month share it (ids 2n and 2n+1 fall in different months).
        Assert.Equal(entries.DuplicateInwardNumbers(["2026-10", "2026-11", "2026-12"]), entries.DuplicateInwardNumbers(Enumerable.Range(0, 40_000).Select(i => $"2026-{10 + i % 3}").ToList()));
        Assert.Empty(entries.DuplicateInwardNumbers(["2025-01"]));
    }

    [Fact]
    public void Only_a_commit_or_a_statement_that_changed_rows_is_a_new_data_revision()
    {
        Initialize();
        var revision = new DataRevision(Options);
        using var session = Session(revision);
        var entries = new EntryRepository(session);
        var before = revision.Stamp();
        Assert.Empty(entries.List(null));
        using (var read = session.Begin(deferred: true))
        {
            Assert.Equal(0, entries.Count());
            read.Commit();
        }
        Assert.Equal(before, revision.Stamp());

        new SettingsRepository(session).Set("perf_test", "1");
        var written = revision.Stamp();
        Assert.NotEqual(before, written);
        using (var unit = session.Begin())
        {
            new SettingsRepository(session).Set("perf_test", "2");
            unit.Commit();
        }
        Assert.NotEqual(written, revision.Stamp());
    }

    [Fact]
    public void A_start_with_the_file_unchanged_since_the_last_check_skips_the_check_and_the_backup()
    {
        Initialize();
        Initialize();
        var backups = Path.Combine(folder.Path, "backups");
        Assert.Single(Directory.GetFiles(backups, "mph-data-*-start.db"));
        Initialize();
        Initialize();
        Assert.Single(Directory.GetFiles(backups, "mph-data-*-start.db"));

        using (var c = new SqliteConnectionFactory(Options).Open())
            c.Execute("INSERT INTO settings(key, value) VALUES ('perf_test', '1');");
        SqliteConnection.ClearAllPools();
        Initialize();
        Assert.Equal(2, Directory.GetFiles(backups, "mph-data-*-start.db").Length);

        // A newer backup than the one noted (an import made one) also means the full check.
        File.Copy(Directory.GetFiles(backups, "mph-data-*-start.db").Max(StringComparer.Ordinal)!, Path.Combine(backups, "mph-data-99991231-235959-999-before-import.db"));
        Initialize();
        Assert.Equal(3, Directory.GetFiles(backups, "mph-data-*-start.db").Length);
    }

    [Fact]
    public void Names_are_normalised_as_the_whitespace_regex_did()
    {
        foreach (var text in new[] { "", " ", "A", " A ", "A B", "A  B", "A\tB", "A \tB", "A\u00a0B", "A\u2003 B", "  LEAD", "TRAIL  ", "A B C", "A\nB", "A\r\nB", "\u0085A" })
            Assert.Equal(OldNormalizeName().Replace(text, " ").Trim(), text.NormalizeName());
        Assert.Equal(string.Empty, ((string?)null).NormalizeName());
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex OldNormalizeName();
}
