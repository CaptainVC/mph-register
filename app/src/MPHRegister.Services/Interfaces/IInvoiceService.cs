using MPHRegister.Contracts.Billing;

namespace MPHRegister.Services.Interfaces;

public interface IInvoiceService
{
    IReadOnlyList<InvoiceSummary> List(string? month, string? party);

    InvoiceDoc Get(long id);

    InvoiceDoc Edit(long id, InvoiceEdit edit);

    InvoiceDoc Cancel(long id);

    /// <summary>Brings a cancelled bill back as saved, unless its entries have since been billed elsewhere.</summary>
    InvoiceDoc Restore(long id);

    UndoInvoiceSaveResult UndoSave(long id, UndoInvoiceSaveRequest request);
}
