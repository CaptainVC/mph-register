namespace MPHRegister.Contracts.Billing;

/// <summary>What happens to a bill when it is written into the bill workbook.</summary>
public enum BillExportStatus
{
    /// <summary>Its place in the workbook is empty: the bill is written there.</summary>
    Write,

    /// <summary>Its place holds an older version of the bill, which is written over (the user asked for it).</summary>
    Replace,

    /// <summary>Its place already holds exactly this bill: nothing to do.</summary>
    Same,

    /// <summary>Its place holds this bill with differences; it is only written over when the user asks for it.</summary>
    Different,

    /// <summary>It cannot be written (see the problems).</summary>
    Blocked,
}

/// <param name="Ids">Saved bills to write, by id.</param>
/// <param name="Replace">Bills whose place already holds a different version of them that may be written over.</param>
public sealed record BillExportRequest(IReadOnlyList<long>? Ids, IReadOnlyList<long>? Replace);

/// <param name="Place">Where the bill goes, e.g. "column 3, bill 2 (O50:U98)"; null when its number is not in the workbook.</param>
/// <param name="Typed">Values typed over the workbook's formulas because the workbook would show something else.</param>
/// <param name="Differences">How the bill already in its place differs from the app's bill.</param>
public sealed record BillExportRow(
    long InvoiceId,
    string InvoiceNo,
    string PartyName,
    string BillDate,
    long Total,
    BillExportStatus Status,
    string? Place,
    IReadOnlyList<string> Typed,
    IReadOnlyList<string> Differences,
    IReadOnlyList<string> Problems);

/// <param name="FirstNumber">The bill no. of the workbook's first place (after the change in <paramref name="Notes"/>, if any).</param>
/// <param name="FilledPlaces">Places that already hold a bill before writing.</param>
/// <param name="Notes">Changes to the workbook outside the written bills (its first bill no., dates kept by typing them in).</param>
/// <param name="Problems">Why nothing can be written into this workbook.</param>
/// <param name="ToWrite">Bills that will be written (new or written over).</param>
public sealed record BillExportPreview(
    string FileName,
    string? FirstNumber,
    string? LastNumber,
    int FilledPlaces,
    int Places,
    IReadOnlyList<BillExportRow> Bills,
    IReadOnlyList<string> Notes,
    IReadOnlyList<string> Problems,
    int ToWrite);
