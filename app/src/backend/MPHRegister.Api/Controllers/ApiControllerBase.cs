using Microsoft.AspNetCore.Mvc;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Api.Controllers;

[ApiController]
[Produces("application/json")]
public abstract class ApiControllerBase : ControllerBase
{
    /// <summary>
    /// <c>?fy=2026</c>: the months of the financial year 2026-04 to 2027-03. A <c>month</c> in the query wins, even an empty one
    /// (which keeps meaning every month), so the answer to a request that worked before stays the same.
    /// </summary>
    protected MonthRange? YearOf(string? fy) => Request.Query.ContainsKey("month") ? null : MonthRange.FinancialYear(fy);
}
