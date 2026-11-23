using MPHRegister.Contracts.Billing;

namespace MPHRegister.Services.Interfaces;

/// <summary>The filled copy of the bill workbook, to download.</summary>
public sealed record BillExportFile(byte[] Content, string FileName, string ContentType, BillExportPreview Preview);

public interface IBillExportService
{
    /// <summary>Where each bill would go in the uploaded bill workbook and what would be typed; nothing is written.</summary>
    BillExportPreview Preview(string filePath, string fileName, BillExportRequest request);

    /// <summary>The uploaded bill workbook with the bills written into it (the uploaded file itself is not changed).</summary>
    BillExportFile Export(string filePath, string fileName, BillExportRequest request);
}
