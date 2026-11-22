using Microsoft.Data.Sqlite;
using MPHRegister.Data.Database;
using MPHRegister.Services.Updates;
using MPHRegister.Shared.Exceptions;

namespace MPHRegister.UnitTests.Updates;

public sealed class RollbackTests : IDisposable
{
    private static readonly DateTimeOffset UpdatedAt = new(2026, 11, 20, 9, 30, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset WentBackAt = new(2026, 11, 22, 18, 5, 0, TimeSpan.Zero);

    private readonly string root = Directory.CreateTempSubdirectory("mph-rollback-").FullName;

    public RollbackTests()
    {
        Directory.CreateDirectory(DataDirectory);
        Directory.CreateDirectory(AppFolder);
    }

    private string DataDirectory => Path.Combine(root, "MPH Register Data");

    private string AppFolder => Path.Combine(root, "app");

    private string App => Path.Combine(AppFolder, "MPH Register.exe");

    private string Previous => Path.Combine(AppFolder, "MPH Register.previous.exe");

    private string Data => Path.Combine(DataDirectory, "mph-data.db");

    private string Config => Path.Combine(DataDirectory, "mph-config.json");

    private string RollbackFolder => Path.Combine(DataDirectory, "rollback");

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        Directory.Delete(root, recursive: true);
    }

    [Fact]
    public void The_point_copies_the_data_and_config_and_notes_their_formats()
    {
        WriteData(format: 9, note: "at the update");
        WriteConfig(1, "before");
        Directory.CreateDirectory(RollbackFolder);
        File.WriteAllText(Path.Combine(RollbackFolder, "skipped.json"), """{"version":"0.6.2"}""");

        var point = RollbackFiles.CreatePoint(DataDirectory, "0.6.0", "0.6.1", UpdatedAt);

        Assert.Equal(new RollbackPoint("0.6.0", "0.6.1", 9, 1, UpdatedAt), point);
        Assert.Equal(point, RollbackFiles.ReadPoint(DataDirectory));
        Assert.Equal("at the update", ReadNote(Path.Combine(RollbackFolder, "mph-data.db")));
        Assert.Contains("before", File.ReadAllText(Path.Combine(RollbackFolder, "mph-config.json")), StringComparison.Ordinal);
        Assert.Null(RollbackFiles.SkippedVersion(DataDirectory));
        Assert.False(RollbackFiles.NeedsRestore(DataDirectory, point));
    }

    [Fact]
    public void A_newer_data_or_config_format_needs_the_data_from_the_update()
    {
        WriteData(format: 9, note: "x");
        WriteConfig(1, "x");
        var point = RollbackFiles.CreatePoint(DataDirectory, "0.6.0", "0.6.1", UpdatedAt);

        SetFormat(Data, 10);
        Assert.True(RollbackFiles.NeedsRestore(DataDirectory, point));

        SetFormat(Data, 9);
        WriteConfig(2, "x");
        Assert.True(RollbackFiles.NeedsRestore(DataDirectory, point));
    }

    [Fact]
    public void Going_back_keeps_the_data_when_the_format_did_not_change()
    {
        WriteApps();
        WriteData(format: 9, note: "at the update");
        WriteConfig(1, "x");
        RollbackFiles.CreatePoint(DataDirectory, "0.6.0", "0.6.1", UpdatedAt);
        SetNote(Data, "typed after the update");

        Assert.True(RollbackFiles.Apply(App, DataDirectory, restore: false, "0.6.1", WentBackAt, attempts: 2, TimeSpan.Zero));

        Assert.Equal("older", File.ReadAllText(App));
        Assert.Equal("newer", File.ReadAllText(Previous));
        Assert.False(File.Exists(Path.Combine(AppFolder, "MPH Register.swapping.exe")));
        Assert.Equal("typed after the update", ReadNote(Data));
        Assert.Null(RollbackFiles.ReadPoint(DataDirectory));
        Assert.Equal("0.6.1", RollbackFiles.SkippedVersion(DataDirectory));
    }

    [Fact]
    public void Going_back_over_a_format_change_restores_the_data_from_the_update_and_keeps_todays()
    {
        WriteApps();
        WriteData(format: 9, note: "at the update");
        WriteConfig(1, "before");
        RollbackFiles.CreatePoint(DataDirectory, "0.6.0", "0.6.1", UpdatedAt);
        SetFormat(Data, 10);
        SetNote(Data, "typed after the update");
        WriteConfig(2, "after");

        Assert.True(RollbackFiles.Apply(App, DataDirectory, restore: true, "0.6.1", WentBackAt, attempts: 2, TimeSpan.Zero));

        Assert.Equal("older", File.ReadAllText(App));
        Assert.Equal("at the update", ReadNote(Data));
        Assert.Equal(9, Format(Data));
        Assert.Contains("before", File.ReadAllText(Config), StringComparison.Ordinal);
        var kept = Path.Combine(RollbackFolder, "kept-20261122-180500-from-0.6.1");
        Assert.Equal("typed after the update", ReadNote(Path.Combine(kept, "mph-data.db")));
        Assert.Contains("after", File.ReadAllText(Path.Combine(kept, "mph-config.json")), StringComparison.Ordinal);
    }

    [Fact]
    public void Without_the_older_app_nothing_changes()
    {
        File.WriteAllText(App, "newer");
        WriteData(format: 9, note: "x");

        Assert.False(RollbackFiles.Apply(App, DataDirectory, restore: true, "0.6.1", WentBackAt, attempts: 2, TimeSpan.Zero));

        Assert.Equal("newer", File.ReadAllText(App));
        Assert.Equal("x", ReadNote(Data));
    }

    [Fact]
    public void When_the_data_cannot_be_put_back_the_newer_app_is_put_back_too()
    {
        WriteApps();
        WriteData(format: 9, note: "at the update");
        RollbackFiles.CreatePoint(DataDirectory, "0.6.0", "0.6.1", UpdatedAt);
        File.Delete(Data);
        Directory.CreateDirectory(Data);

        Assert.False(RollbackFiles.Apply(App, DataDirectory, restore: true, "0.6.1", WentBackAt, attempts: 2, TimeSpan.Zero));

        Assert.Equal("newer", File.ReadAllText(App));
        Assert.Equal("older", File.ReadAllText(Previous));
        Assert.NotNull(RollbackFiles.ReadPoint(DataDirectory));
    }

    [Fact]
    public void Going_back_is_offered_only_to_the_updated_Windows_app_while_the_older_one_is_there()
    {
        WriteApps();
        WriteData(format: 9, note: "x");
        WriteConfig(1, "x");
        RollbackFiles.CreatePoint(DataDirectory, "v0.6.0", "0.6.1", UpdatedAt);
        var data = new DataOptions { DataDirectory = DataDirectory };

        var status = Service(data, App, "0.6.1").Status();
        Assert.True(status.Available);
        Assert.Equal("0.6.0", status.Version);
        Assert.False(status.UndoesChanges);
        Assert.Equal(UpdatedAt, status.UpdatedAt);

        Assert.False(Service(data, appPath: null, "0.6.1").Status().Available);
        Assert.False(Service(data, App, "0.6.2").Status().Available);
        File.Delete(Previous);
        Assert.False(Service(data, App, "0.6.1").Status().Available);
        Assert.Equal("There is no earlier version to go back to.", Assert.Throws<AppValidationException>(() => Service(data, App, "0.6.1").Prepare(undoChanges: true)).Message);
    }

    [Fact]
    public void Undoing_changes_must_be_confirmed_and_a_copy_of_the_app_does_the_work()
    {
        WriteApps();
        WriteData(format: 9, note: "x");
        RollbackFiles.CreatePoint(DataDirectory, "0.6.0", "0.6.1", UpdatedAt);
        SetFormat(Data, 10);
        var service = Service(new DataOptions { DataDirectory = DataDirectory }, App, "0.6.1");
        Assert.True(service.Status().UndoesChanges);

        var refused = Assert.Throws<AppValidationException>(() => service.Prepare(undoChanges: false));
        Assert.Equal("Going back now undoes the changes made since the update. Confirm that first.", refused.Message);

        var plan = service.Prepare(undoChanges: true);
        Assert.True(plan.Restore);
        Assert.Equal(App, plan.App);
        Assert.Equal(DataDirectory, plan.DataDirectory);
        Assert.Equal(Path.Combine(AppFolder, "MPH Register.rollback.exe"), plan.Helper);
        Assert.Equal("newer", File.ReadAllText(plan.Helper));
    }

    private static RollbackService Service(DataOptions data, string? appPath, string current) =>
        new(data, new UpdateOptions { AppPath = appPath, CurrentVersion = current });

    private void WriteApps()
    {
        File.WriteAllText(App, "newer");
        File.WriteAllText(Previous, "older");
    }

    private void WriteConfig(int version, string firm) =>
        File.WriteAllText(Config, $$"""{ "configVersion": {{version}}, "firm": { "name": "{{firm}}" } }""");

    private void WriteData(int format, string note)
    {
        using var connection = Open(Data);
        Run(connection, $"CREATE TABLE IF NOT EXISTS notes (text TEXT); DELETE FROM notes; PRAGMA user_version = {format};");
        using var insert = connection.CreateCommand();
        insert.CommandText = "INSERT INTO notes VALUES ($text);";
        insert.Parameters.AddWithValue("$text", note);
        insert.ExecuteNonQuery();
    }

    private static void SetNote(string path, string note)
    {
        using var connection = Open(path);
        using var update = connection.CreateCommand();
        update.CommandText = "UPDATE notes SET text = $text;";
        update.Parameters.AddWithValue("$text", note);
        update.ExecuteNonQuery();
    }

    private static void SetFormat(string path, int format)
    {
        using var connection = Open(path);
        Run(connection, $"PRAGMA user_version = {format};");
    }

    private static string ReadNote(string path)
    {
        using var connection = Open(path);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT text FROM notes;";
        return (string)command.ExecuteScalar()!;
    }

    private static int Format(string path)
    {
        using var connection = Open(path);
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA user_version;";
        return Convert.ToInt32(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);
    }

    private static SqliteConnection Open(string path)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString());
        connection.Open();
        return connection;
    }

    private static void Run(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }
}
