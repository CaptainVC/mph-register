using Microsoft.AspNetCore.Mvc;
using MPHRegister.Contracts.Billing;
using MPHRegister.Services.Interfaces;

namespace MPHRegister.Api.Controllers;

[Route("api/billing")]
public sealed class BillingController(IBillingService billing) : ApiControllerBase
{
    [HttpGet("parties")]
    public ActionResult<IReadOnlyList<PartyToBillDto>> Parties([FromQuery] string? from, [FromQuery] string? to) => Ok(billing.PartiesToBill(from, to));

    [HttpGet("candidates")]
    public ActionResult<CandidatesDto> Candidates([FromQuery] string? party, [FromQuery] string? from, [FromQuery] string? to) => billing.Candidates(party, from, to);

    [HttpPost("build")]
    public ActionResult<IReadOnlyList<InvoiceDoc>> Build([FromBody] BillRequest request) => Ok(billing.Build(request));

    [HttpPost("count")]
    public ActionResult<int> Count([FromBody] CountBillsRequest request) => Ok(billing.CountBills(request));

    [HttpPost("compute")]
    public ActionResult<InvoiceDoc> Compute([FromBody] InvoiceDoc doc, [FromQuery] string? recipient) => billing.Recompute(doc, recipient);

    [HttpPost("save")]
    public ActionResult<IReadOnlyList<InvoiceDoc>> Save([FromBody] SaveBillsRequest request) => Ok(billing.Save(request));

    [HttpPost("numbers")]
    public ActionResult<IReadOnlyList<BillNumberDto>> Numbers([FromBody] BillNumbersRequest request) => Ok(billing.Numbers(request));

    [HttpPost("elsewhere")]
    public ActionResult<ElsewhereResult> Elsewhere([FromBody] ElsewhereRequest request) => billing.MarkBilledElsewhere(request);
}
