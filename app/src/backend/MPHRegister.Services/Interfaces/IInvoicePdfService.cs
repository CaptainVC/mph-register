namespace MPHRegister.Services.Interfaces;

public interface IInvoicePdfService
{
    /// <summary>True when a browser that can print to PDF (Edge or Chrome) is installed.</summary>
    bool IsAvailable { get; }

    Task<byte[]> RenderAsync(Uri printPage, CancellationToken cancellationToken);
}
