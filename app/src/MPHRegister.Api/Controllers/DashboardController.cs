using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;
using MPHRegister.Contracts.Dashboard;
using MPHRegister.Services.Interfaces;
using MPHRegister.Shared.Json;

namespace MPHRegister.Api.Controllers;

/// <summary>Financial dashboard: income, unbilled work, GST, parties and finishes, worked out on every request.</summary>
[Route("api/dashboard")]
public sealed class DashboardController(IDashboardService dashboard) : ApiControllerBase
{
    [HttpGet]
    public ActionResult<DashboardDto> Get([FromQuery] string? fy, [FromQuery] string? month, [FromQuery] string? party) =>
        dashboard.Get(fy, month, party);

    /// <summary>
    /// The figures the dashboard screen adds up by itself. Tagged with a hash of the answer: a request that sends the tag back
    /// in If-None-Match gets 304 Not Modified while nothing changed, so the screen's minute-by-minute refresh stays cheap.
    /// </summary>
    [HttpGet("facts")]
    [ProducesResponseType<DashboardFactsDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status304NotModified)]
    public IActionResult Facts()
    {
        var body = JsonSerializer.SerializeToUtf8Bytes(dashboard.Facts(), JsonDefaults.Options);
        var tag = new EntityTagHeaderValue($"\"{Convert.ToHexString(SHA256.HashData(body), 0, 16)}\"");
        return File(body, "application/json", lastModified: null, entityTag: tag);
    }
}
