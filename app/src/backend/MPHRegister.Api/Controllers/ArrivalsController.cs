using Microsoft.AspNetCore.Mvc;
using MPHRegister.Contracts.Arrivals;
using MPHRegister.Services.Interfaces;

namespace MPHRegister.Api.Controllers;

/// <summary>The Aawak register: goods arriving at the gate, and the inward slips each arrival carries.</summary>
[Route("api/arrivals")]
public sealed class ArrivalsController(IArrivalService arrivals) : ApiControllerBase
{
    [HttpGet]
    public ActionResult<IReadOnlyList<ArrivalDto>> List([FromQuery] string? month, [FromQuery] string? fy) => Ok(arrivals.List(month, YearOf(fy)));

    [HttpGet("recent")]
    public ActionResult<IReadOnlyList<ArrivalDto>> Recent([FromQuery] int? limit) => Ok(arrivals.Recent(limit));

    [HttpGet("months")]
    public ActionResult<IReadOnlyList<AawakMonthDto>> Months() => Ok(arrivals.Months());

    [HttpGet("next")]
    public ActionResult<NextAawakDto> Next([FromQuery] string? month) => arrivals.Next(month);

    [HttpGet("{id:long}")]
    public ActionResult<ArrivalDto> Get(long id) => arrivals.Get(id);

    [HttpPost]
    public ActionResult<ArrivalDto> Create([FromBody] ArrivalInput input) => arrivals.Create(input);

    [HttpPut("{id:long}")]
    public ActionResult<ArrivalDto> Update(long id, [FromBody] ArrivalInput input) => arrivals.Update(id, input);

    /// <summary>Deletes an Aawak row; it is kept so it can be restored.</summary>
    [HttpDelete("{id:long}")]
    public ActionResult<DeleteArrivalResult> Delete(long id) => arrivals.Delete(id);

    [HttpGet("deleted")]
    public ActionResult<IReadOnlyList<DeletedArrivalDto>> Deleted() => Ok(arrivals.Deleted());

    [HttpPost("deleted/{id:long}/restore")]
    public ActionResult<ArrivalDto> Restore(long id) => arrivals.Restore(id);

    /// <summary>While an arrival is typed: the slips it would link to, and the NAG check.</summary>
    [HttpGet("preview-slips")]
    public ActionResult<SlipPreviewDto> Preview([FromQuery] string? date, [FromQuery] string? party, [FromQuery] int? nag, [FromQuery] string? inward, [FromQuery] long? id) =>
        arrivals.Preview(date, party, nag, inward, id);

    [HttpPost("{id:long}/links")]
    public ActionResult<ArrivalDto> AddLink(long id, [FromBody] ArrivalLinkInput input) => arrivals.AddLink(id, input);

    [HttpDelete("{id:long}/links/{entryId:long}")]
    public ActionResult<ArrivalDto> RemoveLink(long id, long entryId) => arrivals.RemoveLink(id, entryId);

    [HttpGet("for-entry/{entryId:long}")]
    public ActionResult<IReadOnlyList<ArrivalDto>> ForEntry(long entryId) => Ok(arrivals.ForEntry(entryId));

    /// <summary>Arrivals of the party or its sister firms around the date with NAG not yet matched to slips.</summary>
    [HttpGet("candidates")]
    public ActionResult<IReadOnlyList<ArrivalCandidateDto>> Candidates([FromQuery] string? date, [FromQuery] string? party) => Ok(arrivals.Candidates(date, party));

    /// <summary>Marks an inward slip as never coming through the gate, so it is not listed as having no Aawak row.</summary>
    [HttpPut("no-arrival/{entryId:long}")]
    public IActionResult MarkNoArrival(long entryId, [FromBody] NoArrivalInput input)
    {
        arrivals.MarkNoArrival(entryId, input);
        return NoContent();
    }

    [HttpDelete("no-arrival/{entryId:long}")]
    public IActionResult ClearNoArrival(long entryId)
    {
        arrivals.ClearNoArrival(entryId);
        return NoContent();
    }

    /// <summary>Looks again for the slips of every Aawak row (of one month, or all).</summary>
    [HttpPost("relink")]
    public ActionResult<RelinkResult> Relink([FromQuery] string? month) => arrivals.Relink(month);

    [HttpGet("totals")]
    public ActionResult<ArrivalTotalsDto> Totals([FromQuery] string? from, [FromQuery] string? to, [FromQuery] bool? group, [FromQuery] string? order) =>
        arrivals.Totals(from, to, group ?? true, order);

    [HttpGet("statement")]
    public ActionResult<ArrivalStatementDto> Statement([FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? transporter) =>
        arrivals.Statement(from, to, transporter);

    [HttpGet("check")]
    public ActionResult<ArrivalCheckDto> Check([FromQuery] string? from, [FromQuery] string? to) => arrivals.Check(from, to);
}
