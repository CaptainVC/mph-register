using MPHRegister.Data.Database;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;

namespace MPHRegister.Data.Repositories;

public sealed class DashboardRepository(IDbSession session) : RepositoryBase(session), IDashboardRepository
{
    public IReadOnlyList<DashboardBillRow> Bills(string from, string to) => Query<DashboardBillRow>(
        """
        SELECT i.bill_date, i.party, i.party_name, i.gross, i.discount, i.taxable, i.cgst, i.sgst, i.igst, i.total,
            (SELECT COALESCE(SUM(qty), 0) FROM invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'priced') AS than
        FROM invoices i
        WHERE i.status = 'saved' AND i.bill_date BETWEEN @from AND @to
        ORDER BY i.bill_date, i.id;
        """,
        new { from, to });

    public IReadOnlyList<DashboardFinishRow> Finishes(string from, string to, IReadOnlyList<string>? billParties)
    {
        if (billParties is { Count: 0 }) return [];
        return Query<DashboardFinishRow>(
        $"""
        SELECT l.finish AS finish, COALESCE(SUM(l.qty), 0) AS than, COALESCE(SUM(l.amount), 0) AS amount
        FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
        WHERE i.status = 'saved' AND l.kind = 'priced' AND i.bill_date BETWEEN @from AND @to
        {(billParties is null ? "" : "AND i.party IN @billParties")}
        GROUP BY l.finish COLLATE NOCASE
        ORDER BY amount DESC;
        """,
        new { from, to, billParties });
    }

    public IReadOnlyList<DashboardFinishMonthRow> FinishMonths(string asOf) => Query<DashboardFinishMonthRow>(
        """
        SELECT i.party AS party, substr(i.bill_date, 1, 7) AS month, l.finish AS finish,
            COALESCE(SUM(l.qty), 0) AS than, COALESCE(SUM(l.amount), 0) AS amount
        FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
        WHERE i.status = 'saved' AND l.kind = 'priced' AND i.bill_date <= @asOf
        GROUP BY i.party, month, l.finish COLLATE NOCASE;
        """,
        new { asOf });

    public IReadOnlyList<DashboardSentRow> SentPieces(string asOf) => Query<DashboardSentRow>(
        """
        SELECT e.party AS party, substr(d.dispatch_date, 1, 7) AS month, SUM(d.qty) AS pieces
        FROM dispatches d JOIN entries e ON e.id = d.entry_id
        WHERE d.qty > 0 AND d.dispatch_date BETWEEN e.entry_date AND @asOf
        GROUP BY e.party, month;
        """,
        new { asOf });

    public IReadOnlyList<DashboardEntryRow> Entries(string asOf) => Query<DashboardEntryRow>(
        """
        SELECT e.party, e.finish, e.entry_date, e.repair, e.than, e.tp, e.two_part,
            COALESCE((SELECT SUM(d.qty) FROM dispatches d WHERE d.entry_id = e.id
                AND (d.dispatch_date IS NULL OR d.dispatch_date <= @asOf)), 0) AS dispatched,
            (SELECT MAX(d.dispatch_date) FROM dispatches d WHERE d.entry_id = e.id AND d.qty > 0
                AND d.dispatch_date BETWEEN e.entry_date AND @asOf) AS last_valid_dispatch,
            EXISTS (SELECT 1 FROM dispatches d WHERE d.entry_id = e.id AND d.qty > 0
                AND (d.dispatch_date IS NULL OR d.dispatch_date < e.entry_date)) AS dispatch_date_issue,
            CASE WHEN EXISTS (SELECT 1 FROM invoice_entries ie JOIN invoices i ON i.id = ie.invoice_id WHERE ie.entry_id = e.id AND i.status = 'saved')
                   OR EXISTS (SELECT 1 FROM billed_elsewhere b WHERE b.entry_id = e.id)
                 THEN 1 ELSE 0 END AS billed
        FROM entries e
        WHERE e.entry_date <= @asOf
        ORDER BY e.entry_date, e.id;
        """, new { asOf });

    public IReadOnlyList<DashboardPartyBillDate> LatestBillDates(string asOf) => Query<DashboardPartyBillDate>(
        """
        SELECT party, MAX(bill_date) AS last_bill
        FROM invoices WHERE status = 'saved' AND bill_date <= @asOf
        GROUP BY party;
        """,
        new { asOf });

    public string? EarliestDate() => Scalar<string>(
        """
        SELECT MIN(d) FROM (
            SELECT bill_date AS d FROM invoices WHERE status = 'saved'
            UNION ALL SELECT entry_date FROM entries);
        """);
}
