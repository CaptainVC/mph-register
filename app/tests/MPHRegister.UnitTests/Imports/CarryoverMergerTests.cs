using MPHRegister.Data.Entities;
using MPHRegister.Services.Imports.Inward;

namespace MPHRegister.UnitTests.Imports;

public sealed class CarryoverMergerTests
{
    private static readonly EntryEntity Stored = new()
    {
        Id = 7, RegisterMonth = "2026-05", InwardNo = 653, EntryDate = "2026-05-13", Party = "PARTY A", LotNo = "8585", Than = 70, Tp = 1, Finish = "",
    };

    private static InwardRow Row(string finish, string lot, params InwardDispatch[] dispatches) =>
        new(583, 653, "2026-05-13", "PARTY A", "", lot, false, 70, 1, 0, finish, null, true, dispatches);

    [Fact]
    public void Later_dispatches_are_added_and_blanks_filled()
    {
        var (entry, dispatches, changes) = CarryoverMerger.Merge(Stored, [], Row("SGJ", "28585", new InwardDispatch(71, "2941", "2026-06-03", null)));
        Assert.Equal("SGJ", entry.Finish);
        Assert.Equal("28585", entry.LotNo);
        Assert.Single(dispatches);
        Assert.Contains("FINISH filled in (SGJ)", changes);
        Assert.Contains("LOT N. 8585 → 28585", changes);
    }

    [Fact]
    public void Only_a_written_REP_Yes_turns_a_repair_on()
    {
        var stored = Stored with { LotNo = "R", Finish = "SGJ" };
        var marked = Row("SGJ", "R") with { Repair = true, RepairFromMark = true };
        var (kept, _, keptChanges) = CarryoverMerger.Merge(stored, [], marked);
        Assert.False(kept.Repair);
        Assert.Empty(keptChanges);

        var (written, _, writtenChanges) = CarryoverMerger.Merge(stored, [], marked with { RepairFromMark = false });
        Assert.True(written.Repair);
        Assert.Equal(["REP. → YES"], writtenChanges);
    }

    [Fact]
    public void Identical_carryover_changes_nothing()
    {
        var old = new DispatchEntity { EntryId = 7, Qty = 71, GatePass = "2941", DispatchDate = "2026-06-03" };
        var (_, dispatches, changes) = CarryoverMerger.Merge(Stored with { Finish = "SGJ", LotNo = "28585" }, [old], Row("SGJ", "28585", new InwardDispatch(71, "2941", "2026-06-03", null)));
        Assert.Single(dispatches);
        Assert.Empty(changes);
    }

    [Fact]
    public void Different_dispatch_lists_keep_both()
    {
        var old = new DispatchEntity { EntryId = 7, Qty = 30, GatePass = "1", DispatchDate = "2026-05-20" };
        var (_, dispatches, changes) = CarryoverMerger.Merge(Stored, [old], Row("SGJ", "8585", new InwardDispatch(41, "2", "2026-06-02", null)));
        Assert.Equal(2, dispatches.Count);
        Assert.Contains(changes, c => c.Contains("both kept", StringComparison.Ordinal));
    }
}

public sealed class InwardGuessMonthTests
{
    [Theory]
    [InlineData("INWARD REG.-OCT.-26-27.xlsm", "2026-10")]
    [InlineData("INWARD REG.-JUN.-26-29.xlsm", "2026-06")]
    [InlineData("INWARD REG.-JAN.-26-27.xlsm", "2027-01")]
    [InlineData("register.xlsx", null)]
    public void Reads_the_month_from_the_file_name(string name, string? month) => Assert.Equal(month, InwardImportService.GuessMonth(name));
}
