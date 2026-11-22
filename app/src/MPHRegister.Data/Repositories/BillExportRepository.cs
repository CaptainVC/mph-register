using MPHRegister.Data.Database;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;

namespace MPHRegister.Data.Repositories;

public sealed class BillExportRepository(IDbSession session) : RepositoryBase(session), IBillExportRepository
{
    public void Add(BillExportEntity export) => Execute(
        """
        INSERT INTO bill_exports(invoice_id, invoice_no, file_name, cell, exported_at, invoice_updated_at)
        VALUES (@InvoiceId, @InvoiceNo, @FileName, @Cell, @ExportedAt, @InvoiceUpdatedAt);
        """,
        export);
}
