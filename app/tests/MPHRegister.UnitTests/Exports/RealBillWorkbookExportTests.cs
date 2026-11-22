using MPHRegister.Contracts.Billing;
using MPHRegister.Services.Exports.Bills;
using MPHRegister.Services.Imports.Bills;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.UnitTests.Exports;

/// <summary>
/// Writes bills into the real October bill workbook in the Workbooks folder next to the checkout (skipped when it is
/// not there): its own bills are found already in place, and copies of them go into its empty places and read back the same.
/// </summary>
public sealed class RealBillWorkbookExportTests
{
    private static readonly string Workbooks = Environment.GetEnvironmentVariable("MPH_WORKBOOKS") ?? FindWorkbooks();

    private static string FindWorkbooks()
    {
        for (var folder = new DirectoryInfo(AppContext.BaseDirectory); folder is not null; folder = folder.Parent)
        {
            var candidate = Path.Combine(folder.FullName, "Workbooks");
            if (Directory.Exists(candidate)) return candidate;
        }
        return Path.Combine(AppContext.BaseDirectory, "Workbooks");
    }

    private static string October => Path.Combine(Workbooks, "MPH BILL--OCT.-26-27.xlsm");

    /// <summary>The app's bill for a bill of the workbook, as the bill import makes it.</summary>
    internal static InvoiceDoc ToDoc(SheetBill bill, long id, string? number = null) => new(
        id, number ?? bill.InvoiceNo, bill.PartyText, bill.PartyText, bill.Address, bill.State, bill.Gstin, bill.BillDate, bill.PeriodFrom, bill.PeriodTo,
        bill.Gross == 0 ? 0 : Math.Round(bill.Discount * 100m / bill.Gross, 2), TaxMode.Intra, bill.CgstRate ?? 2.5m, bill.SgstRate ?? 2.5m, 5m,
        bill.Gross, bill.Discount, bill.Taxable, bill.Cgst, bill.Sgst, 0, bill.Total, bill.Lines.Where(l => l.Kind == LineKind.Priced).Sum(l => l.Qty ?? 0),
        InvoiceStatus.Saved, InvoiceSource.App, string.Empty, string.Empty,
        bill.Lines.Select(l => l with { Amount = l.Kind == LineKind.Priced && l.Rate is { } r ? Money.RoundRupee(r * (l.Qty ?? 0)) : null }).ToList(),
        [], null, null, null);

    [Fact]
    public void Its_own_bills_are_already_there()
    {
        if (!File.Exists(October)) return;
        var sheet = BillSheetReader.Read(October)!;
        var docs = sheet.Bills.Select((b, i) => ToDoc(b, i + 1)).ToList();
        var result = BillExporter.Run(File.ReadAllBytes(October), "oct.xlsm", docs, new HashSet<long>());
        Assert.Empty(result.Preview.Problems);
        Assert.Null(result.Content);
        var notSame = result.Preview.Bills.Where(b => b.Status != BillExportStatus.Same).Select(b => $"{b.InvoiceNo}: {b.Status} {string.Join("; ", b.Differences.Concat(b.Problems))}").ToList();
        Assert.True(notSame.Count == 0, string.Join("\n", notSame));
    }

    [Fact]
    public void Copies_of_its_bills_go_into_the_empty_places_and_read_back_the_same()
    {
        if (!File.Exists(October)) return;
        var sheet = BillSheetReader.Read(October)!;
        var serial = 279;
        var docs = sheet.Bills.Take(20).Select((b, i) => ToDoc(b, i + 1, $"26-27\\JOB\\{serial + i}")).ToList();
        var result = BillExporter.Run(File.ReadAllBytes(October), "oct.xlsm", docs, new HashSet<long>());
        Assert.True(result.Preview.Problems.Count == 0, string.Join("\n", result.Preview.Problems));
        Assert.All(result.Preview.Bills, b => Assert.Equal(BillExportStatus.Write, b.Status));
        Assert.NotNull(result.Content);
        Assert.Equal(20, result.Preview.ToWrite);
        Assert.All(result.Preview.Bills, b => Assert.DoesNotContain(b.Typed, t => t.StartsWith("Address", StringComparison.Ordinal)
            || t.StartsWith("State", StringComparison.Ordinal) || t.StartsWith("GSTIN", StringComparison.Ordinal) || t.StartsWith("The party", StringComparison.Ordinal)));
        Assert.True(result.Preview.Bills.Sum(b => b.Typed.Count) <= 4, string.Join("\n", result.Preview.Bills.SelectMany(b => b.Typed)));

        var path = Path.Combine(Path.GetTempPath(), $"mph-real-export-{Guid.NewGuid():N}.xlsm");
        try
        {
            File.WriteAllBytes(path, result.Content);
            var after = BillSheetReader.Read(path)!;
            Assert.Empty(after.Errors);
            Assert.Equal(71, after.Bills.Count);
            foreach (var doc in docs)
            {
                var bill = after.Bills.Single(b => b.InvoiceNo == doc.InvoiceNo);
                Assert.Empty(SheetBillComparer.Differences(bill, doc));
            }
        }
        finally
        {
            File.Delete(path);
        }
    }
}
