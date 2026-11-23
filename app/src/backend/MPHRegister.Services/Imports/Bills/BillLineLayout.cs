using MPHRegister.Contracts.Billing;
using MPHRegister.Shared.Enums;

namespace MPHRegister.Services.Imports.Bills;

/// <summary>Separates the workbook's bottom-aligned final summary from the bill's logical lines.</summary>
internal static class BillLineLayout
{
    public static List<LineDto> ForWorkbook(IReadOnlyList<LineDto> lines)
    {
        var result = Compact(lines);
        if (result.Count is > 1 and < BillSheetReader.LineRows && IsSummary(result[^1]) && result[^2].Kind == LineKind.Detail)
        {
            var blank = new LineDto(LineKind.Blank, "", "", "", "", null, null, null, false, []);
            result.InsertRange(result.Count - 1, Enumerable.Repeat(blank, BillSheetReader.LineRows - result.Count));
        }
        return result;
    }

    public static List<LineDto> Compact(IReadOnlyList<LineDto> lines)
    {
        var result = SheetBillComparer.Trimmed(lines);
        if (result.Count == 0 || !IsUnreferencedPriced(result[^1])) return result;
        var lastDetail = result.Count - 2;
        while (lastDetail >= 0 && result[lastDetail].Kind == LineKind.Blank) lastDetail--;
        if (lastDetail < 0 || result[lastDetail].Kind != LineKind.Detail) return result;
        var spacing = result.Count - lastDetail - 2;
        if (!result[^1].AutoSum)
        {
            if (spacing == 0) return result;
            var firstDetail = lastDetail;
            while (firstDetail > 0 && result[firstDetail - 1].Kind == LineKind.Detail) firstDetail--;
            var quantity = result.Skip(firstDetail).Take(lastDetail - firstDetail + 1).Sum(l => l.Qty ?? 0);
            // Older imports kept this padding and lost AutoSum, even though the workbook total was a SUM.
            if (result[^1].Qty != quantity) return result;
            result[^1] = result[^1] with { AutoSum = true };
        }
        result.RemoveRange(lastDetail + 1, spacing);
        return result;
    }

    private static bool IsSummary(LineDto line) => line.AutoSum && IsUnreferencedPriced(line);

    private static bool IsUnreferencedPriced(LineDto line) => line.Kind == LineKind.Priced
        && string.IsNullOrWhiteSpace(line.Gpn) && string.IsNullOrWhiteSpace(line.Dn) && string.IsNullOrWhiteSpace(line.Lot);
}
