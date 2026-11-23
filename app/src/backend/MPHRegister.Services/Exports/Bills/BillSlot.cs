using MPHRegister.Services.Imports.Bills;

namespace MPHRegister.Services.Exports.Bills;

/// <summary>
/// One of the 100 bill places on the bill workbook's Main sheet: 4 panels of 7 columns side by side, each with 25 bills of
/// 49 rows. Rows and columns are given as in the first bill (A1:G49): <see cref="Ref"/>(8, Col.A) is the party cell.
/// </summary>
internal readonly record struct BillSlot(int Index)
{
    public const int Count = BillSheetReader.Panels * BillSheetReader.BlocksPerPanel;
    public const int NumberRow = 7;
    public const int PartyRow = 8;
    public const int DateRow = 8;
    public const int AddressRow = 9;
    public const int StateRow = 10;
    public const int PeriodRow = 10;
    public const int GstinRow = 11;
    public const int HeaderRow = 12;
    public const int FirstLineRow = 13;
    public const int LastLineRow = FirstLineRow + BillSheetReader.LineRows - 1;
    public const int GrossRow = 38;
    public const int DiscountRow = 39;
    public const int TaxableRow = 40;
    public const int CgstRow = 41;
    public const int SgstRow = 42;
    public const int TotalRow = 43;
    public const int Rows = BillSheetReader.BlockRows;

    public int Panel => Index / BillSheetReader.BlocksPerPanel;

    public int Block => Index % BillSheetReader.BlocksPerPanel;

    /// <summary>Rows above the bill (0 for the first bill of a panel).</summary>
    public int RowOffset => Block * BillSheetReader.BlockRows;

    /// <summary>Columns left of the bill (0 for the first panel).</summary>
    public int ColumnOffset => Panel * BillSheetReader.BlockColumns;

    public string Ref(int row, int column) => A1.Ref(RowOffset + row, ColumnOffset + column);

    /// <summary>The top-left cell, the way the bill import names a bill's place (A1, O50 …).</summary>
    public string Name => Ref(1, Col.A);

    public string Range => $"{Ref(1, Col.A)}:{Ref(Rows, Col.G)}";

    /// <summary>Where to find it in words: "column 3, bill 2 (O50:U98)".</summary>
    public string Place => $"column {Panel + 1}, bill {Block + 1} ({Range})";

    public BillSlot? Previous => Index == 0 ? null : new BillSlot(Index - 1);

    public bool Contains(int row, int column) =>
        row > RowOffset && row <= RowOffset + Rows && column >= ColumnOffset && column < ColumnOffset + BillSheetReader.BlockColumns;

    public static IEnumerable<BillSlot> All => Enumerable.Range(0, Count).Select(i => new BillSlot(i));

    public static BillSlot? ByName(string name) => All.Cast<BillSlot?>().FirstOrDefault(s => string.Equals(s!.Value.Name, name, StringComparison.OrdinalIgnoreCase));
}

/// <summary>Columns of a bill, as in the first bill.</summary>
internal static class Col
{
    public const int A = 0;
    public const int B = 1;
    public const int C = 2;
    public const int D = 3;
    public const int E = 4;
    public const int F = 5;
    public const int G = 6;
}
