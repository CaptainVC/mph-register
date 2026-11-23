using System.ComponentModel;
using Microsoft.AspNetCore.Mvc;
using MPHRegister.Api.Hosting;
using MPHRegister.Contracts.Updates;
using MPHRegister.Services.Interfaces;
using MPHRegister.Services.Updates;
using MPHRegister.Shared.Exceptions;

namespace MPHRegister.Api.Controllers;

[Route("api/updates")]
public sealed class UpdatesController(IUpdateService updates, IRollbackService rollback, UpdateOptions options, IHostApplicationLifetime lifetime) : ApiControllerBase
{
    [HttpGet]
    public async Task<UpdateStatusDto> Get([FromQuery] bool refresh, CancellationToken cancellationToken)
    {
        var status = await updates.CheckAsync(refresh, cancellationToken);
        var skipped = rollback.SkippedVersion();
        return status.LatestVersion is not null && ReleaseVersion.TryParse(skipped, out var version) && version.ToString(3) == status.LatestVersion
            ? status with { Skipped = true }
            : status;
    }

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
        return Restarting();
    }

    [HttpGet("rollback")]
    public RollbackStatusDto Rollback() => rollback.Status();

    /// <summary>Hands over to a copy of this app that puts the older version back once this one has closed.</summary>
    [HttpPost("rollback")]
    public IActionResult GoBack([FromBody] RollbackRequest? request)
    {
        var plan = rollback.Prepare(request?.UndoChanges == true);
        try
        {
            SelfUpdate.LaunchRollback(plan);
        }
        catch (Exception ex) when (ex is Win32Exception or InvalidOperationException or IOException)
        {
            throw new AppValidationException($"Could not start going back: {ex.Message}");
        }
        return Restarting();
    }

    private OkObjectResult Restarting()
    {
        Response.OnCompleted(() =>
        {
            lifetime.StopApplication();
            return Task.CompletedTask;
        });
        return Ok(new { restarting = true });
    }
}
