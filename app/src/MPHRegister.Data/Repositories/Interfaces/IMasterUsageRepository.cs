using MPHRegister.Data.Entities;

namespace MPHRegister.Data.Repositories.Interfaces;

/// <summary>Where the data file uses party and finish names (the lists themselves are in the config file).</summary>
public interface IMasterUsageRepository
{
    IReadOnlyList<NameCount> PartyEntryCounts();

    IReadOnlyList<NameCount> PartyArrivalCounts();

    IReadOnlyList<NameCount> FinishEntryCounts();

    /// <summary>Moves entries, bills and AAWAK rows from one party name to another.</summary>
    void RenameParty(string from, string to);

    void RenameFinish(string from, string to);
}
