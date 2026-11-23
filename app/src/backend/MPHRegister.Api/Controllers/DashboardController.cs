using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;
using MPHRegister.Api.Caching;
using MPHRegister.Contracts.Dashboard;
using MPHRegister.Services.Interfaces;
using MPHRegister.Shared.Json;

namespace MPHRegister.Api.Controllers;

/// <summary>
/// Financial dashboard: income, unbilled work, GST, parties and finishes. Each answer is tagged with what it was worked out
/// from (see <see cref="DashboardCache"/>): a request that sends the tag back in If-None-Match gets 304 Not Modified while
/// nothing changed, before anything is read, so the screen's refresh stays cheap.
/// </summary>
[Route("api/dashboard")]
public sealed class DashboardController(IDashboardService dashboard, DashboardCache cache) : ApiControllerBase
{
    // What MVC writes for an ActionResult (it relaxes the escaping), so /api/dashboard keeps its exact bytes.
    private static readonly JsonSerializerOptions MvcJson = new(JsonDefaults.Options) { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    [HttpGet]
    [ProducesResponseType<DashboardDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status304NotModified)]
    public IActionResult Get([FromQuery] string? fy, [FromQuery] string? month, [FromQuery] string? party) =>
        Answer(JsonSerializer.Serialize(new[] { "dashboard", fy, month, party }), () => dashboard.Get(fy, month, party), MvcJson);

    /// <summary>The figures the dashboard screen adds up by itself.</summary>
    [HttpGet("facts")]
    [ProducesResponseType<DashboardFactsDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status304NotModified)]
    public IActionResult Facts() => Answer("facts", dashboard.Facts, JsonDefaults.Options);

    private IActionResult Answer<T>(string query, Func<T> work, JsonSerializerOptions json)
    {
        var tag = new EntityTagHeaderValue(cache.Tag(query));
        if (Request.GetTypedHeaders().IfNoneMatch.Any(t => t.Equals(EntityTagHeaderValue.Any) || t.Compare(tag, useStrongComparison: false)))
        {
            Response.GetTypedHeaders().ETag = tag;
            return StatusCode(StatusCodes.Status304NotModified);
        }
        var body = cache.Body(query, tag.Tag.Value!) ?? cache.Keep(query, tag.Tag.Value!, JsonSerializer.SerializeToUtf8Bytes(work(), json));
        return File(body, "application/json", lastModified: null, entityTag: tag);
    }
}
