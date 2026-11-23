namespace MPHRegister.Shared.Helpers;

/// <summary>
/// The inward slips an all-zero entry's D.N. points to. Such a slip is kept only for its number; its D.N. says where its
/// THAN were entered: "INW NO 547", "INW NO,548", "INW NO 12-14". A D.N. without "INW" is a design number, not a reference.
/// </summary>
public static class InwardReference
{
    public static bool Mentions(string? designNo) => designNo?.Contains("INW", StringComparison.OrdinalIgnoreCase) == true;

    public static IReadOnlyList<int> Numbers(string? designNo) =>
        Mentions(designNo) ? InwardNumbers.Read(designNo).Numbers.Distinct().ToList() : [];
}
