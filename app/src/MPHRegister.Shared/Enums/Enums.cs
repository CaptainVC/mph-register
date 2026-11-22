namespace MPHRegister.Shared.Enums;

public enum EntryStatus
{
    Done,
    Partial,
    Pending,
    Over,

    /// <summary>THAN, TP and TWO PART are 0 and nothing is dispatched: a slip kept for its number (see AllZeroSlip).</summary>
    AllZero,
}

public enum DispatchState
{
    None,
    Partial,
    Full,
}

public enum LineKind
{
    Detail,
    Priced,
    Blank,
}

public enum TaxMode
{
    Intra,
    Inter,
}

public enum InvoiceStatus
{
    Draft,
    Saved,
    Cancelled,
}

public enum InvoiceSource
{
    App,
    Excel,
}

/// <summary>What one of the bill's reference columns (G.P.N., D.N., LOT NO.) shows for a bill line.</summary>
public enum ColumnContent
{
    /// <summary>Nothing.</summary>
    Blank,

    /// <summary>The gate pass numbers of the line's dispatches.</summary>
    GatePass,

    /// <summary>The inward D.N. (design number).</summary>
    DesignNo,

    /// <summary>The inward LOT N.</summary>
    LotNo,
}

/// <summary>How inward entries become bill lines.</summary>
public enum LineGrouping
{
    /// <summary>One line per inward entry.</summary>
    OnePerEntry,

    /// <summary>Entries of the same finish and lot share one line ("L 624" and "624" are the same lot).</summary>
    SameLot,

    /// <summary>Entries of the same finish sent on the same gate pass share one line.</summary>
    SameGatePass,
}

/// <summary>The order of lines within each finish on the bill.</summary>
public enum LineOrder
{
    /// <summary>Register month, carryovers first, then inward number.</summary>
    Inward,

    /// <summary>By the number printed on the line (lot, else D.N., else gate pass), smallest first.</summary>
    Reference,

    /// <summary>By inward date.</summary>
    InwardDate,
}

public enum PaperSize
{
    Letter,
    A4,
}

public enum UiTheme
{
    Light,
    Dark,
}

public enum UiLanguage
{
    En,
    Hi,
}

/// <summary>Where the data folder came from.</summary>
public enum DataFolderSource
{
    /// <summary>The MPH_DATA_DIR environment variable.</summary>
    Environment,

    /// <summary>A "MPH Register Data" folder next to the app (portable, e.g. on a pendrive).</summary>
    NextToApp,

    /// <summary>Documents/MPH Register Data.</summary>
    Documents,
}
