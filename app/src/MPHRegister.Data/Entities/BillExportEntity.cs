namespace MPHRegister.Data.Entities;

/// <summary>A saved bill written into (or found already in) a copy of the Excel bill workbook.</summary>
public sealed record BillExportEntity(
    long InvoiceId,
    string InvoiceNo,
    string FileName,
    string Cell,
    string ExportedAt,
    string InvoiceUpdatedAt);
