namespace MPHRegister.Shared.Constants;

public static class Limits
{
    public const long MaxUploadBytes = 25 * 1024 * 1024;
    public const int BackupsToKeep = 30;
    public const int MaxBillRows = 60;
    public const int MinRowsPerBill = 5;
    public const int MaxBillText = 200;
    public const decimal MaxRate = 100_000m;
    public const int MaxQuantity = 1_000_000;
    public const int PartyNameMax = 100;
    public const int FinishNameMax = 40;
    public const int StyleNameMax = 60;
    public const int ColorNameMax = 30;
    public const int ConfigTextMax = 300;
    public const int MaxTerms = 4;
    public const int MaxCombineUpTo = 20;
    public const int MaxSmallThan = 100;
    public const decimal MaxGstPercent = 28m;
    public const decimal MinSmallestFontPt = 5m;
    public const decimal MaxSmallestFontPt = 12m;
    public const int MaxFallbacks = 5;
    public const int RecentEntriesDefault = 30;
    public const int RecentEntriesMax = 200;
    public const int MaxSignatureBytes = 512 * 1024;
    public const int PdfTimeoutSeconds = 90;
}
