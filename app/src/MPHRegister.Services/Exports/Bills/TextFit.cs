namespace MPHRegister.Services.Exports.Bills;

/// <summary>A font size and the number of lines a text is shown on at that size.</summary>
internal readonly record struct FitResult(double Size, int Lines)
{
    public bool Wraps => Lines > 1;
}

/// <summary>
/// Works out how a text fits into a cell whose height must not change: the largest font size (never above the cell's own)
/// at which the text, kept on one line or wrapped onto several, fits the cell's width and height. Widths are estimated from
/// the fonts' character widths with some room to spare, since Excel on Windows and Mac draws them slightly differently.
/// </summary>
internal static class TextFit
{
    public const double MinSize = 5;
    private const double Step = 0.5;

    /// <summary>Line height as a share of the font size; a 10 pt Calibri line is about 12.5 pt.</summary>
    private const double LineSpacing = 1.25;

    /// <summary>Points of a row's height that are not available to text lines.</summary>
    private const double RowPadding = 1.5;

    /// <summary>Pixels of a column's width that are padding, not text.</summary>
    private const double CellPaddingPixels = 5;

    /// <summary>Share of the width a written text may use, so a text measured as just fitting does fit in Excel.</summary>
    private const double Spare = 0.97;

    /// <summary>
    /// How much wider than estimated a text already in the workbook may be and still count as fitting: Excel on Windows
    /// draws small text a little narrower than its font widths (the hand-filled bills squeeze texts that far).
    /// </summary>
    private const double Tolerance = 1.08;

    // Advance widths (thousandths of the font size) of the printable ASCII characters, from space to "~".
    private static readonly int[] Calibri =
    [
        226, 326, 401, 498, 507, 715, 682, 221, 303, 303, 498, 498, 250, 306, 252, 386,
        507, 507, 507, 507, 507, 507, 507, 507, 507, 507, 268, 268, 498, 498, 498, 463,
        894, 579, 544, 533, 615, 488, 459, 631, 623, 252, 319, 520, 420, 855, 646, 662,
        517, 673, 543, 459, 487, 642, 567, 890, 519, 487, 468, 307, 386, 307, 498, 498,
        291, 479, 525, 423, 525, 498, 305, 471, 525, 230, 239, 455, 230, 799, 525, 527,
        525, 525, 349, 391, 335, 525, 452, 715, 433, 453, 395, 314, 460, 314, 498,
    ];

    private static readonly int[] Arial =
    [
        278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
        556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
        1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
        667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
        333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
        556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
    ];

    /// <summary>The usable width (points) of cells that together are <paramref name="widths"/> characters wide.</summary>
    public static double UsableWidth(IEnumerable<double> widths, int digitPixels)
    {
        var pixels = widths.Sum(w => ColumnPixels(w, digitPixels));
        return Math.Max(0, pixels - CellPaddingPixels) * 0.75;
    }

    /// <summary>Excel's pixel width of a column of <paramref name="width"/> characters (saved widths include the padding).</summary>
    public static double ColumnPixels(double width, int digitPixels) =>
        width <= 0 ? 0 : Math.Truncate((((256 * width) + Math.Truncate(128.0 / digitPixels)) / 256) * digitPixels);

    /// <summary>The pixel width of the font's digits, which Excel measures column widths in.</summary>
    public static int DigitPixels(string? font, double size, bool bold = false) =>
        Math.Max(1, (int)Math.Round(Width("0", font, size, bold) * 96 / 72));

    /// <summary>The text's width in points on one line.</summary>
    public static double Width(string text, string? font, double size, bool bold = false)
    {
        var name = font ?? string.Empty;
        var calibri = name.Contains("Calibri", StringComparison.OrdinalIgnoreCase);
        var table = calibri ? Calibri : Arial;
        var scale = name.Contains("Narrow", StringComparison.OrdinalIgnoreCase) ? 0.82 : 1;
        if (bold) scale *= 1.07;
        double units = 0;
        foreach (var c in text)
        {
            units += c is >= ' ' and <= '~' ? table[c - ' '] : 700;
        }
        return units / 1000 * size * scale;
    }

    /// <summary>
    /// The largest size from <paramref name="size"/> down (in half points) at which the text fits the cell, kept on one line
    /// when that allows the larger size, otherwise wrapped onto as many lines as the height holds.
    /// </summary>
    public static FitResult Fit(string text, string? font, double size, bool bold, double width, double height)
    {
        text = text.Trim();
        width *= Spare;
        if (text.Length == 0) return new FitResult(size, 1);
        for (var candidate = size; candidate >= MinSize; candidate = Math.Ceiling(candidate / Step - 1) * Step)
        {
            var lines = Lines(text, font, candidate, bold, width);
            if (lines == 1 || lines <= LinesThatFit(candidate, height)) return new FitResult(candidate, lines);
        }
        return new FitResult(MinSize, Math.Min(Lines(text, font, MinSize, bold, width), LinesThatFit(MinSize, height)));
    }

    /// <summary>
    /// True when the text, as the cell shows it now, stays inside the cell without its row growing; a text squeezed in by
    /// hand may be measured a little wider than the cell (see <see cref="Tolerance"/>).
    /// </summary>
    public static bool FitsAsShown(string text, CellFont font, double width, double height, bool squeezed)
    {
        var lines = Lines(text.Trim(), font.Name, font.Size, font.Bold, squeezed ? width * Tolerance : width);
        return lines == 1 || (font.Wrap && lines <= LinesThatFit(font.Size, height));
    }

    private static int LinesThatFit(double size, double height) => Math.Max(1, (int)Math.Floor((height - RowPadding) / (size * LineSpacing)));

    /// <summary>The lines Excel's wrapping makes of the text: words go on while they fit, a word too long is broken.</summary>
    public static int Lines(string text, string? font, double size, bool bold, double width)
    {
        var lines = 1;
        double used = 0;
        var space = Width(" ", font, size, bold);
        foreach (var word in text.Split(' '))
        {
            var length = Width(word, font, size, bold);
            if (used > 0 && used + space + length <= width)
            {
                used += space + length;
                continue;
            }
            if (used > 0)
            {
                lines++;
                used = 0;
            }
            if (length <= width)
            {
                used = length;
                continue;
            }
            foreach (var c in word)
            {
                var w = Width(c.ToString(), font, size, bold);
                if (used > 0 && used + w > width)
                {
                    lines++;
                    used = 0;
                }
                used += w;
            }
        }
        return lines;
    }
}
