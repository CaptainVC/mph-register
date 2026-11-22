using MPHRegister.Data.Entities;
using MPHRegister.Services.Imports.Inward;
using MPHRegister.UnitTests.TestSupport;

namespace MPHRegister.UnitTests.Imports;

public sealed class EntryUpdaterTests
{
    private static readonly EntryEntity Saved = new()
    {
        Id = 9, RegisterMonth = "2026-10", InwardNo = 939, EntryDate = "2026-10-25", Party = "PARTY A", DesignNo = "D1", LotNo = "L1", Than = 20, Finish = "F1",
    };

    private static readonly DispatchEntity First = new() { EntryId = 9, Qty = 12, GatePass = "4809", DispatchDate = "2026-10-26" };

    private static InwardRow Row(string finish = "F1", string lot = "L1", int than = 20, string party = "PARTY A", IReadOnlyList<InwardDispatch>? dispatches = null) =>
        new(941, 939, "2026-10-25", party, "D1", lot, false, than, 0, 0, finish, null, false, dispatches ?? []);

    private static readonly InwardDispatch Sent = new(12, "4809", "2026-10-26", null);

    private static readonly InwardDispatch Later = new(8, "5001", "2026-11-03", null);

    [Fact]
    public void A_value_changed_in_the_workbook_is_taken()
    {
        var update = EntryUpdater.Update(Saved, [First], Row(finish: "F2", dispatches: [Sent]), SourceValues.Of(Row(dispatches: [Sent])));
        Assert.Equal("F2", update.Entry.Finish);
        Assert.Equal(["FINISH F1 → F2"], update.Changes);
        Assert.True(update.FieldsChanged);
        Assert.False(update.DispatchesChanged);
        Assert.Empty(update.Kept);
    }

    [Fact]
    public void A_value_changed_only_in_the_app_is_kept_without_a_word()
    {
        var update = EntryUpdater.Update(Saved with { LotNo = "L1X" }, [First], Row(dispatches: [Sent]), SourceValues.Of(Row(dispatches: [Sent])));
        Assert.Equal("L1X", update.Entry.LotNo);
        Assert.False(update.Changed);
        Assert.Empty(update.Changes);
        Assert.Empty(update.Kept);
    }

    [Fact]
    public void A_value_changed_on_both_sides_keeps_the_app_and_says_so()
    {
        var update = EntryUpdater.Update(Saved with { Than = 19 }, [First], Row(than: 29, dispatches: [Sent]), SourceValues.Of(Row(dispatches: [Sent])));
        Assert.Equal(19, update.Entry.Than);
        Assert.False(update.Changed);
        Assert.Equal(["THAN 19 (workbook: 29)"], update.Kept);
    }

    [Fact]
    public void Without_the_last_row_blanks_are_filled_in_and_other_differences_kept()
    {
        var update = EntryUpdater.Update(Saved with { Finish = "" }, [First], Row(finish: "F2", lot: "L9", dispatches: [Sent]), last: null);
        Assert.Equal("F2", update.Entry.Finish);
        Assert.Equal("L1", update.Entry.LotNo);
        Assert.Equal(["FINISH filled in (F2)"], update.Changes);
        Assert.Equal(["LOT N. L1 (workbook: L9)"], update.Kept);
    }

    [Fact]
    public void A_name_the_lists_do_not_know_never_replaces_the_apps()
    {
        var last = SourceValues.Of(Saved, [First]);
        var update = EntryUpdater.Update(Saved, [First], Row(party: "PARTY OLD", dispatches: [Sent]), last, newParty: true);
        Assert.Equal("PARTY A", update.Entry.Party);
        Assert.Equal(["PARTY PARTY A (workbook: PARTY OLD)"], update.Kept);
    }

    [Fact]
    public void Dispatches_a_later_month_added_stay_when_the_workbook_did_not_change_them()
    {
        var later = new DispatchEntity { EntryId = 9, Qty = 8, GatePass = "5001", DispatchDate = "2026-11-03" };
        var update = EntryUpdater.Update(Saved, [First, later], Row(finish: "F2", dispatches: [Sent]), SourceValues.Of(Row(dispatches: [Sent])));
        Assert.Equal(2, update.Dispatches.Count);
        Assert.False(update.DispatchesChanged);
        Assert.Equal(["FINISH F1 → F2"], update.Changes);
    }

    [Fact]
    public void Dispatches_the_app_has_after_the_workbooks_are_kept_when_the_last_ones_are_unknown()
    {
        var later = new DispatchEntity { EntryId = 9, Qty = 8, GatePass = "5001", DispatchDate = "2026-11-03" };
        var update = EntryUpdater.Update(Saved, [First, later], Row(dispatches: [Sent]), SourceValues.Of(Saved, [First, later]), lastHasDispatches: false);
        Assert.Equal(2, update.Dispatches.Count);
        Assert.False(update.Changed);
    }

    [Fact]
    public void Dispatches_added_in_the_workbook_are_added()
    {
        var update = EntryUpdater.Update(Saved, [First], Row(dispatches: [Sent, Later]), SourceValues.Of(Row(dispatches: [Sent])));
        Assert.Equal(2, update.Dispatches.Count);
        Assert.True(update.DispatchesChanged);
        Assert.Equal(["1 later dispatch(es) added"], update.Changes);
    }

    [Fact]
    public void A_dispatch_corrected_in_the_workbook_replaces_the_old_one()
    {
        var update = EntryUpdater.Update(Saved, [First], Row(dispatches: [Sent with { GatePass = "4890" }]), SourceValues.Of(Row(dispatches: [Sent])));
        Assert.Equal("4890", Assert.Single(update.Dispatches).GatePass);
        Assert.Equal(["dispatches 12 (gate pass 4809, 2026-10-26) → 12 (gate pass 4890, 2026-10-26)"], update.Changes);
    }

    [Fact]
    public void Dispatches_changed_on_both_sides_keep_the_apps()
    {
        var edited = First with { Qty = 11 };
        var update = EntryUpdater.Update(Saved, [edited], Row(dispatches: [Sent with { GatePass = "4890" }]), SourceValues.Of(Row(dispatches: [Sent])));
        Assert.Equal(11, Assert.Single(update.Dispatches).Qty);
        Assert.False(update.DispatchesChanged);
        Assert.Single(update.Kept);
    }

    [Fact]
    public void A_dispatch_deleted_in_the_app_does_not_come_back_with_one_the_workbook_added()
    {
        var third = new InwardDispatch(2, "6001", "2026-11-09", null);
        var update = EntryUpdater.Update(Saved, [First], Row(dispatches: [Sent, Later, third]), SourceValues.Of(Row(dispatches: [Sent, Later])));
        Assert.Single(update.Dispatches);
        Assert.False(update.DispatchesChanged);
        Assert.Single(update.Kept);
    }

    [Fact]
    public void A_dispatch_the_workbook_removed_is_listed_when_a_later_month_added_another()
    {
        var later = new DispatchEntity { EntryId = 9, Qty = 8, GatePass = "5001", DispatchDate = "2026-11-03" };
        var third = new DispatchEntity { EntryId = 9, Qty = 2, GatePass = "6001", DispatchDate = "2026-11-09" };
        var update = EntryUpdater.Update(Saved, [First, later, third], Row(dispatches: [Sent]), SourceValues.Of(Row(dispatches: [Sent, Later])));
        Assert.Equal(3, update.Dispatches.Count);
        Assert.False(update.Changed);
        Assert.Single(update.Kept);
    }

    [Fact]
    public void The_stored_row_survives_a_round_trip()
    {
        var row = SourceValues.Of(Row(dispatches: [Sent, new InwardDispatch(1, "", null, "26-110")]));
        var back = SourceValues.FromJson(row.ToJson());
        Assert.NotNull(back);
        Assert.Equal(row.Party, back.Party);
        Assert.Equal(row.Dispatches, back.Dispatches);
        Assert.Null(SourceValues.FromJson("not json"));
        Assert.Null(SourceValues.FromJson(null));
    }
}

public sealed class SavedEntryMatcherTests
{
    private static EntryEntity Entry(long id, int inward, string date, string party, string dn = "", int than = 10, string lot = "", int? row = null) =>
        new() { Id = id, RegisterMonth = "2026-10", InwardNo = inward, EntryDate = date, Party = party, DesignNo = dn, LotNo = lot, Than = than, ImportBatchId = 1, SourceRow = row };

    private static InwardRow Row(int row, int inward, string date, string party, string dn = "", int than = 10, string lot = "") =>
        new(row, inward, date, party, dn, lot, false, than, 0, 0, "F1", null, false, []);

    private static readonly Dictionary<long, SourceValues> NoRows = [];

    /// <summary>As the import plans it: slips, then loose matching of what is left, then shared slips in order.</summary>
    private static Dictionary<int, EntryEntity> Match(InwardRow[] rows, EntryEntity[] saved)
    {
        var (matches, shared) = SavedEntryMatcher.BySlip(rows, saved, NoRows);
        var taken = matches.Values.Select(e => e.Id).ToHashSet();
        foreach (var (i, entry) in SavedEntryMatcher.Loosely(rows, Enumerable.Range(0, rows.Length).Where(i => !matches.ContainsKey(i)), saved.Where(e => !taken.Contains(e.Id))))
            matches[i] = entry;
        SavedEntryMatcher.InOrder(shared, matches);
        return matches;
    }

    [Fact]
    public void Rows_match_their_slip_then_their_number_then_their_contents()
    {
        var saved = new[] { Entry(1, 1, "2026-10-01", "PARTY A"), Entry(2, 2, "2026-10-01", "PARTY A", "D2"), Entry(3, 3, "2026-10-02", "PARTY B", "D3", 7) };
        var rows = new[] { Row(2, 1, "2026-10-01", "party a"), Row(3, 2, "2026-10-04", "PARTY A", "D2"), Row(4, 33, "2026-10-02", "PARTY B", "D3", 7), Row(5, 4, "2026-10-03", "PARTY C") };
        var (exact, shared) = SavedEntryMatcher.BySlip(rows, saved, NoRows);
        Assert.Equal(1, Assert.Single(exact).Value.Id);
        Assert.Empty(shared);
        var loose = SavedEntryMatcher.Loosely(rows, [1, 2, 3], saved.Where(e => e.Id != 1));
        Assert.Equal(2, loose[1].Id);
        Assert.Equal(3, loose[2].Id);
        Assert.False(loose.ContainsKey(3));
    }

    [Fact]
    public void Ambiguous_rows_are_not_matched_loosely()
    {
        var saved = new[] { Entry(1, 5, "2026-10-01", "PARTY A"), Entry(2, 5, "2026-10-02", "PARTY B") };
        var rows = new[] { Row(2, 5, "2026-10-03", "PARTY A") };
        Assert.Empty(SavedEntryMatcher.Loosely(rows, [0], saved));
    }

    [Fact]
    public void Rows_sharing_a_blank_inward_number_keep_their_own_entries_when_one_is_added_or_deleted()
    {
        var saved = new[] { Entry(1, 0, "2026-06-28", "PARTY A", lot: "L643", row: 554), Entry(2, 0, "2026-06-28", "PARTY A", lot: "L208", row: 555), Entry(3, 0, "2026-06-28", "PARTY A", lot: "L786", row: 556) };
        var added = new[] { Row(554, 0, "2026-06-28", "PARTY A", than: 12, lot: "L999"), Row(555, 0, "2026-06-28", "PARTY A", lot: "L643"), Row(556, 0, "2026-06-28", "PARTY A", lot: "L208"), Row(557, 0, "2026-06-28", "PARTY A", lot: "L786") };
        Assert.Equal([(1, 1L), (2, 2L), (3, 3L)], Match(added, saved).OrderBy(m => m.Key).Select(m => (m.Key, m.Value.Id)));

        var deleted = new[] { Row(554, 0, "2026-06-28", "PARTY A", lot: "L643"), Row(555, 0, "2026-06-28", "PARTY A", lot: "L786") };
        Assert.Equal([(0, 1L), (1, 3L)], Match(deleted, saved).OrderBy(m => m.Key).Select(m => (m.Key, m.Value.Id)));

        var corrected = new[] { Row(554, 0, "2026-06-28", "PARTY A", lot: "L643"), Row(555, 0, "2026-06-28", "PARTY A", lot: "L209"), Row(556, 0, "2026-06-28", "PARTY A", lot: "L786") };
        Assert.Equal([(0, 1L), (1, 2L), (2, 3L)], Match(corrected, saved).OrderBy(m => m.Key).Select(m => (m.Key, m.Value.Id)));
    }

    [Fact]
    public void A_shared_slip_entry_given_a_number_in_the_register_is_still_found_by_its_contents()
    {
        var saved = new[] { Entry(1, 0, "2026-06-28", "PARTY A", lot: "L643", row: 554), Entry(2, 701, "2026-06-28", "PARTY A", lot: "L208", row: 555), Entry(3, 0, "2026-06-28", "PARTY A", lot: "L786", row: 556) };
        var rows = new[] { Row(554, 0, "2026-06-28", "PARTY A", lot: "L643"), Row(555, 0, "2026-06-28", "PARTY A", lot: "L208"), Row(556, 0, "2026-06-28", "PARTY A", lot: "L7860") };
        Assert.Equal([(0, 1L), (1, 2L), (2, 3L)], Match(rows, saved).OrderBy(m => m.Key).Select(m => (m.Key, m.Value.Id)));
    }
}

public sealed class InwardWorkbookTests
{
    [Fact]
    public void The_made_up_workbook_reads_like_a_register()
    {
        using var folder = Make.Folder();
        var path = InwardWorkbook.Write(folder.File("INWARD REG.-OCT.-26-27.xlsx"), [
            new SheetRow(1, "2026-10-01", "PARTY A", "D1", "L1", 12).Sent((12, "G1", "2026-10-03")),
            new SheetRow(2, "2026-10-02", "PARTY B", Finish: "", Tp: 1),
            null,
            new SheetRow(7, "2026-09-20", "PARTY A", "D7"),
        ]);
        var sheet = InwardSheetReader.Read(path);
        Assert.Empty(sheet.Errors);
        Assert.Equal(3, sheet.Rows.Count);
        var first = sheet.Rows[0];
        Assert.Equal((2, 1, "2026-10-01", "PARTY A", "D1", "L1", 12, "F1"), (first.Row, first.InwardNo, first.Date, first.Party, first.Design, first.Lot, first.Than, first.Finish));
        Assert.Equal(new InwardDispatch(12, "G1", "2026-10-03", null), Assert.Single(first.Dispatches));
        Assert.Equal((1, ""), (sheet.Rows[1].Tp, sheet.Rows[1].Finish));
        Assert.True(sheet.Rows[2].AfterBlankRows);
    }
}
