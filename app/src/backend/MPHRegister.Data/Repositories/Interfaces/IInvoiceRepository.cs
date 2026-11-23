using MPHRegister.Data.Entities;

namespace MPHRegister.Data.Repositories.Interfaces;

public interface IInvoiceRepository
{
    /// <summary>Bills of the month (or of the bill months from <paramref name="fromMonth"/> to <paramref name="toMonth"/>) and party; null means any.</summary>
    IReadOnlyList<InvoiceSummaryRow> List(string? month, string? party, string? fromMonth = null, string? toMonth = null);

    /// <summary>Every bill month with its number of bills (saved or cancelled), newest first.</summary>
    IReadOnlyList<BillMonthCount> Months();

    /// <summary>The ids among <paramref name="ids"/> that are bills.</summary>
    IReadOnlySet<long> ExistingIds(IReadOnlyCollection<long> ids);

    InvoiceEntity? Get(long id);

    /// <summary>Saved bills from one source ("excel" or "app"), oldest bill month first, then by serial number.</summary>
    IReadOnlyList<InvoiceEntity> Saved(string source);

    IReadOnlyList<InvoiceLineEntity> Lines(long invoiceId);

    long Insert(InvoiceEntity invoice);

    void UpdateEdited(InvoiceEntity invoice);

    void ReplaceLines(long invoiceId, IReadOnlyList<InvoiceLineEntity> lines, IReadOnlyCollection<long> entryIds);

    void Cancel(long invoiceId, string at);

    /// <summary>Puts a cancelled bill back as saved and links it to its entries again.</summary>
    void Restore(long invoiceId, IReadOnlyCollection<long> entryIds, string at);

    /// <summary>The entries that cannot be on <paramref name="invoiceId"/>: deleted, on another saved bill, or billed elsewhere.</summary>
    IReadOnlyList<InvoiceEntryClaim> EntryClaims(long invoiceId, IReadOnlyCollection<long> entryIds);

    void UndoSave(InvoiceUndoEntity undo);

    bool Exists(string invoiceNo, string fy, int serial);

    /// <summary>The bill with that number (or that serial in that financial year), or null.</summary>
    InvoiceEntity? FindByNumber(string invoiceNo, string fy, int serial);

    int MaxSerial(string fy);
}
