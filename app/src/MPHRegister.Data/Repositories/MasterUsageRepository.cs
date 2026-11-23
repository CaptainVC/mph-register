using MPHRegister.Data.Database;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;

namespace MPHRegister.Data.Repositories;

public sealed class MasterUsageRepository(IDbSession session) : RepositoryBase(session), IMasterUsageRepository
{
    public IReadOnlyList<NameCount> PartyEntryCounts() =>
        Query<NameCount>("SELECT party AS name, COUNT(*) AS count FROM entries GROUP BY party COLLATE NOCASE;");

    public IReadOnlyList<NameCount> PartyArrivalCounts() =>
        Query<NameCount>("SELECT party AS name, COUNT(*) AS count FROM arrivals GROUP BY party COLLATE NOCASE;");

    public IReadOnlyList<NameCount> FinishEntryCounts() =>
        Query<NameCount>("SELECT finish AS name, COUNT(*) AS count FROM entries GROUP BY finish COLLATE NOCASE;");

    public void RenameParty(string from, string to) => Execute(
        """
        UPDATE entries SET party = @to WHERE party = @from COLLATE NOCASE;
        UPDATE deleted_entries SET party = @to WHERE party = @from COLLATE NOCASE;
        UPDATE invoices SET party = @to WHERE party = @from COLLATE NOCASE;
        UPDATE arrivals SET party = @to WHERE party = @from COLLATE NOCASE;
        UPDATE deleted_arrivals SET party = @to WHERE party = @from COLLATE NOCASE;
        """,
        new { from, to });

    public void RenameFinish(string from, string to) => Execute(
        """
        UPDATE entries SET finish = @to WHERE finish = @from COLLATE NOCASE;
        UPDATE deleted_entries SET finish = @to WHERE finish = @from COLLATE NOCASE;
        """,
        new { from, to });
}
