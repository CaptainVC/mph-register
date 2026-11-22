namespace MPHRegister.Shared.Helpers;

/// <summary>
/// An inward slip kept in the register only for its number: its THAN came in after the register month began but were
/// entered (and billed) in the earlier register, so here THAN, TP and TWO PART are all 0 and nothing is dispatched.
/// Such a row is not a mistake: it needs no finish and is never billed.
/// </summary>
public static class AllZeroSlip
{
    public static bool Is(int than, int tp, int twoPart, int dispatchCount) =>
        than == 0 && tp == 0 && twoPart == 0 && dispatchCount == 0;
}
