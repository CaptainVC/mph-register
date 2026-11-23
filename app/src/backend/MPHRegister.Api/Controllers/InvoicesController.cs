using Microsoft.AspNetCore.Mvc;
using MPHRegister.Api.Configuration;
using MPHRegister.Contracts.Billing;
using MPHRegister.Services.Interfaces;
using MPHRegister.Shared.Exceptions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Api.Controllers;

[Route("api/invoices")]
public sealed class InvoicesController(IInvoiceService invoices, IInvoicePdfService pdf, AppOptions options) : ApiControllerBase
{
    private const int MaxBillsPerPdf = 100;

    [HttpGet]
    public ActionResult<IReadOnlyList<InvoiceSummary>> List([FromQuery] string? month, [FromQuery] string? party, [FromQuery] string? fy) =>
        Ok(invoices.List(month, party, YearOf(fy)));

    /// <summary>The bill months of every bill (saved or cancelled), newest first, without reading the bills.</summary>
    [HttpGet("months")]
    public ActionResult<IReadOnlyList<BillMonthDto>> Months() => Ok(invoices.Months());

    [HttpGet("{id:long}")]
    public ActionResult<InvoiceDoc> Get(long id) => invoices.Get(id);

    [HttpPut("{id:long}")]
    public ActionResult<InvoiceDoc> Edit(long id, [FromBody] InvoiceEdit edit) => invoices.Edit(id, edit);

    [HttpPost("{id:long}/cancel")]
    public ActionResult<InvoiceDoc> Cancel(long id) => invoices.Cancel(id);

    [HttpPost("{id:long}/restore")]
    public ActionResult<InvoiceDoc> Restore(long id) => invoices.Restore(id);

    /// <summary>Undoes only the latest app save, after explicit confirmation that the bill was never issued.</summary>
    [HttpPost("{id:long}/undo-save")]
    public ActionResult<UndoInvoiceSaveResult> UndoSave(long id, [FromBody] UndoInvoiceSaveRequest request) => invoices.UndoSave(id, request);

    /// <summary>The bills as a PDF, laid out like the Excel print. POST so other websites cannot trigger it.</summary>
    [HttpPost("pdf")]
    [Produces("application/pdf")]
    public async Task<IActionResult> Pdf([FromBody] PdfRequest request, CancellationToken cancellationToken)
    {
        var list = (request?.Ids ?? []).Where(id => id > 0).Distinct().ToList();
        if (list.Count is 0 or > MaxBillsPerPdf) throw new AppValidationException($"Choose between 1 and {MaxBillsPerPdf} bills.");
        if (invoices.Missing(list).Count > 0) throw new NotFoundException("Bill not found.");
        var first = invoices.Get(list[0]);
        var page = new Uri(options.BaseUri, $"print.html?ids={string.Join(",", list)}&pdf=1");
        var bytes = await pdf.RenderAsync(page, cancellationToken);
        return File(bytes, "application/pdf", BillFileName.Of(first.PartyName, Dates.ParseIsoOrDefault(first.BillDate), first.InvoiceNo, list.Count - 1));
    }
}
