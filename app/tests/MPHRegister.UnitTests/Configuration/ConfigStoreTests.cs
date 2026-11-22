using MPHRegister.Data.Config;
using MPHRegister.Data.Database;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Exceptions;
using MPHRegister.UnitTests.TestSupport;

namespace MPHRegister.UnitTests.Configuration;

public sealed class ConfigStoreTests : IDisposable
{
    private readonly TempFolder folder = Make.Folder();

    private ConfigStore Store(int backups = 30, TimeProvider? clock = null) =>
        new(new DataOptions { DataDirectory = folder.Path, BackupsToKeep = backups }, clock ?? TimeProvider.System);

    private sealed class SteppingClock(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset now = start;

        public override DateTimeOffset GetUtcNow() => now;

        public void Advance(TimeSpan step) => now = now.Add(step);
    }

    private string ConfigFile => folder.File("mph-config.json");

    public void Dispose() => folder.Dispose();

    [Fact]
    public void Without_a_file_the_skeleton_is_used_and_nothing_is_written()
    {
        var store = Store();
        Assert.False(store.FileExists);
        Assert.Single(store.Current.BillingStyles);
        Assert.Empty(store.Current.Parties);
        Assert.False(File.Exists(ConfigFile));
    }

    [Fact]
    public void Save_writes_readable_json_in_one_piece_and_reads_back_the_same()
    {
        var store = Store();
        var saved = store.Save(new AppConfig { Parties = [new() { Name = "  P1  ", Rates = new Dictionary<string, decimal> { ["F1"] = 10 } }] });
        Assert.Equal("P1", saved.Parties.Single().Name);
        Assert.True(File.Exists(ConfigFile));
        Assert.False(File.Exists(ConfigFile + ".saving"));
        var reread = Store().Load();
        Assert.Equal(ConfigJson.Serialize(saved), ConfigJson.Serialize(reread));
        Assert.NotNull(store.Status.SavedAt);
    }

    [Fact]
    public void Update_applies_changes_one_after_another()
    {
        var store = Store();
        store.Save(new AppConfig());
        Parallel.For(0, 20, i => store.Update(c => c with { Parties = [.. c.Parties, new PartyConfig { Name = $"P{i}" }] }));
        Assert.Equal(20, store.Current.Parties.Count);
        Assert.Equal(20, Store().Load().Parties.Count);
    }

    [Fact]
    public void A_change_made_outside_the_app_is_read_again()
    {
        var store = Store();
        store.Save(new AppConfig());
        Assert.Empty(store.Current.Parties);
        var edited = ConfigJson.Serialize(new AppConfig { Parties = [new() { Name = "ADDED IN NOTEPAD" }] });
        File.WriteAllText(ConfigFile, edited);
        File.SetLastWriteTimeUtc(ConfigFile, DateTime.UtcNow.AddSeconds(5));
        Assert.Equal("ADDED IN NOTEPAD", store.Reload().Parties.Single().Name);
        Assert.Null(store.Status.Problem);
    }

    [Fact]
    public void A_broken_outside_edit_keeps_the_last_good_config_and_is_backed_up_before_the_next_save()
    {
        var store = Store();
        store.Save(new AppConfig { Parties = [new() { Name = "GOOD" }] });
        File.WriteAllText(ConfigFile, "{ \"parties\": [ { \"name\": ");
        File.SetLastWriteTimeUtc(ConfigFile, DateTime.UtcNow.AddSeconds(5));
        Assert.Equal("GOOD", store.Reload().Parties.Single().Name);
        Assert.NotNull(store.Status.Problem);
        Assert.Contains("mistake", store.Status.Problem, StringComparison.Ordinal);
        store.Update(c => c with { Parties = [.. c.Parties, new PartyConfig { Name = "MORE" }] });
        Assert.Null(store.Status.Problem);
        Assert.Single(Directory.GetFiles(folder.File("backups"), "mph-config-*-unreadable.json"));
        Assert.Equal(2, Store().Load().Parties.Count);
    }

    [Theory]
    [InlineData("", "is empty")]
    [InlineData("   ", "is empty")]
    [InlineData("{ \"parties\": [", "has a mistake")]
    [InlineData("{ \"configVersion\": 99 }", "newer MPH Register")]
    public void An_unusable_file_is_refused_at_start_and_left_untouched(string text, string message)
    {
        File.WriteAllText(ConfigFile, text);
        var error = Assert.Throws<ConfigFileException>(() => Store().Load());
        Assert.Contains(message, error.Message, StringComparison.Ordinal);
        Assert.Equal(text, File.ReadAllText(ConfigFile));
    }

    [Fact]
    public void A_mistake_is_reported_with_its_line_number()
    {
        File.WriteAllText(ConfigFile, "{\n  \"billRules\": {\n    \"rowsPerBill\": \"many\"\n  }\n}\n");
        var error = Assert.Throws<ConfigFileException>(() => Store().Load());
        Assert.Contains("at line 3", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Backups_keep_only_the_newest_copies()
    {
        var clock = new SteppingClock(new DateTimeOffset(2026, 10, 1, 10, 0, 0, TimeSpan.Zero));
        var store = Store(backups: 3, clock: clock);
        store.Save(new AppConfig());
        for (var i = 0; i < 6; i++)
        {
            store.Backup($"b{i}");
            clock.Advance(TimeSpan.FromSeconds(1));
        }
        Assert.Equal(3, Directory.GetFiles(folder.File("backups"), "mph-config-*.json").Length);
    }

    [Fact]
    public void The_newest_good_backup_is_put_back_when_the_file_is_missing()
    {
        var clock = new SteppingClock(new DateTimeOffset(2026, 10, 1, 10, 0, 0, TimeSpan.Zero));
        var store = Store(clock: clock);
        store.Save(new AppConfig { Parties = [new() { Name = "FROM BACKUP" }] });
        store.Backup("good");
        clock.Advance(TimeSpan.FromSeconds(1));
        File.WriteAllText(ConfigFile, "not json");
        store.Backup("broken");
        File.Delete(ConfigFile);
        var fresh = Store(clock: clock);
        Assert.True(fresh.RestoreNewestBackup());
        Assert.Equal("FROM BACKUP", fresh.Current.Parties.Single().Name);
        Assert.Contains(fresh.Status.Notices, n => n.Contains("was put back", StringComparison.Ordinal));
    }

    [Fact]
    public void Notices_are_not_repeated()
    {
        var store = Store();
        store.AddNotices(["one", "two"]);
        store.AddNotices(["one"]);
        Assert.Equal(["two", "one"], store.Status.Notices);
    }
}
