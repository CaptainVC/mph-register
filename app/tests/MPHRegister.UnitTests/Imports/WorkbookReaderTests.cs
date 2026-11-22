using MPHRegister.Services.Imports.Bills;
using MPHRegister.Services.Imports.Inward;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.UnitTests.Imports;

/// <summary>
/// Reads the real workbooks in the Workbooks folder next to the checkout, or MPH_WORKBOOKS (skipped when they are not
/// there). Real party names come from Workbooks/private-test-data.json, never from git.
/// </summary>
public sealed class WorkbookReaderTests
{
    private static readonly string Workbooks = Environment.GetEnvironmentVariable("MPH_WORKBOOKS") ?? FindWorkbooks();

    /// <summary>The Workbooks folder next to the worktrees, however deep the worktree's folder is (main, fix/&lt;name&gt;).</summary>
    private static string FindWorkbooks()
    {
        for (var folder = new DirectoryInfo(AppContext.BaseDirectory); folder is not null; folder = folder.Parent)
        {
            var candidate = Path.Combine(folder.FullName, "Workbooks");
            if (Directory.Exists(candidate)) return candidate;
        }
        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "..", "..", "Workbooks"));
    }
    private static readonly string History = Path.Combine(Workbooks, "History");

    private static string? PrivateParty(string alias)
    {
        var file = Environment.GetEnvironmentVariable("MPH_PRIVATE_TEST_DATA") ?? Path.Combine(Workbooks, "private-test-data.json");
        if (!File.Exists(file)) return null;
        using var json = System.Text.Json.JsonDocument.Parse(File.ReadAllText(file));
        return json.RootElement.GetProperty("parties").GetProperty(alias).GetString();
    }

    [Fact]
    public void October_inward_register_reads_all_rows()
    {
        var path = Path.Combine(Workbooks, "INWARD REG.-OCT.-26-27.xlsm");
        if (!File.Exists(path)) return;
        var sheet = InwardSheetReader.Read(path);
        Assert.Empty(sheet.Errors);
        Assert.Equal(985, sheet.Rows.Count);
        Assert.Equal(39184, sheet.Rows.Sum(r => r.Than));
    }

    [Fact]
    public void October_all_zero_slips_are_read_without_quantity_or_finish_warnings()
    {
        var path = Path.Combine(Workbooks, "INWARD REG.-OCT.-26-27.xlsm");
        if (!File.Exists(path)) return;
        var sheet = InwardSheetReader.Read(path);
        var slips = sheet.Rows.Where(r => r.Than + r.Tp + r.TwoPart == 0 && r.Dispatches.Count == 0).ToList();
        Assert.Equal([84, 85], slips.Select(r => r.InwardNo));
        Assert.DoesNotContain(sheet.Warnings, w => slips.Any(s => s.Row == w.Row) && (w.Message == "FINISH is blank." || w.Message == "THAN + TP is 0."));
    }

    [Fact]
    public void November_R_lots_left_at_REP_No_are_read_as_repairs()
    {
        var path = Path.Combine(History, "Inwards", "INWARD REG.-NOV.-26-27.xlsm");
        if (!File.Exists(path)) return;
        var sheet = InwardSheetReader.Read(path);
        Assert.Empty(sheet.Errors);
        // INW. NO. 397 and 398 (ARNOLD TEXTILES) and 414 (SHERWOOD FAB TEX) have LOT N. R but REP. No and no finish.
        var marked = sheet.Rows.Where(r => r.Row is 398 or 399 or 415).ToList();
        Assert.Equal([397, 398, 414], marked.Select(r => r.InwardNo));
        Assert.All(marked, r => Assert.True(r.Repair));
        Assert.All(marked, r => Assert.Contains(sheet.Warnings, w => w.Row == r.Row && w.Message.Contains("marked R (repair)", StringComparison.Ordinal)));
        Assert.DoesNotContain(sheet.Warnings, w => marked.Any(r => r.Row == w.Row) && (w.Message == "FINISH is blank." || w.Message.StartsWith("Sheet NETT THAN", StringComparison.Ordinal)));
        Assert.All(sheet.Rows.Where(r => RepairMark.In(r.Lot, r.Design)), r => Assert.True(r.Repair));
    }

    [Fact]
    public void August_R_mix_lot_stays_charged()
    {
        // Billed in JOB\184 as lot MIX, 18 THAN at 90: a lot name, not the repair mark.
        var path = Path.Combine(History, "Inwards", "INWARD REG.-AUG.-26-27.xlsm");
        if (!File.Exists(path)) return;
        var row = InwardSheetReader.Read(path).Rows.Single(r => r.Row == 44);
        Assert.Equal(("R mix", false, 18), (row.Lot, row.Repair, row.Than));
    }

    [Fact]
    public void Earlier_registers_already_say_REP_Yes_for_every_R_mark_except_one_slip()
    {
        // Only July INW. NO. 66 (SHERWOOD FAB TEX, 1 THAN) was left at No; the others already said Yes.
        var months = new[] { "APR.-26-27", "MAY.-26-27", "JUN.-26-29", "JUL.-26-27", "AUG.-26-27", "SEP.-26-27" };
        var paths = months.Select(m => Path.Combine(History, "Inwards", $"INWARD REG.-{m}.xlsm")).Append(Path.Combine(Workbooks, "INWARD REG.-OCT.-26-27.xlsm")).ToList();
        if (!paths.All(File.Exists)) return;
        var inferred = paths.Select(p => (Path.GetFileName(p), InwardSheetReader.Read(p)))
            .SelectMany(s => s.Item2.Warnings.Where(w => w.Message.Contains("marked R (repair)", StringComparison.Ordinal)).Select(w => (s.Item1, w.Row)))
            .ToList();
        Assert.Equal([("INWARD REG.-JUL.-26-27.xlsm", 67)], inferred);
    }

    [Fact]
    public void June_register_quirks_become_warnings_not_errors()
    {
        var path = Path.Combine(History, "Inwards", "INWARD REG.-JUN.-26-29.xlsm");
        if (!File.Exists(path)) return;
        var sheet = InwardSheetReader.Read(path);
        Assert.Empty(sheet.Errors);
        Assert.Contains(sheet.Warnings, w => w.Row == 559 && w.Message.Contains("only zero", StringComparison.Ordinal));
        Assert.Contains(sheet.Warnings, w => w.Row == 554 && w.Message.Contains("INW. NO. is blank", StringComparison.Ordinal));
        Assert.Equal(43, sheet.Rows.Count(r => r.AfterBlankRows));
    }

    [Fact]
    public void July_placeholder_dispatches_are_skipped()
    {
        var path = Path.Combine(History, "Inwards", "INWARD REG.-JUL.-26-27.xlsm");
        if (!File.Exists(path)) return;
        var sheet = InwardSheetReader.Read(path);
        Assert.Empty(sheet.Errors);
        Assert.Empty(sheet.Rows.Single(r => r.Row == 4).Dispatches);
    }

    [Fact]
    public void September_impossible_dispatch_date_is_kept_as_text()
    {
        var path = Path.Combine(History, "Inwards", "INWARD REG.-SEP.-26-27.xlsm");
        if (!File.Exists(path)) return;
        var dispatch = InwardSheetReader.Read(path).Rows.Single(r => r.Row == 608).Dispatches[0];
        Assert.Null(dispatch.Date);
        Assert.Equal("06.08.1900", dispatch.DateText);
    }

    [Fact]
    public void October_bill_workbook_reads_51_bills_with_their_totals()
    {
        var path = Path.Combine(Workbooks, "MPH BILL--OCT.-26-27.xlsm");
        if (!File.Exists(path)) return;
        var sheet = BillSheetReader.Read(path)!;
        Assert.Empty(sheet.Errors);
        Assert.Equal(51, sheet.Bills.Count);
        Assert.Equal(3174475, sheet.Bills.Sum(b => b.Total));
        var first = sheet.Bills.Single(b => b.InvoiceNo == "26-27\\JOB\\228");
        Assert.True(first.Lines[^1].AutoSum);
        Assert.Equal(LineKind.Priced, first.Lines[^1].Kind);
        if (PrivateParty("octoberFirstBill") is not { } firstParty) return;
        Assert.Equal(firstParty, first.PartyText);
        Assert.Contains(PrivateParty("correctionTarget")!, sheet.Parties.Keys);
    }
}
