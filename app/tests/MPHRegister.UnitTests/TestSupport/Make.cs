using MPHRegister.Api.Modules;
using MPHRegister.Contracts.Billing;
using MPHRegister.Contracts.Entries;
using MPHRegister.Contracts.Settings;
using MPHRegister.Services.Billing;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Enums;

namespace MPHRegister.UnitTests.TestSupport;

/// <summary>Made-up firms, parties, entries and bill lines. Nothing here depends on the real config file.</summary>
internal static class Make
{
    private static readonly Lazy<BillGeometry> TemplateGeometry = new(() =>
    {
        using var stream = ApiModule.WebFiles().GetFileInfo(ApiModule.BillTemplateFile).CreateReadStream();
        return BillGeometry.FromTemplate(stream);
    });

    /// <summary>The page of the real print template shipped with the app.</summary>
    public static BillGeometry Geometry => TemplateGeometry.Value;

    public static BillLineSizer Sizer => new(Geometry);

    public static FirmSettings Firm(int rows = 25, decimal limit = 200000, int smallBelow = 5, int combineMax = 4, string homeCode = "08",
        decimal cgst = 2.5m, decimal sgst = 2.5m, decimal igst = 5m) => new(
        "TEST FIRM", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", homeCode, "HOME STATE",
        cgst, sgst, igst, limit, rows, "{FY}\\T\\", smallBelow, combineMax);

    public static EntryDto Entry(long id, int than, string finish = "F1", string lot = "", string dn = "", int inward = 0, string month = "2026-10",
        int dispatched = -1, string date = "2026-10-01", string gatePass = "G1", bool carried = false, string party = "PARTY A", int twoPart = 0)
    {
        var sent = dispatched < 0 ? than + twoPart : dispatched;
        return new EntryDto(id, month, inward == 0 ? (int)id : inward, date, party, dn, lot, false, than, 0, than, finish, than, twoPart, null, carried, true, null,
            sent == 0 ? [] : [new DispatchDto(sent, gatePass, date, null)], sent, than + twoPart - sent, EntryStatus.Done, [], null);
    }

    public static LineDto Priced(int qty, decimal? rate, string finish = "F1", bool autoSum = false, string dn = "", string lot = "", string gpn = "") =>
        new(LineKind.Priced, gpn, dn, lot, finish, qty, rate, null, autoSum, []);

    public static LineDto Detail(int qty, string dn = "1", string lot = "", string gpn = "") => new(LineKind.Detail, gpn, dn, lot, "", qty, null, null, false, []);

    public static BillingStyle Style(
        ColumnContent gpn = ColumnContent.Blank, ColumnContent dn = ColumnContent.DesignNo, ColumnContent lot = ColumnContent.LotNo,
        LineGrouping lines = LineGrouping.OnePerEntry, LineOrder order = LineOrder.Inward, bool breakdown = false, bool combine = true) => new()
    {
        Name = "TEST STYLE",
        GpnColumn = gpn,
        DnColumn = dn,
        LotColumn = lot,
        Lines = lines,
        Order = order,
        ShowQuantityBreakdown = breakdown,
        CombineSmallEntries = combine,
    };

    public static FinishResolver Rates(params (string Finish, decimal Rate)[] rates) => Resolver(new Dictionary<string, string>(), rates);

    public static FinishResolver Resolver(IReadOnlyDictionary<string, string> billAs, (string Finish, decimal Rate)[] rates,
        IReadOnlyDictionary<string, IReadOnlyList<string>>? fallbacks = null) => new(
        billAs,
        rates.ToDictionary(r => r.Finish, r => r.Rate, StringComparer.OrdinalIgnoreCase),
        fallbacks ?? new Dictionary<string, IReadOnlyList<string>>(StringComparer.OrdinalIgnoreCase));

    public static InvoiceDoc Doc(IReadOnlyList<LineDto> lines, FirmSettings? firm = null, string gstin = "08TESTF9001J1ZJ", decimal discount = 0, TaxMode mode = TaxMode.Intra) =>
        new(null, null, "PARTY A", "PARTY A", "", "", gstin, "2026-10-31", "2026-10-01", "2026-10-31", discount, mode, 2.5m, 2.5m, 5m,
            0, 0, 0, 0, 0, 0, 0, 0, InvoiceStatus.Draft, InvoiceSource.App, "", "", lines, [], firm ?? Firm(), null, null);

    public static List<List<LineDto>> Pack(IReadOnlyList<EntryDto> entries, BillingStyle style, FinishResolver rates, FirmSettings firm, decimal discount = 0)
    {
        var sizer = Sizer;
        return BillPacker.Pack(BillItemBuilder.Build(entries, style, firm, rates), rates, discount, TaxMode.Intra, firm, l => sizer.RowsFor(l, 7.5m));
    }

    /// <summary>A new folder under the temp folder, deleted when disposed.</summary>
    public static TempFolder Folder() => new();
}

internal sealed class TempFolder : IDisposable
{
    public string Path { get; } = Directory.CreateTempSubdirectory("mph-unit-").FullName;

    public string File(string name) => System.IO.Path.Combine(Path, name);

    public void Dispose()
    {
        try
        {
            Directory.Delete(Path, recursive: true);
        }
        catch (IOException)
        {
            // Best-effort temp directory cleanup.
        }
    }
}
