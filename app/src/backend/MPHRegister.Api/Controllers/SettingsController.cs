using Microsoft.AspNetCore.Mvc;
using MPHRegister.Contracts.Settings;
using MPHRegister.Services.Interfaces;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Exceptions;

namespace MPHRegister.Api.Controllers;

[Route("api/settings")]
public sealed class SettingsController(ISettingsService settings) : ApiControllerBase
{
    [HttpGet]
    public ActionResult<SettingsDto> Get([FromQuery] string? fy) => settings.Get(fy);

    /// <summary>Sections left out of the request stay as they are.</summary>
    [HttpPut]
    public ActionResult<SettingsDto> Save([FromBody] SettingsInput input) => settings.Save(input);

    /// <summary>Re-reads the config file now (it is also re-read by itself when it changes).</summary>
    [HttpPost("reload")]
    public ActionResult<SettingsDto> Reload() => settings.ReloadConfig();

    [HttpGet("print-context")]
    public ActionResult<PrintContextDto> PrintContext() => settings.PrintContext();

    /// <summary>The signature printed on bills.</summary>
    [HttpGet("signature")]
    [Produces("image/png", "image/jpeg")]
    public IActionResult Signature()
    {
        var (image, type) = settings.Signature() ?? throw new NotFoundException("No signature picture is set.");
        return File(image, type);
    }

    [HttpPut("signature")]
    [RequestSizeLimit(Limits.MaxSignatureBytes + 64 * 1024)]
    public async Task<ActionResult<SettingsDto>> SaveSignature(CancellationToken cancellationToken)
    {
        if (!Request.HasFormContentType) throw new AppValidationException("Choose a picture of the signature.");
        // Reads form manually so missing/non-multipart uploads return AppValidationException instead of default 415/400.
#pragma warning disable S6932
        var form = await Request.ReadFormAsync(cancellationToken);
        var file = form.Files.GetFile("file") ?? throw new AppValidationException("Choose a picture of the signature.");
#pragma warning restore S6932
        using var copy = new MemoryStream();
        await file.CopyToAsync(copy, cancellationToken);
        settings.SaveSignature(copy.ToArray());
        return settings.Get(null);
    }

    [HttpDelete("signature")]
    public ActionResult<SettingsDto> DeleteSignature()
    {
        settings.DeleteSignature();
        return settings.Get(null);
    }
}
