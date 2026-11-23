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
}
