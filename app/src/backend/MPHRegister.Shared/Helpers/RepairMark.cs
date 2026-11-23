namespace MPHRegister.Shared.Helpers;

/// <summary>
/// The inward registers mark a repair (re-work, never charged) by writing R in LOT N. or D.N.: "R", "R,118,125", "R 146",
/// "R1064", "12858,R", "R  12980", sometimes "REP.". The text has no other letters, so lot names that only start with R
/// ("RAJWADI", "R mix", "RB,325") are not the mark. In the April–November 2026 registers 97 entries carry it and 93 of them
/// say REP. Yes; the April–September bills list such rows after the priced lines, without a rate.
/// </summary>
public static class RepairMark
{
    public static bool In(string? lotNo, string? designNo) => Is(lotNo) || Is(designNo);

    public static bool Is(string? text)
    {
        if (string.IsNullOrEmpty(text)) return false;
        var letters = string.Concat(text.Where(char.IsAsciiLetter)).ToUpperInvariant();
        return letters is "R" or "REP" or "REPAIR";
    }
}
