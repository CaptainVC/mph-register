using MPHRegister.Data.Database;
using MPHRegister.Data.Repositories.Interfaces;

namespace MPHRegister.Data.Repositories;

public sealed class BilledElsewhereRepository(IDbSession session) : RepositoryBase(session), IBilledElsewhereRepository
{
    public int Mark(long entryId, string note, string at) => Execute(
        """
        INSERT OR IGNORE INTO billed_elsewhere(entry_id, note, created_at)
        SELECT id, @note, @at FROM entries WHERE id = @entryId
          AND NOT EXISTS (SELECT 1 FROM invoice_entries ie JOIN invoices i ON i.id = ie.invoice_id WHERE ie.entry_id = @entryId AND i.status = 'saved');
        """,
        new { entryId, note, at });

    public int Unmark(long entryId) => Execute("DELETE FROM billed_elsewhere WHERE entry_id = @entryId;", new { entryId });
}
