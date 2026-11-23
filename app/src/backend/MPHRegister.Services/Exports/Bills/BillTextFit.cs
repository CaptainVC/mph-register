using MPHRegister.Services.Imports.Bills;

namespace MPHRegister.Services.Exports.Bills;

/// <summary>
/// Keeps a written bill inside the bill layout's row heights, the way it would be squeezed in by hand: the rows are kept at
/// the height they have, and a text too long for its cell is shown in a smaller font, kept on one line or wrapped onto
/// several, instead of letting Excel make the row taller. Font sizes start from the layout's size for that cell (the one
/// most bill places have there), so a bill written again goes back to the normal size when its texts are shorter.
/// </summary>
internal sealed class BillTextFit
{
    private readonly BillWorkbook book;
    private readonly int digitPixels;
    private readonly Dictionary<(int Row, int Column), double> layoutSizes = [];

    /// <param name="book">The workbook the bill is (or will be) written in.</param>
    /// <param name="layout">The workbook the layout's font sizes are taken from (the workbook as it was before writing).</param>
    public BillTextFit(BillWorkbook book, BillWorkbook? layout = null)
    {
        this.book = book;
        layout ??= book;
        digitPixels = layout.Styles!.DigitPixels();
        foreach (var (row, column) in Cells)
        {
            layoutSizes[(row, column)] = BillSlot.All.Select(s => layout.Styles.FontOf(layout.Main, s.Ref(row, column)).Size)
                .GroupBy(size => Math.Round(size * 2) / 2).OrderByDescending(g => g.Count()).ThenByDescending(g => g.Key).First().Key;
        }
    }

    /// <summary>The bill's text cells whose text can be longer than the cell: party, address, state, GSTIN, line texts and amount in words.</summary>
    public static IEnumerable<(int Row, int Column)> Cells
    {
        get
        {
            foreach (var row in new[] { BillSlot.PartyRow, BillSlot.AddressRow, BillSlot.StateRow, BillSlot.GstinRow }) yield return (row, Col.A);
            for (var row = BillSlot.FirstLineRow; row <= BillSlot.LastLineRow; row++)
            {
                for (var column = Col.A; column <= Col.D; column++) yield return (row, column);
            }
            yield return (BillSlot.TotalRow, Col.A);
        }
    }

    /// <summary>Rows of a bill that the export writes in; their heights are kept as they are.</summary>
    public static IEnumerable<int> WrittenRows => Enumerable.Range(BillSlot.NumberRow, BillSlot.TotalRow - BillSlot.NumberRow + 1);

    /// <summary>
    /// Locks the bill's row heights and sizes every text cell of the bill to its text. A cell already shown smaller than the
    /// layout's size (as squeezed in by hand) keeps its size while its text fits at it and it is not smaller than needed.
    /// </summary>
    public void Apply(BillSlot slot)
    {
        foreach (var row in WrittenRows) book.Main.LockHeight(slot.RowOffset + row);
        foreach (var (row, column) in Cells)
        {
            var reference = slot.Ref(row, column);
            if (!book.Main.Has(reference)) continue;
            var fit = Needed(slot, row, column);
            var font = book.Styles!.FontOf(book.Main, reference);
            if (font.Size > fit.Size && font.Size < layoutSizes[(row, column)] && FitsAsShown(slot, row, column)) continue;
            book.Styles.SetFit(book.Main, reference, fit.Size, fit.Wraps);
        }
    }

    /// <summary>
    /// The first cell of the bill whose text does not fit its cell as it is shown now and would be shown differently when the
    /// bill is written (null when all fit; a text too long even at the smallest size counts as fitting once at that size).
    /// </summary>
    public string? Overflowing(BillSlot slot) => Cells
        .Where(c => book.Cell(slot, c.Row, c.Column).Text.Trim().Length > 0 && !FitsAsShown(slot, c.Row, c.Column) && !ShownAs(slot, c.Row, c.Column))
        .Select(c => slot.Ref(c.Row, c.Column)).FirstOrDefault();

    private bool ShownAs(BillSlot slot, int row, int column)
    {
        var fit = Needed(slot, row, column);
        var font = book.Styles!.FontOf(book.Main, slot.Ref(row, column));
        return WorkbookStyles.SameSize(font.Size, fit.Size) && (!fit.Wraps || font.Wrap);
    }

    /// <summary>The font size and lines the cell's text needs to stay inside the cell's width and its row's height.</summary>
    public FitResult Needed(BillSlot slot, int row, int column)
    {
        var reference = slot.Ref(row, column);
        var (width, height) = Box(reference);
        var font = book.Styles!.FontOf(book.Main, reference);
        return TextFit.Fit(book.Cell(slot, row, column).Text, font.Name, layoutSizes[(row, column)], font.Bold, width, height);
    }

    /// <summary>True when the text fits as shown now; a size squeezed below the layout's (by hand) gets the hand-filled bills' leeway.</summary>
    private bool FitsAsShown(BillSlot slot, int row, int column)
    {
        var reference = slot.Ref(row, column);
        var (width, height) = Box(reference);
        var font = book.Styles!.FontOf(book.Main, reference);
        return TextFit.FitsAsShown(book.Cell(slot, row, column).Text, font, width, height, squeezed: font.Size < layoutSizes[(row, column)]);
    }

    /// <summary>The width and height (points) the cell's text is shown in: the cell, or its merged range.</summary>
    private (double Width, double Height) Box(string reference)
    {
        var (top, left, bottom, right) = book.Main.Area(reference);
        var width = TextFit.UsableWidth(Enumerable.Range(left, right - left + 1).Select(book.Main.ColumnWidth), digitPixels);
        return (width, Enumerable.Range(top, bottom - top + 1).Sum(book.Main.RowHeight));
    }

    /// <summary>The first row of the bill area whose height differs between the two workbooks or that the export left unlocked.</summary>
    public static string? ChangedRowHeight(BillWorkbook before, BillWorkbook after, IReadOnlyList<BillSlot> written)
    {
        var lastRow = BillSheetReader.BlocksPerPanel * BillSlot.Rows;
        for (var row = 1; row <= lastRow; row++)
        {
            if (!WorkbookStyles.SameSize(before.Main.RowHeight(row), after.Main.RowHeight(row))) return $"Row {row}'s height would change.";
        }
        var unlocked = written.SelectMany(slot => WrittenRows.Select(row => slot.RowOffset + row)).FirstOrDefault(row => !after.Main.HeightLocked(row));
        return unlocked > 0 ? $"Row {unlocked} is not kept at its height." : null;
    }
}
