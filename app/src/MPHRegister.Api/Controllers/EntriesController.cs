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
}
