using MPHRegister.Contracts.Billing;
using MPHRegister.Contracts.Settings;
using MPHRegister.Shared.Enums;

namespace MPHRegister.Services.Billing;

/// <summary>
/// Packs bill rows into printed bills the way the Excel bills are laid out: each finish is a block ending in its priced
/// row, blocks are separated by a blank row, a bill holds at most RowsPerInvoice printed rows (a line with a long lot or
/// D.N. list counts as the rows it needs) and stays below InvoiceLimit, and single-row finishes go at the top of the
/// first bill with room.
/// </summary>
public static class BillPacker
{
    public static List<List<LineDto>> Pack(
        IReadOnlyList<BillItem> items, FinishResolver finishes, decimal discountPct, TaxMode mode, FirmSettings firm, Func<LineDto, int> rowsOf)
    {
        ArgumentNullException.ThrowIfNull(items);
        ArgumentNullException.ThrowIfNull(finishes);
        ArgumentNullException.ThrowIfNull(firm);
        ArgumentNullException.ThrowIfNull(rowsOf);
        var groups = items.GroupBy(i => i.Finish, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.ToList())
            .OrderBy(g => g.Count == 1 ? 0 : 1).ThenBy(g => g.Min(i => i.Position))
            .ToList();
        var rowsLimit = firm.RowsPerInvoice;
        var pages = new List<List<LineDto>>();
        var current = new List<LineDto>();
        int Rows(List<LineDto> lines) => lines.Sum(rowsOf);
        bool OverLimit(List<LineDto> lines) => firm.InvoiceLimit > 0 && BillCalculator.Totals(lines, discountPct, mode, firm).Total >= firm.InvoiceLimit;
        void Flush()
        {
            if (current.Count > 0) pages.Add(current);
            current = [];
        }

        foreach (var group in groups.Where(g => g.Count > 1))
        {
            var rate = finishes.Rate(group[0].Finish);
            var whole = WithChunk(current, group, rate);
            var halfFull = Rows(current) >= rowsLimit / 2
                || (firm.InvoiceLimit > 0 && BillCalculator.Totals(current, discountPct, mode, firm).Total >= firm.InvoiceLimit / 2);
            if (current.Count > 0 && (Rows(whole) > rowsLimit || OverLimit(whole)) && halfFull) Flush();
            var chunk = new List<BillItem>();
            foreach (var item in group)
            {
                var tentative = WithChunk(current, [.. chunk, item], rate);
                if ((Rows(tentative) > rowsLimit || OverLimit(tentative)) && (chunk.Count > 0 || current.Count > 0))
                {
                    if (chunk.Count > 0) current = WithChunk(current, chunk, rate);
                    Flush();
                    chunk = [item];
                }
                else
                {
                    chunk.Add(item);
                }
            }
            if (chunk.Count > 0) current = WithChunk(current, chunk, rate);
        }
        Flush();

        foreach (var group in groups.Where(g => g.Count == 1).Reverse())
        {
            var single = ChunkLines(group, finishes.Rate(group[0].Finish));
            var placed = false;
            for (var i = 0; i < pages.Count && !placed; i++)
            {
                var candidate = new List<LineDto>(single) { Blank() };
                candidate.AddRange(pages[i]);
                if (Rows(candidate) <= rowsLimit && !OverLimit(candidate))
                {
                    pages[i] = candidate;
                    placed = true;
                }
            }
            if (!placed) pages.Add(single);
        }
        return pages;
    }

    public static LineDto Blank() => new(LineKind.Blank, string.Empty, string.Empty, string.Empty, string.Empty, null, null, null, false, []);

    private static LineDto Priced(BillItem? item, string finish, int qty, decimal? rate, bool autoSum, List<long> entryIds) =>
        new(LineKind.Priced, item?.Gpn ?? string.Empty, item?.Dn ?? string.Empty, item?.Lot ?? string.Empty, finish, qty, rate, null, autoSum, entryIds);

    private static List<LineDto> ChunkLines(List<BillItem> chunk, decimal? rate)
    {
        if (chunk.Count == 1)
        {
            var only = chunk[0];
            return [Priced(only, only.Finish, only.Qty, rate, false, only.Entries.Select(e => e.Id).ToList())];
        }
        var lines = chunk.Select(i => new LineDto(LineKind.Detail, i.Gpn, i.Dn, i.Lot, string.Empty, i.Qty, null, null, false, i.Entries.Select(e => e.Id).ToList())).ToList();
        lines.Add(Priced(null, chunk[0].Finish, chunk.Sum(i => i.Qty), rate, true, []));
        return lines;
    }

    private static List<LineDto> WithChunk(List<LineDto> current, List<BillItem> chunk, decimal? rate)
    {
        var lines = new List<LineDto>(current);
        if (lines.Count > 0) lines.Add(Blank());
        lines.AddRange(ChunkLines(chunk, rate));
        return lines;
    }
}
