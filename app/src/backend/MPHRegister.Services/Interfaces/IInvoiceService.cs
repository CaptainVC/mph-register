using MPHRegister.Contracts.Billing;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Interfaces;

public interface IInvoiceService
{
    /// <summary>The bills of the bill month (with no valid month, of <paramref name="months"/>, or all) and party.</summary>
    IReadOnlyList<InvoiceSummary> List(string? month, string? party, MonthRange? months = null);

    /// <summary>Every bill month with its number of bills (saved or cancelled), newest first.</summary>
    IReadOnlyList<BillMonthDto> Months();

    /// <summary>The ids among <paramref name="ids"/> that are not bills.</summary>
    IReadOnlyList<long> Missing(IReadOnlyCollection<long> ids);

    InvoiceDoc Get(long id);

    InvoiceDoc Edit(long id, InvoiceEdit edit);

    InvoiceDoc Cancel(long id);

    /// <summary>Brings a cancelled bill back as saved, unless its entries have since been billed elsewhere.</summary>
    InvoiceDoc Restore(long id);

    UndoInvoiceSaveResult UndoSave(long id, UndoInvoiceSaveRequest request);
}
