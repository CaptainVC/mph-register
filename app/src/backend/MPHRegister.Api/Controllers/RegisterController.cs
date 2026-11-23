using Microsoft.AspNetCore.Mvc;
using MPHRegister.Contracts.Entries;
using MPHRegister.Services.Interfaces;

namespace MPHRegister.Api.Controllers;

/// <summary>Register-wide views: months, next inward number and the party-wise list.</summary>
[Route("api")]
public sealed class RegisterController(IEntryService entries) : ApiControllerBase
{
    [HttpGet("months")]
    public ActionResult<IReadOnlyList<MonthSummary>> Months() => Ok(entries.Months());

    [HttpGet("next-inward")]
    public ActionResult<NextInwardDto> NextInward([FromQuery] string? month) => entries.NextInward(month);

    [HttpGet("partywise")]
    public ActionResult<IReadOnlyList<EntryDto>> PartyWise([FromQuery] string? month, [FromQuery] string? party) => Ok(entries.PartyWise(month, party));
}
