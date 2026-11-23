using Microsoft.AspNetCore.Mvc;
using MPHRegister.Contracts.Settings;
using MPHRegister.Services.Interfaces;

namespace MPHRegister.Api.Controllers;

[Route("api/info")]
public sealed class InfoController(IInfoService info) : ApiControllerBase
{
    [HttpGet]
    public ActionResult<InfoDto> Get() => info.Get();
}
