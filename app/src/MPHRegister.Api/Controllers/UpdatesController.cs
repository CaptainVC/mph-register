using System.ComponentModel;
using Microsoft.AspNetCore.Mvc;
using MPHRegister.Api.Hosting;
using MPHRegister.Contracts.Updates;
using MPHRegister.Services.Interfaces;
using MPHRegister.Services.Updates;
using MPHRegister.Shared.Exceptions;

namespace MPHRegister.Api.Controllers;

[Route("api/updates")]
public sealed class UpdatesController(IUpdateService updates, UpdateOptions options, IHostApplicationLifetime lifetime) : ApiControllerBase
{
    [HttpGet]
    public Task<UpdateStatusDto> Get([FromQuery] bool refresh, CancellationToken cancellationToken) => updates.CheckAsync(refresh, cancellationToken);

    /// <summary>Downloads the new version, hands over to it and closes; the page waits for the app to come back.</summary>
    [HttpPost("install")]
    public async Task<IActionResult> Install(CancellationToken cancellationToken)
    {
        var staged = await updates.DownloadAsync(cancellationToken);
        try
        {
            SelfUpdate.Launch(staged, options.AppPath!);
        }
        catch (Exception ex) when (ex is Win32Exception or InvalidOperationException or IOException)
        {
            throw new AppValidationException($"Could not start the new version: {ex.Message}");
        }
        Response.OnCompleted(() =>
        {
            lifetime.StopApplication();
            return Task.CompletedTask;
        });
        return Ok(new { restarting = true });
    }
}
