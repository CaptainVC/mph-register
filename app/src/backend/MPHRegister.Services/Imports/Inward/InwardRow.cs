namespace MPHRegister.Services.Imports.Inward;

public sealed record InwardDispatch(int Qty, string GatePass, string? Date, string? DateText);

public sealed record InwardRow(
    int Row,
    int InwardNo,
    string Date,
    string Party,
    string Design,
    string Lot,
    bool Repair,
    int Than,
    int Tp,
    int TwoPart,
    string Finish,
    int? ShortThan,
    bool AfterBlankRows,
    IReadOnlyList<InwardDispatch> Dispatches)
{
    /// <summary>REP. said No and only the R in LOT N. or D.N. made it a repair (see RepairMark).</summary>
    public bool RepairFromMark { get; init; }

    /// <summary>THAN the sheet's NETT THAN charges less than THAN: 1 when THAN is 24 and NETT THAN was typed over as 23. 0 when it is the formula's.</summary>
    public int NettLess { get; init; }

    /// <summary>What the sheet charges: THAN less NettLess, and nothing for a repair.</summary>
    public int NettThan => Repair ? 0 : Math.Max(0, Than - NettLess);
}
