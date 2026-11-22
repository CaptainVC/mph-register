using MPHRegister.Data.Entities;

namespace MPHRegister.Data.Repositories.Interfaces;

/// <summary>Read-only figures for the financial dashboard.</summary>
public interface IDashboardRepository
{
    /// <summary>Saved bills with a bill date from <paramref name="from"/> to <paramref name="to"/> (ISO dates).</summary>
    IReadOnlyList<DashboardBillRow> Bills(string from, string to);

    /// <summary>Priced lines of saved bills dated in the range, per finish.</summary>
    IReadOnlyList<DashboardFinishRow> Finishes(string from, string to, IReadOnlyList<string>? billParties);

    /// <summary>Inward entries and dispatch quantities recorded through the given date, including undated quantities.</summary>
    IReadOnlyList<DashboardEntryRow> Entries(string asOf);

    IReadOnlyList<DashboardPartyBillDate> LatestBillDates(string asOf);

    /// <summary>Earliest saved bill or inward date, or null when there is no data.</summary>
    string? EarliestDate();
}
