using MPHRegister.Contracts.Billing;
using MPHRegister.Contracts.Masters;

namespace MPHRegister.Services.Interfaces;

public interface IBillingService
{
    /// <summary>Parties with unbilled entries whose inward date is in the bill period.</summary>
    IReadOnlyList<PartyToBillDto> PartiesToBill(string? from, string? to);

    /// <summary>The party's unbilled entries whose inward date is in the bill period.</summary>
    CandidatesDto Candidates(string? party, string? from, string? to);

    IReadOnlyList<InvoiceDoc> Build(BillRequest request);

    int CountBills(CountBillsRequest request);

    InvoiceDoc Recompute(InvoiceDoc doc, string? recipient = null);

    IReadOnlyList<InvoiceDoc> Save(SaveBillsRequest request);

    /// <summary>The bill number each draft would get if saved now, flagging typed numbers that clash with a saved bill or another draft.</summary>
    IReadOnlyList<BillNumberDto> Numbers(BillNumbersRequest request);

    ElsewhereResult MarkBilledElsewhere(ElsewhereRequest request);

    IReadOnlyList<LineDto> PreviewStyle(StyleInput style);
}
