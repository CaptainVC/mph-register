using Microsoft.AspNetCore.Mvc;
using MPHRegister.Contracts.Dashboard;
using MPHRegister.Services.Interfaces;

namespace MPHRegister.Api.Controllers;

/// <summary>Financial dashboard: income, unbilled work, GST, parties and finishes, worked out on every request.</summary>
[Route("api/dashboard")]
public sealed class DashboardController(IDashboardService dashboard) : ApiControllerBase
{
    [HttpGet]
    public ActionResult<DashboardDto> Get([FromQuery] string? fy, [FromQuery] string? month) => dashboard.Get(fy, month);
}
