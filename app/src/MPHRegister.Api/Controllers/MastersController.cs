using Microsoft.AspNetCore.Mvc;
using MPHRegister.Contracts.Billing;
using MPHRegister.Contracts.Masters;
using MPHRegister.Services.Interfaces;

namespace MPHRegister.Api.Controllers;

/// <summary>Parties, rates, finishes, groups, billing styles and colours, all kept in the config file.</summary>
[Route("api/masters")]
public sealed class MastersController(IMasterService masters, IBillingService billing) : ApiControllerBase
{
    [HttpGet]
    public ActionResult<MastersDto> Get() => masters.GetMasters();

    [HttpGet("full")]
    public ActionResult<FullMastersDto> Full() => masters.GetFull();

    [HttpPost("party")]
    public ActionResult<PartyDto> SaveParty([FromBody] PartyInput input) => masters.SaveParty(input);

    [HttpPost("sister-group")]
    public ActionResult<SisterGroupDto> SaveSisterGroup([FromBody] SisterGroupInput input) => masters.SaveSisterGroup(input);

    [HttpDelete("sister-group")]
    public IActionResult DeleteSisterGroup([FromQuery] string? name)
    {
        masters.DeleteSisterGroup(name);
        return NoContent();
    }

    [HttpPut("party/rate")]
    public ActionResult<PartyDto> SaveRate([FromBody] RateInput input) => masters.SaveRate(input);

    [HttpDelete("party/rate")]
    public ActionResult<PartyDto> DeleteRate([FromQuery] string? party, [FromQuery] string? finish) => masters.DeleteRate(party, finish);

    [HttpPost("finish")]
    public ActionResult<FinishDto> SaveFinish([FromBody] FinishInput input) => masters.SaveFinish(input);

    [HttpPost("group")]
    public ActionResult<GroupDto> SaveGroup([FromBody] GroupInput input) => masters.SaveGroup(input);

    [HttpPost("style")]
    public ActionResult<StyleDto> SaveStyle([FromBody] StyleInput input) => masters.SaveStyle(input);

    [HttpDelete("style")]
    public IActionResult DeleteStyle([FromQuery] string? name)
    {
        masters.DeleteStyle(name);
        return NoContent();
    }

    /// <summary>Bill lines for a few sample entries, to show what a style does before saving it.</summary>
    [HttpPost("style/preview")]
    public ActionResult<IReadOnlyList<LineDto>> PreviewStyle([FromBody] StyleInput input) => Ok(billing.PreviewStyle(input));

    [HttpPost("color")]
    public ActionResult<ColorDto> SaveColor([FromBody] ColorInput input) => masters.SaveColor(input);

    [HttpDelete("color")]
    public IActionResult DeleteColor([FromQuery] string? name)
    {
        masters.DeleteColor(name);
        return NoContent();
    }
}
