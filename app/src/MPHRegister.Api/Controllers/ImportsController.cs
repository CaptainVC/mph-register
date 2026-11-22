using Microsoft.AspNetCore.Mvc;
using MPHRegister.Contracts.Imports;
using MPHRegister.Services.Interfaces;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Exceptions;

namespace MPHRegister.Api.Controllers;

/// <summary>Excel uploads. "commit=true" saves; otherwise the report is a preview and nothing changes.</summary>
[Route("api")]
public sealed class ImportsController(IInwardImportService inward, IBillImportService bills) : ApiControllerBase
{
    private static readonly string[] Workbooks = [".xlsm", ".xlsx", ".xls"];

    [HttpPost("import")]
    [RequestSizeLimit(Limits.MaxUploadBytes)]
    public async Task<ActionResult<ImportReport>> ImportInward(CancellationToken cancellationToken)
    {
        var (form, file) = await ReadWorkbook("Choose a workbook to import.", cancellationToken);
        return await WithTempCopy(file, "mph-import", path => inward.Import(path, Path.GetFileName(file.FileName), form["month"].ToString(), form["commit"] == "true"), cancellationToken);
    }

    [HttpPost("billing/import")]
    [RequestSizeLimit(Limits.MaxUploadBytes)]
    public async Task<ActionResult<BillImportReport>> ImportBills(CancellationToken cancellationToken)
    {
        var (form, file) = await ReadWorkbook("Choose a bill workbook to import.", cancellationToken);
        return await WithTempCopy(file, "mph-bills", path => bills.Import(path, Path.GetFileName(file.FileName), form["commit"] == "true"), cancellationToken);
    }

    /// <summary>Matches the bills imported from Excel to the inward register again; "commit" saves the new links.</summary>
    [HttpPost("billing/relink")]
    public ActionResult<BillRelinkReport> Relink([FromBody] RelinkRequest request) => bills.Relink(request?.Commit == true);

    private async Task<(IFormCollection Form, IFormFile File)> ReadWorkbook(string missing, CancellationToken cancellationToken)
    {
        if (!Request.HasFormContentType) throw new AppValidationException(missing);
        // Reads form manually so missing/non-multipart uploads return AppValidationException instead of default 415/400.
#pragma warning disable S6932
        var form = await Request.ReadFormAsync(cancellationToken);
        var file = form.Files.GetFile("file");
#pragma warning restore S6932
        if (file is null || file.Length == 0) throw new AppValidationException(missing);
        if (!Workbooks.Contains(Path.GetExtension(file.FileName).ToLowerInvariant()))
            throw new AppValidationException("Only Excel workbooks (.xlsm, .xlsx, .xls) can be imported.");
        return (form, file);
    }

    private static async Task<T> WithTempCopy<T>(IFormFile file, string prefix, Func<string, T> work, CancellationToken cancellationToken)
    {
        var temp = Path.Combine(Path.GetTempPath(), $"{prefix}-{Guid.NewGuid():N}{Path.GetExtension(file.FileName).ToLowerInvariant()}");
        try
        {
            await using (var output = System.IO.File.Create(temp)) await file.CopyToAsync(output, cancellationToken);
            return work(temp);
        }
        finally
        {
            System.IO.File.Delete(temp);
        }
    }
}
