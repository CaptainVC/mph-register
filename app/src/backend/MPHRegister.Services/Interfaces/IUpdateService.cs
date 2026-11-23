using MPHRegister.Contracts.Updates;

namespace MPHRegister.Services.Interfaces;

public interface IUpdateService
{
    /// <summary>The newest release; asked again after a few hours, or now when refresh is set.</summary>
    Task<UpdateStatusDto> CheckAsync(bool refresh, CancellationToken cancellationToken);

    /// <summary>Downloads and checks the newest Windows app next to the running one; returns the path of the new file.</summary>
    Task<string> DownloadAsync(CancellationToken cancellationToken);
}
