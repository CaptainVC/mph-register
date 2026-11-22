using MPHRegister.Data.Entities;
using MPHRegister.Services.Mapping;
using MPHRegister.Shared.Enums;

namespace MPHRegister.UnitTests.Mapping;

public sealed class EntryMapperTests
{
    private static EntryEntity Row(int than = 0, int tp = 0, int twoPart = 0, string finish = "", int inward = 19) => new()
    {
        Id = 1, RegisterMonth = "2026-11", InwardNo = inward, EntryDate = "2026-10-26", Party = "P", DesignNo = "INW.-982",
        Than = than, Tp = tp, TwoPart = twoPart, Finish = finish,
    };

    private static DispatchEntity Sent(int qty) => new() { Qty = qty, GatePass = "1", DispatchDate = "2026-10-27" };

    [Fact]
    public void All_zero_slip_has_its_own_status_and_no_quantity_or_finish_warnings()
    {
        var dto = EntryMapper.ToDto(Row(), [], duplicateNumber: false);
        Assert.Equal(EntryStatus.AllZero, dto.Status);
        Assert.Empty(dto.Warnings);
        Assert.Equal(0, dto.Balance);
    }

    [Fact]
    public void All_zero_slip_keeps_the_other_warnings()
    {
        var dto = EntryMapper.ToDto(Row(inward: 0), [], duplicateNumber: false);
        Assert.Equal(EntryStatus.AllZero, dto.Status);
        Assert.Equal(["INW. NO. is blank in the register."], dto.Warnings);
    }

    [Fact]
    public void Zero_than_with_two_part_or_a_dispatch_is_still_flagged()
    {
        var twoPart = EntryMapper.ToDto(Row(twoPart: 2), [], duplicateNumber: false);
        Assert.Equal(EntryStatus.Pending, twoPart.Status);
        Assert.Contains("THAN + TP is 0.", twoPart.Warnings);
        Assert.Contains("Finish is missing.", twoPart.Warnings);

        var dispatched = EntryMapper.ToDto(Row(finish: "F1"), [Sent(1)], duplicateNumber: false);
        Assert.Equal(EntryStatus.Over, dispatched.Status);
        Assert.Contains("THAN + TP is 0.", dispatched.Warnings);
    }

    [Fact]
    public void A_real_entry_is_unchanged() =>
        Assert.Equal(EntryStatus.Done, EntryMapper.ToDto(Row(than: 5, finish: "F1"), [Sent(5)], duplicateNumber: false).Status);

    [Fact]
    public void A_repair_needs_no_finish_and_has_no_nett_than()
    {
        var dto = EntryMapper.ToDto(Row(than: 6) with { LotNo = "R", Repair = true }, [Sent(6)], duplicateNumber: false);
        Assert.Empty(dto.Warnings);
        Assert.Equal(0, dto.NettThan);
    }

    [Fact]
    public void An_R_lot_left_at_REP_No_is_flagged_as_charged()
    {
        var dto = EntryMapper.ToDto(Row(than: 6, finish: "F1") with { LotNo = "R" }, [], duplicateNumber: false);
        Assert.Equal([EntryMapper.MarkedButCharged], dto.Warnings);
        Assert.Equal(6, dto.NettThan);
        Assert.Empty(EntryMapper.ToDto(Row(than: 6, finish: "F1") with { LotNo = "R mix" }, [], duplicateNumber: false).Warnings);
    }
}
