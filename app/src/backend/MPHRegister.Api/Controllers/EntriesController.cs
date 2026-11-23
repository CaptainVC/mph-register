using Microsoft.AspNetCore.Mvc;
using MPHRegister.Contracts.Entries;
using MPHRegister.Services.Interfaces;

namespace MPHRegister.Api.Controllers;

[Route("api/entries")]
public sealed class EntriesController(IEntryService entries) : ApiControllerBase
{
    [HttpGet]
    public ActionResult<IReadOnlyList<EntryDto>> List([FromQuery] string? month) => Ok(entries.List(month));

    [HttpGet("recent")]
    public ActionResult<IReadOnlyList<EntryDto>> Recent([FromQuery] int? limit) => Ok(entries.Recent(limit));

    [HttpGet("{id:long}")]
    public ActionResult<EntryDto> Get(long id) => entries.Get(id);

    [HttpPost]
    public ActionResult<EntryDto> Create([FromBody] EntryInput input) => entries.Create(input);

    [HttpPut("{id:long}")]
    public ActionResult<EntryDto> Update(long id, [FromBody] EntryInput input) => entries.Update(id, input);

    /// <summary>Deletes an entry that is on no saved bill; it is kept so it can be restored.</summary>
    [HttpDelete("{id:long}")]
    public ActionResult<DeleteEntryResult> Delete(long id) => entries.Delete(id);

    [HttpGet("deleted")]
    public ActionResult<IReadOnlyList<DeletedEntryDto>> Deleted() => Ok(entries.Deleted());

    /// <summary>Removes every deleted entry for good, so none of them can be restored.</summary>
    [HttpDelete("deleted")]
    public ActionResult<PurgeDeletedResult> PurgeDeleted() => entries.PurgeDeleted();

    /// <summary>Puts a deleted entry back, refused while its INW. NO. or slip is in use again.</summary>
    [HttpPost("deleted/{id:long}/restore")]
    public ActionResult<EntryDto> Restore(long id) => entries.Restore(id);
}
