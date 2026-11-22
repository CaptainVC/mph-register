using Dapper;

namespace MPHRegister.Data.Database;

public static class DapperSetup
{
    private static int configured;

    public static void Configure()
    {
        if (Interlocked.Exchange(ref configured, 1) == 1) return;
        DefaultTypeMap.MatchNamesWithUnderscores = true;
    }
}
