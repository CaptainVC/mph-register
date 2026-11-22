using MPHRegister.Contracts.Dashboard;

namespace MPHRegister.Services.Interfaces;

public interface IDashboardService
{
    /// <param name="fy">Financial year like "26-27"; the current one when missing or unknown.</param>
    /// <param name="month">yyyy-MM inside that year to look at closely; the last finished month when missing.</param>
    /// <param name="party">Exact party name (case and extra whitespace ignored); blank for all parties.</param>
    DashboardDto Get(string? fy, string? month, string? party);
}
