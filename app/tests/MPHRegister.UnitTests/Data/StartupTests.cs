using System.Text.Json;
using Dapper;
using Microsoft.Data.Sqlite;
using MPHRegister.Data.Config;
using MPHRegister.Data.Database;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Exceptions;
using MPHRegister.UnitTests.TestSupport;

namespace MPHRegister.UnitTests.Data;

/// <summary>Start-up of a data folder: new folders, v0.4 data files moving their lists into the config file, and refusals.</summary>
public sealed class StartupTests : IDisposable
{
    private static readonly byte[] TinyPng = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");

    private readonly TempFolder folder = Make.Folder();

    public StartupTests() => DapperSetup.Configure();

    private DataOptions Options => new() { DataDirectory = folder.Path };

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        folder.Dispose();
    }

    private (ConfigStore Config, DatabaseInitializer Init) Start()
    {
        var options = Options;
        var config = new ConfigStore(options, TimeProvider.System);
        return (config, new DatabaseInitializer(options, new SqliteConnectionFactory(options), new BackupService(options), config));
    }

    private SqliteConnection Open() => new SqliteConnectionFactory(Options).Open();

    /// <summary>A data file as v0.4 left it: migrations 1–3 applied and the lists in its own tables.</summary>
    private void MakeV04DataFile(Action<SqliteConnection> fill)
    {
        Directory.CreateDirectory(folder.Path);
        using var connection = Open();
        var assembly = typeof(DatabaseInitializer).Assembly;
        foreach (var name in new[] { "Migrations.0001_initial.sql", "Migrations.0002_billing.sql", "Migrations.0003_history.sql" })
        {
            using var reader = new StreamReader(assembly.GetManifestResourceStream(name)!);
            connection.Execute(reader.ReadToEnd());
        }
        connection.Execute("PRAGMA user_version = 3;");
        fill(connection);
    }

    private static void AddEntry(SqliteConnection c, string party, string finish, int inward = 1) => c.Execute(
        """
        INSERT INTO entries(register_month, inward_no, entry_date, party, design_no, lot_no, repair, than, tp, two_part, finish, carried_over, created_at, updated_at)
        VALUES ('2026-10', @inward, '2026-10-02', @party, 'D1', 'L1', 0, 10, 0, 0, @finish, 0, '2026-10-02 10:00:00', '2026-10-02 10:00:00');
        """,
        new { party, finish, inward });

    private static int Version(SqliteConnection c) => c.ExecuteScalar<int>("PRAGMA user_version;");

    private static bool HasTable(SqliteConnection c, string table) =>
        c.ExecuteScalar<long>("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = @table;", new { table }) > 0;

    [Fact]
    public void Updates_older_than_the_latest_are_dropped_from_the_import_history_when_the_file_is_upgraded()
    {
        Directory.CreateDirectory(folder.Path);
        using (var c = Open())
        {
            var assembly = typeof(DatabaseInitializer).Assembly;
            foreach (var name in assembly.GetManifestResourceNames().Where(n => n.StartsWith("Migrations.", StringComparison.Ordinal)).OrderBy(n => n, StringComparer.Ordinal).Take(11))
            {
                using var reader = new StreamReader(assembly.GetManifestResourceStream(name)!);
                c.Execute(reader.ReadToEnd());
            }
            c.Execute("PRAGMA user_version = 11;");
            foreach (var id in new[] { 1, 2, 3 })
                c.Execute("INSERT INTO import_batches(file_name, sha256, register_month, imported_at, entry_count, dispatch_count) VALUES (@name, @name, '2026-10', @at, 0, 0);", new { name = $"b{id}.xlsx", at = $"2026-10-0{id} 10:00:00" });
            c.Execute(
                """
                INSERT INTO import_batch_entries(batch_id, entry_id, action, changes) VALUES
                    (1, 10, 'added', ''), (2, 10, 'updated', 'THAN 1 → 2'), (3, 10, 'updated', 'THAN 2 → 3'),
                    (2, 11, 'updated', 'LOT N. filled in (L)'), (1, 12, 'added', '');
                """);
        }

        var (_, init) = Start();
        init.Initialize();
        using var after = Open();
        var left = after.Query<(long Batch, long Entry, string Action)>("SELECT batch_id, entry_id, action FROM import_batch_entries ORDER BY entry_id, batch_id;").ToList();
        Assert.Equal([(1L, 10L, "added"), (3L, 10L, "updated"), (2L, 11L, "updated"), (1L, 12L, "added")], left);
        Assert.Equal(string.Empty, after.ExecuteScalar<string>("SELECT details FROM import_batch_entries WHERE entry_id = 11;"));
    }

    [Fact]
    public void A_new_folder_gets_an_empty_data_file_and_a_skeleton_config()
    {
        var (config, init) = Start();
        init.Initialize();
        Assert.True(File.Exists(Options.DatabasePath));
        Assert.True(File.Exists(Options.ConfigPath));
        var saved = ConfigJson.Deserialize(File.ReadAllText(Options.ConfigPath));
        Assert.Empty(saved.Parties);
        Assert.Single(saved.BillingStyles);
        Assert.NotEmpty(saved.Colors);
        using var c = Open();
        Assert.Equal(DatabaseInitializer.LatestVersion, Version(c));
        Assert.False(HasTable(c, "parties"));
        Assert.Empty(config.Status.Notices);
    }

    [Fact]
    public void Legacy_bill_to_settings_are_backed_up_and_rewritten_once()
    {
        var (config, init) = Start();
        init.Initialize();
        var original = """
            {"parties":[
              {"name":"A","sisterGroup":"GROUP A","billTo":" b "},
              {"name":"B","sisterGroup":"GROUP B"},
              {"name":"C","sisterGroup":"GROUP A"},
              {"name":"D","sisterGroup":"GROUP B"},
              {"name":"E","billTo":"B"},
              {"name":"F","sisterGroup":"UNRELATED"},
              {"name":"G","billTo":"MISSING"},
              {"name":"H","billTo":"I"},
              {"name":"I"},
              {"name":"J","sisterGroup":"I"}
            ]}
            """;
        File.WriteAllText(Options.ConfigPath, original);

        init.Initialize();
        var migrated = File.ReadAllText(Options.ConfigPath);
        Assert.DoesNotContain("\"billTo\"", migrated, StringComparison.Ordinal);
        var parties = config.Current.Parties.ToDictionary(p => p.Name);
        Assert.All(new[] { "A", "B", "C", "D", "E" }, name => Assert.Equal("GROUP A", parties[name].SisterGroup));
        Assert.Equal("UNRELATED", parties["F"].SisterGroup);
        Assert.Empty(parties["G"].SisterGroup);
        Assert.Equal("I (2)", parties["I"].SisterGroup);
        Assert.Equal(parties["I"].SisterGroup, parties["H"].SisterGroup);
        Assert.Equal("I", parties["J"].SisterGroup);
        Assert.Contains(config.Status.Notices, n => n.Contains("MISSING", StringComparison.Ordinal));
        var backup = Assert.Single(Directory.GetFiles(Options.BackupDirectory, "*-before-sister-firms.json"));
        Assert.Equal(original, File.ReadAllText(backup));

        Start().Init.Initialize();
        Assert.Equal(migrated, File.ReadAllText(Options.ConfigPath));
        Assert.Equal(backup, Assert.Single(Directory.GetFiles(Options.BackupDirectory, "*-before-sister-firms.json")));
    }

    [Fact]
    public void A_v04_data_file_moves_its_lists_into_the_config_file()
    {
        MakeV04DataFile(c =>
        {
            c.Execute("INSERT INTO finish_groups(name, active) VALUES ('G1', 1), ('G2', 0);");
            c.Execute("INSERT INTO finishes(name, active, finish_group, color, fallback) VALUES ('F1', 1, 'G1', 'black', 'F2,F3'), ('F2', 1, 'G1', 'red', ''), ('F3', 0, '', 'black', '');");
            c.Execute(
                """
                INSERT INTO parties(name, active, address, state, gstin, discount, color, bill_to, bill_style) VALUES
                ('PARTY ONE', 1, 'ADDR 1', '(STATE)', '08TESTF9001J1ZJ', 12.5, 'dark blue', '', '{"gpn":"none","dn":"dn","lot":"lot","group":"entry","sort":"inward","include":"dispatched","breakdown":false,"combineSmall":true,"finishMap":{}}'),
                ('PARTY TWO', 1, 'ADDR 2', '(STATE)', '', NULL, 'black', '', '{"gpn":"gatepass","dn":"dn","lot":"lot","group":"lot","sort":"ref","include":"all","breakdown":true,"combineSmall":true,"finishMap":{"F1":"F2"}}'),
                ('PARTY THREE', 0, '', '', '', 5, 'black', '', '{"gpn":"none","dn":"none","lot":"dn","group":"entry","sort":"ref","include":"dispatched","breakdown":false,"combineSmall":false,"finishMap":{}}'),
                ('CHILD', 1, '', '', '', NULL, 'black', 'PARTY ONE', '{}'),
                ('BROKEN STYLE', 1, '', '', '', NULL, 'black', '', 'not json');
                INSERT INTO rates(party, finish, rate) VALUES ('PARTY ONE', 'F1', 90), ('PARTY ONE', 'F2', 77.5), ('PARTY TWO', 'F2', 60);
                """);
            var firm = new
            {
                firmName = "TEST FIRM", gstin = "08TESTF9001J1ZJ", addressLine1 = "A1", addressLine2 = "A2", phoneLine = "P", msmeLine = "M", invoiceTitle = "JOB BILL",
                sacLine = "SAC-1", copyLabel = "COPY", bankLine1 = "B1", bankLine2 = "B2", paymentLine = "PAY", terms = "1.one\n2.two", signatory = "FOR TEST",
                signatureLabel = "Sign", checkedByLabel = "Checked", homeStateCode = "08", homeStateName = "HOME", cgstRate = 2.5, sgstRate = 2.5, igstRate = 5,
                invoiceLimit = 150000, rowsPerInvoice = 25, invoicePrefix = "{FY}\\X\\", smallThanBelow = 6, combineMax = 3, paperSize = "a4", indianNumbers = false,
            };
            c.Execute("INSERT INTO settings(key, value) VALUES ('firm', @json), ('signature_png', @png), ('invoice_next:26-27', '42'), ('register_month', '2026-10');",
                new { json = JsonSerializer.Serialize(firm), png = Convert.ToBase64String(TinyPng) });
            AddEntry(c, "PARTY ONE", "F1");
        });

        var (config, init) = Start();
        init.Initialize();
        var saved = ConfigJson.Deserialize(File.ReadAllText(Options.ConfigPath));

        Assert.Equal(("TEST FIRM", "08", "HOME"), (saved.Firm.Name, saved.Firm.HomeStateCode, saved.Firm.HomeStateName));
        Assert.Equal(("{FY}\\X\\", 150000m, 6, 3, 2.5m, 5m), (saved.BillRules.NumberPrefix, saved.BillRules.TotalMustStayBelow, saved.BillRules.CombineSmallBelowThan,
            saved.BillRules.CombineUpTo, saved.BillRules.CgstPercent, saved.BillRules.IgstPercent));
        Assert.Equal(("JOB BILL", "SAC-1", "COPY", "Sign"), (saved.PrintedTexts.InvoiceKind, saved.PrintedTexts.SacLine, saved.PrintedTexts.CopyLabel, saved.PrintedTexts.SignatureLabel));
        Assert.Equal(["1.one", "2.two"], saved.PrintedTexts.Terms);
        Assert.Equal((PaperSize.A4, false), (saved.Print.PaperSize, saved.Print.IndianDigitGrouping));
        Assert.StartsWith("data:image/png;base64,", saved.Signature, StringComparison.Ordinal);
        Assert.Contains(saved.Colors, c => c.Name == "dark blue" && c.Hex == "#00008b");

        Assert.Equal(["G1", "G2"], saved.FinishGroups.Select(g => g.Name));
        var f1 = saved.Finishes.Single(f => f.Name == "F1");
        Assert.Equal("G1", f1.Group);
        Assert.Equal(["F2", "F3"], f1.BillAsIfNoRate);
        Assert.False(saved.Finishes.Single(f => f.Name == "F3").Active);

        var index = ConfigIndex.For(saved);
        var one = index.Party("PARTY ONE")!;
        var two = index.Party("PARTY TWO")!;
        var three = index.Party("PARTY THREE")!;
        Assert.Equal((12.5m, "dark blue", false), (one.DiscountPercent, one.Color, one.BillBeforeDispatch));
        Assert.Equal(new Dictionary<string, decimal> { ["F1"] = 90, ["F2"] = 77.5m }, one.Rates.ToDictionary(kv => kv.Key, kv => kv.Value));
        Assert.Null(two.DiscountPercent);
        Assert.True(two.BillBeforeDispatch);
        Assert.Equal("F2", two.BillAs["F1"]);
        Assert.Null(index.Party("CHILD")!.BillTo);
        Assert.Equal(["CHILD"], index.SisterFirms("PARTY ONE").Select(p => p.Name));

        var styleOne = index.StyleOf(one);
        var styleTwo = index.StyleOf(two);
        var styleThree = index.StyleOf(three);
        Assert.Equal((ColumnContent.Blank, ColumnContent.DesignNo, ColumnContent.LotNo, LineGrouping.OnePerEntry, LineOrder.Inward), (styleOne.GpnColumn, styleOne.DnColumn, styleOne.LotColumn, styleOne.Lines, styleOne.Order));
        Assert.Equal((ColumnContent.GatePass, LineGrouping.SameLot, LineOrder.Reference, true), (styleTwo.GpnColumn, styleTwo.Lines, styleTwo.Order, styleTwo.ShowQuantityBreakdown));
        Assert.Equal((ColumnContent.Blank, ColumnContent.DesignNo, false), (styleThree.DnColumn, styleThree.LotColumn, styleThree.CombineSmallEntries));
        Assert.Same(styleOne, index.StyleOf(index.Party("CHILD")!));
        Assert.Same(styleOne, index.StyleOf(index.Party("BROKEN STYLE")!));
        Assert.Equal(3, saved.BillingStyles.Count);
        Assert.All(saved.BillingStyles, s => Assert.False(string.IsNullOrWhiteSpace(s.Description)));

        using var db = Open();
        Assert.Equal(DatabaseInitializer.LatestVersion, Version(db));
        foreach (var table in new[] { "parties", "finishes", "finish_groups", "rates" }) Assert.False(HasTable(db, table));
        Assert.Equal(["invoice_next:26-27", "register_month", "repair_marks_checked"], db.Query<string>("SELECT key FROM settings ORDER BY key;"));
        Assert.Equal(1, db.ExecuteScalar<int>("SELECT COUNT(*) FROM entries;"));
        Assert.Contains(config.Status.Notices, n => n.Contains("moved from the data file into the config file", StringComparison.Ordinal));
        Assert.Single(Directory.GetFiles(Options.BackupDirectory, "mph-data-*-start.db"));
    }

    [Fact]
    public void The_real_v04_file_keeps_every_party_finish_group_and_rate()
    {
        var fixture = Path.Combine(AppContext.BaseDirectory, "fixtures", "v04-seeded.db");
        Assert.True(File.Exists(fixture), "tests/fixtures/v04-seeded.db is copied next to the tests");
        Directory.CreateDirectory(folder.Path);
        File.Copy(fixture, Options.DatabasePath);
        int parties, finishes, groups, rates;
        using (var before = Open())
        {
            parties = before.ExecuteScalar<int>("SELECT COUNT(*) FROM parties;");
            finishes = before.ExecuteScalar<int>("SELECT COUNT(*) FROM finishes;");
            groups = before.ExecuteScalar<int>("SELECT COUNT(*) FROM finish_groups;");
            rates = before.ExecuteScalar<int>("SELECT COUNT(*) FROM rates;");
        }
        var (_, init) = Start();
        init.Initialize();
        var saved = ConfigJson.Deserialize(File.ReadAllText(Options.ConfigPath));
        Assert.Equal(parties, saved.Parties.Count);
        Assert.Equal(finishes, saved.Finishes.Count);
        Assert.Equal(groups, saved.FinishGroups.Count);
        Assert.Equal(rates, saved.Parties.Sum(p => p.Rates.Count));
        var index = ConfigIndex.For(saved);
        Assert.All(saved.Parties, p => Assert.NotNull(index.Style(p.BillingStyle)));
        Assert.All(saved.Parties, p => Assert.True(index.IsKnownColor(p.Color), $"{p.Name} colour {p.Color}"));
        Assert.Equal(saved.BillingStyles.Count, saved.BillingStyles.Select(s => s.Name).Distinct().Count());
        Assert.NotNull(saved.Signature);
    }

    [Fact]
    public void A_config_file_already_there_wins_over_old_lists_in_the_data_file()
    {
        MakeV04DataFile(c => c.Execute("INSERT INTO parties(name, active) VALUES ('OLD LIST PARTY', 1);"));
        new ConfigStore(Options, TimeProvider.System).Save(new AppConfig { Parties = [new() { Name = "CONFIG PARTY" }] });
        var (config, init) = Start();
        init.Initialize();
        var names = config.Current.Parties.Select(p => p.Name).ToList();
        Assert.Equal(["CONFIG PARTY"], names);
        Assert.Contains(config.Status.Notices, n => n.Contains("were not used because a config file was already there", StringComparison.Ordinal));
        Assert.Single(Directory.GetFiles(Options.BackupDirectory, "mph-config-*-start.json"));
    }

    [Fact]
    public void Entries_naming_parties_or_finishes_missing_from_the_config_bring_them_back_as_inactive()
    {
        var (_, first) = Start();
        first.Initialize();
        using (var c = Open())
        {
            AddEntry(c, "HAND  EDITED AWAY", "GONE FINISH", 1);
            AddEntry(c, "hand edited away", "", 2);
        }
        var (config, init) = Start();
        init.Initialize();
        var party = Assert.Single(config.Current.Parties);
        Assert.Equal(("HAND EDITED AWAY", false), (party.Name, party.Active));
        Assert.Equal(DefaultConfig.StandardStyleName, party.BillingStyle);
        Assert.Equal(("GONE FINISH", false), (config.Current.Finishes.Single().Name, config.Current.Finishes.Single().Active));
        Assert.Contains(config.Status.Notices, n => n.Contains("added as inactive", StringComparison.Ordinal));
    }

    [Fact]
    public void A_missing_config_file_is_put_back_from_the_newest_backup()
    {
        var (config, first) = Start();
        first.Initialize();
        config.Save(config.Current with { Parties = [new() { Name = "KEEP ME" }] });
        using (var c = Open()) AddEntry(c, "KEEP ME", "");
        var (_, second) = Start();
        second.Initialize();
        File.Delete(Options.ConfigPath);
        var (restored, third) = Start();
        third.Initialize();
        Assert.Equal("KEEP ME", restored.Current.Parties.Single().Name);
        Assert.Contains(restored.Status.Notices, n => n.Contains("was put back", StringComparison.Ordinal));
    }

    [Fact]
    public void Unbilled_entries_marked_R_become_repairs_once()
    {
        MakeV04DataFile(c =>
        {
            AddMarked(c, 397, "R", "1079");
            AddMarked(c, 398, "12858,R", "");
            AddMarked(c, 399, "", "R  12980");
            AddMarked(c, 400, "R mix", "");
            AddMarked(c, 401, "RAJWADI", "MIX");
            AddMarked(c, 402, "543", "13761");
            var billed = AddMarked(c, 403, "R", "");
            var elsewhere = AddMarked(c, 404, "R", "");
            var cancelled = AddMarked(c, 405, "R", "");
            c.Execute(
                """
                INSERT INTO invoices(invoice_no, fy, serial, party, party_name, address, state, gstin, bill_date, bill_month, period_from, period_to,
                    discount_pct, tax_mode, cgst_rate, sgst_rate, igst_rate, gross, discount, taxable, cgst, sgst, igst, total, status, source, firm,
                    created_at, updated_at)
                VALUES ('26-27\X\1', '26-27', 1, 'P', 'P', '', '', '', '2026-10-31', '2026-10', '2026-10-01', '2026-10-31', 0, 'cgst', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                    'saved', 'excel', '{}', '2026-10-31 10:00:00', '2026-10-31 10:00:00'),
                       ('26-27\X\2', '26-27', 2, 'P', 'P', '', '', '', '2026-10-31', '2026-10', '2026-10-01', '2026-10-31', 0, 'cgst', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                    'cancelled', 'app', '{}', '2026-10-31 10:00:00', '2026-10-31 10:00:00');
                INSERT INTO invoice_entries(invoice_id, entry_id) VALUES (1, @billed), (2, @cancelled);
                INSERT INTO billed_elsewhere(entry_id, note, created_at) VALUES (@elsewhere, 'by hand', '2026-10-31 10:00:00');
                """,
                new { billed, cancelled, elsewhere });
        });

        var (config, init) = Start();
        init.Initialize();
        using (var c = Open())
        {
            Assert.Equal([397, 398, 399, 405], RepairInwards(c));
            Assert.Equal(["2026-10-02 10:00:00"], c.Query<string>("SELECT DISTINCT updated_at FROM entries;"));
            c.Execute("UPDATE entries SET repair = 0 WHERE inward_no = 397;");
        }
        var notice = Assert.Single(config.Status.Notices, n => n.Contains("R (repair)", StringComparison.Ordinal));
        Assert.StartsWith("4 unbilled entries have R (repair) in LOT N. or D.N.", notice, StringComparison.Ordinal);
        Assert.Contains("2026-10 INW. NO. 397 P; 2026-10 INW. NO. 398 P", notice, StringComparison.Ordinal);

        var (again, second) = Start();
        second.Initialize();
        using var db = Open();
        Assert.Equal([398, 399, 405], RepairInwards(db));
        Assert.DoesNotContain(again.Status.Notices, n => n.Contains("R (repair)", StringComparison.Ordinal));
    }

    [Fact]
    public void A_new_data_file_has_no_repair_notice()
    {
        var (config, init) = Start();
        init.Initialize();
        Assert.DoesNotContain(config.Status.Notices, n => n.Contains("R (repair)", StringComparison.Ordinal));
        using var c = Open();
        Assert.Equal("0", c.ExecuteScalar<string>("SELECT value FROM settings WHERE key = 'repair_marks_checked';"));
    }

    private static long AddMarked(SqliteConnection c, int inward, string lot, string dn) => c.ExecuteScalar<long>(
        """
        INSERT INTO entries(register_month, inward_no, entry_date, party, design_no, lot_no, repair, than, tp, two_part, finish, carried_over, created_at, updated_at)
        VALUES ('2026-10', @inward, '2026-10-02', 'P', @dn, @lot, 0, 6, 0, 0, '', 0, '2026-10-02 10:00:00', '2026-10-02 10:00:00');
        SELECT last_insert_rowid();
        """,
        new { inward, lot, dn });

    private static List<int> RepairInwards(SqliteConnection c) =>
        c.Query<int>("SELECT inward_no FROM entries WHERE repair = 1 ORDER BY inward_no;").ToList();

    [Fact]
    public void Starting_again_changes_nothing()
    {
        var (_, first) = Start();
        first.Initialize();
        var text = File.ReadAllText(Options.ConfigPath);
        var (_, second) = Start();
        second.Initialize();
        Assert.Equal(text, File.ReadAllText(Options.ConfigPath));
        using var c = Open();
        Assert.Equal(DatabaseInitializer.LatestVersion, Version(c));
    }

    [Fact]
    public void A_carryover_an_earlier_month_adopted_but_v05_left_in_the_later_month_moves_to_its_month()
    {
        MakeV04DataFile(c =>
        {
            c.Execute(
                """
                INSERT INTO import_batches(id, file_name, sha256, register_month, imported_at, entry_count, dispatch_count) VALUES
                    (1, 'NOV.xlsm', 'A', '2026-11', '2026-11-20 10:00:00', 1, 0), (2, 'OCT.xlsm', 'B', '2026-10', '2026-11-20 10:05:00', 0, 0);
                """);
            AddEntry(c, "PARTY A", "F1", inward: 1);
            AddEntry(c, "PARTY A", "F1", inward: 2);
            c.Execute("UPDATE entries SET register_month = '2026-11', import_batch_id = 2 WHERE inward_no = 1;");
            c.Execute("UPDATE entries SET register_month = '2026-11', import_batch_id = 1 WHERE inward_no = 2;");
        });
        var (_, init) = Start();
        init.Initialize();
        using var db = Open();
        Assert.Equal(["2026-10", "2026-11"], db.Query<string>("SELECT register_month FROM entries ORDER BY inward_no;"));
        Assert.True(HasTable(db, "carryover_sources"));
    }

    [Fact]
    public void A_damaged_data_file_is_refused_and_left_untouched()
    {
        Directory.CreateDirectory(folder.Path);
        File.WriteAllText(Options.DatabasePath, "this is not a database");
        var (_, init) = Start();
        Assert.Throws<DataFileException>(init.Initialize);
        Assert.Equal("this is not a database", File.ReadAllText(Options.DatabasePath));
        Assert.False(File.Exists(Options.ConfigPath));
    }

    [Fact]
    public void A_data_file_from_a_newer_app_is_refused()
    {
        Directory.CreateDirectory(folder.Path);
        using (var c = Open()) c.Execute("CREATE TABLE x(a); PRAGMA user_version = 999;");
        var (_, init) = Start();
        var error = Assert.Throws<DataFileException>(init.Initialize);
        Assert.Contains("newer version", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void An_unreadable_config_file_stops_the_start_and_nothing_is_changed()
    {
        var (_, first) = Start();
        first.Initialize();
        File.WriteAllText(Options.ConfigPath, "{ broken");
        var stamp = File.GetLastWriteTimeUtc(Options.DatabasePath);
        var (_, init) = Start();
        Assert.Throws<ConfigFileException>(init.Initialize);
        Assert.Equal("{ broken", File.ReadAllText(Options.ConfigPath));
        Assert.Equal(stamp, File.GetLastWriteTimeUtc(Options.DatabasePath));
    }

    [Fact]
    public void Imports_made_before_entries_were_marked_mark_what_the_latest_import_of_each_month_added_or_updated()
    {
        Start().Init.Initialize();
        using (var c = Open())
        {
            c.Execute(
                """
                DROP TABLE import_batch_entries;
                DROP TABLE entry_no_arrival;
                DROP TABLE arrival_import_marks;
                DROP TABLE deleted_arrivals;
                DROP TABLE arrival_entries;
                DROP TABLE arrival_refs;
                DROP TABLE arrivals;
                DROP TABLE arrival_import_batches;
                ALTER TABLE entries DROP COLUMN nett_less;
                ALTER TABLE deleted_entries DROP COLUMN nett_less;
                PRAGMA user_version = 8;
                INSERT INTO import_batches(id, file_name, sha256, register_month, imported_at, entry_count, dispatch_count) VALUES
                    (1, 'oct-1.xlsm', 'A', '2026-10', '2026-10-05 10:00:00', 3, 0),
                    (2, 'oct-2.xlsm', 'B', '2026-10', '2026-10-20 10:00:00', 1, 0),
                    (3, 'nov-1.xlsm', 'C', '2026-11', '2026-11-05 10:00:00', 1, 0);
                INSERT INTO entries(id, register_month, inward_no, entry_date, party, than, finish, import_batch_id, source_row, created_at, updated_at) VALUES
                    (1, '2026-10', 1, '2026-10-01', 'P', 10, 'F', 2, 5, '2026-10-05 10:00:00', '2026-10-05 10:00:00'),
                    (2, '2026-10', 2, '2026-10-01', 'P', 10, 'F', 2, 6, '2026-10-05 10:00:00', '2026-10-20 10:00:00'),
                    (3, '2026-10', 3, '2026-10-01', 'P', 10, 'F', 2, 7, '2026-10-05 10:00:00', '2026-10-21 09:00:00'),
                    (4, '2026-10', 4, '2026-10-15', 'P', 10, 'F', 2, 8, '2026-10-20 10:00:00', '2026-10-22 09:00:00'),
                    (5, '2026-10', 5, '2026-10-16', 'P', 10, 'F', NULL, NULL, '2026-10-20 10:00:00', '2026-10-20 10:00:00'),
                    (6, '2026-11', 1, '2026-11-01', 'P', 10, 'F', 3, 5, '2026-11-05 10:00:00', '2026-11-05 10:00:00');
                """);
        }

        Start().Init.Initialize();
        using var db = Open();
        Assert.Equal(DatabaseInitializer.LatestVersion, Version(db));
        var marks = db.Query<(long Batch, long Entry, string Action, int Row)>("SELECT batch_id, entry_id, action, source_row FROM import_batch_entries ORDER BY entry_id;").ToList();
        // 1 matched unchanged, 3 was edited in the app since (its change is not known), 5 was typed in the app.
        Assert.Equal([(2L, 2L, "updated", 6), (2L, 4L, "added", 8), (3L, 6L, "added", 5)], marks);
    }
}

public sealed class DataFolderTests : IDisposable
{
    private readonly TempFolder app = Make.Folder();

    public void Dispose() => app.Dispose();

    [Fact]
    public void The_environment_variable_wins()
    {
        Directory.CreateDirectory(app.File("MPH Register Data"));
        var (path, source) = DataFolder.Resolve(app.File("custom"), app.Path, "/docs");
        Assert.Equal((Path.GetFullPath(app.File("custom")), DataFolderSource.Environment), (path, source));
    }

    [Fact]
    public void A_data_folder_next_to_the_app_is_used_when_it_exists()
    {
        Directory.CreateDirectory(app.File("MPH Register Data"));
        var (path, source) = DataFolder.Resolve(null, app.Path, "/docs");
        Assert.Equal((Path.GetFullPath(app.File("MPH Register Data")), DataFolderSource.NextToApp), (path, source));
    }

    [Fact]
    public void Otherwise_documents_is_used()
    {
        var (path, source) = DataFolder.Resolve("  ", app.Path, "/docs");
        Assert.Equal((Path.Combine("/docs", "MPH Register Data"), DataFolderSource.Documents), (path, source));
    }

    [Fact]
    public void Without_a_documents_folder_the_app_folder_is_used() =>
        Assert.Equal(DataFolderSource.NextToApp, DataFolder.Resolve(null, app.Path, "").Source);
}
