using MPHRegister.Contracts.Billing;
using MPHRegister.Data.Config;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Services.Exports.Bills;
using MPHRegister.Services.Interfaces;
using MPHRegister.Services.Mapping;
using MPHRegister.Shared.Exceptions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Billing;

/// <summary>Writes saved bills into a copy of the monthly Excel bill workbook (see <see cref="BillExporter"/>).</summary>
public sealed class BillExportService(IInvoiceRepository invoices, IBillExportRepository exports, TimeProvider clock, IConfigStore config) : IBillExportService
{
    private const int MaxBills = 100;
    private const string MacroWorkbook = "application/vnd.ms-excel.sheet.macroEnabled.12";
    private const string Workbook = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    public BillExportPreview Preview(string filePath, string fileName, BillExportRequest request) => Run(filePath, fileName, request).Preview;

    public BillExportFile Export(string filePath, string fileName, BillExportRequest request)
    {
        var result = Run(filePath, fileName, request);
        if (result.Content is null) throw new AppValidationException(WhyNothing(result.Preview));
        var now = Dates.Timestamp(clock.GetLocalNow());
        foreach (var bill in result.InWorkbook)
        {
            var invoice = invoices.Get(bill.InvoiceId);
            if (invoice is null) continue;
            exports.Add(new BillExportEntity(bill.InvoiceId, bill.InvoiceNo, fileName, bill.Cell, now, invoice.UpdatedAt));
        }
        var macro = string.Equals(Path.GetExtension(fileName), ".xlsm", StringComparison.OrdinalIgnoreCase);
        return new BillExportFile(result.Content, fileName, macro ? MacroWorkbook : Workbook, result.Preview);
    }

    private ExportResult Run(string filePath, string fileName, BillExportRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (string.Equals(Path.GetExtension(fileName), ".xls", StringComparison.OrdinalIgnoreCase))
            throw new AppValidationException("Bills can only be written into an .xlsm or .xlsx workbook. Save the .xls workbook as .xlsm in Excel first.");
        var ids = (request.Ids ?? []).Distinct().ToList();
        if (ids.Count == 0) throw new AppValidationException("Tick the bills to export to Excel.");
        if (ids.Count > MaxBills) throw new AppValidationException($"At most {MaxBills} bills fit in one bill workbook; tick fewer bills.");
        var docs = ids.Select(id =>
        {
            var invoice = invoices.Get(id) ?? throw new NotFoundException($"Bill {id} was not found. Reopen Saved bills and try again.");
            return InvoiceMapper.ToDoc(invoice, invoices.Lines(id));
        }).ToList();
        return BillExporter.Run(File.ReadAllBytes(filePath), fileName, docs, (request.Replace ?? []).ToHashSet(), config.Current.Colors);
    }

    private static List<string> WhyNothing(BillExportPreview preview)
    {
        if (preview.Problems.Count > 0) return preview.Problems.ToList();
        var waiting = preview.Bills.Count(b => b.Status == BillExportStatus.Different);
        var reasons = new List<string> { "Nothing to write:" };
        if (preview.Bills.Any(b => b.Status == BillExportStatus.Same)) reasons.Add("the workbook already has some of these bills exactly as in the app;");
        if (waiting > 0) reasons.Add($"{waiting} bill(s) are in the workbook with differences — tick \"Replace\" to write over them;");
        if (preview.Bills.Any(b => b.Status == BillExportStatus.Blocked)) reasons.Add("the other bills cannot be written (see the check).");
        return [string.Join(" ", reasons)];
    }
}
