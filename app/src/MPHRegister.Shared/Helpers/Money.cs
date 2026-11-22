namespace MPHRegister.Shared.Helpers;

public static class Money
{
    /// <summary>Same as Excel ROUND(x, 0): halves go away from zero.</summary>
    public static long RoundRupee(decimal value) => (long)Math.Round(value, 0, MidpointRounding.AwayFromZero);
}
