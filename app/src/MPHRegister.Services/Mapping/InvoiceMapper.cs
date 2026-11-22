using System.Text.Json;
using MPHRegister.Contracts.Billing;
using MPHRegister.Contracts.Settings;
using MPHRegister.Data.Entities;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Helpers;
using MPHRegister.Shared.Json;

namespace MPHRegister.Services.Mapping;

public static class InvoiceMapper
{
    public static InvoiceDoc ToDoc(InvoiceEntity invoice, IReadOnlyList<InvoiceLineEntity> lines)
    {
        ArgumentNullException.ThrowIfNull(invoice);
        ArgumentNullException.ThrowIfNull(lines);
        var lineDtos = lines.Select(ToDto).ToList();
        return new InvoiceDoc(invoice.Id, invoice.InvoiceNo, invoice.Party, invoice.PartyName, invoice.Address, invoice.State, invoice.Gstin,
            invoice.BillDate, invoice.PeriodFrom, invoice.PeriodTo, Convert.ToDecimal(invoice.DiscountPct),
            invoice.TaxMode.ToEnum(TaxMode.Intra), Convert.ToDecimal(invoice.CgstRate), Convert.ToDecimal(invoice.SgstRate),
            Convert.ToDecimal(invoice.IgstRate), invoice.Gross, invoice.Discount, invoice.Taxable, invoice.Cgst, invoice.Sgst, invoice.Igst,
            invoice.Total, lineDtos.Where(l => l.Kind == LineKind.Priced).Sum(l => l.Qty ?? 0), invoice.Status.ToEnum(InvoiceStatus.Saved),
            invoice.Source.ToEnum(InvoiceSource.App), invoice.Notes, RupeeWords.Format(invoice.Total), lineDtos, [],
            JsonSerializer.Deserialize<FirmSettings>(invoice.Firm, JsonDefaults.Options), invoice.CreatedAt, invoice.UpdatedAt);
    }

    public static InvoiceEntity ToEntity(InvoiceDoc doc, string fy, int serial, string now)
    {
        ArgumentNullException.ThrowIfNull(doc);
        var billDate = Dates.ParseIsoOrDefault(doc.BillDate);
        return new InvoiceEntity
        {
            Id = doc.Id ?? 0,
            InvoiceNo = doc.InvoiceNo ?? string.Empty,
            Fy = fy,
            Serial = serial,
            Party = doc.Party,
            PartyName = doc.PartyName,
            Address = doc.Address,
            State = doc.State,
            Gstin = doc.Gstin,
            BillDate = doc.BillDate,
            BillMonth = Dates.Month(billDate),
            PeriodFrom = doc.PeriodFrom,
            PeriodTo = doc.PeriodTo,
            DiscountPct = (double)doc.DiscountPct,
            TaxMode = doc.TaxMode.ToDbValue(),
            CgstRate = (double)doc.CgstRate,
            SgstRate = (double)doc.SgstRate,
            IgstRate = (double)doc.IgstRate,
            Gross = doc.Gross,
            Discount = doc.Discount,
            Taxable = doc.Taxable,
            Cgst = doc.Cgst,
            Sgst = doc.Sgst,
            Igst = doc.Igst,
            Total = doc.Total,
            Status = doc.Status.ToDbValue(),
            Source = doc.Source.ToDbValue(),
            Firm = JsonSerializer.Serialize(doc.Firm, JsonDefaults.Options),
            Notes = doc.Notes ?? string.Empty,
            CreatedAt = now,
            UpdatedAt = now,
        };
    }

    public static InvoiceLineEntity ToEntity(LineDto line)
    {
        ArgumentNullException.ThrowIfNull(line);
        return new InvoiceLineEntity
        {
            Kind = line.Kind.ToDbValue(),
            Gpn = (line.Gpn ?? string.Empty).Trim(),
            Dn = (line.Dn ?? string.Empty).Trim(),
            Lot = (line.Lot ?? string.Empty).Trim(),
            Finish = (line.Finish ?? string.Empty).Trim(),
            Qty = line.Qty,
            Rate = line.Rate is { } rate ? (double)rate : null,
            Amount = line.Amount,
            AutoSum = line.AutoSum,
            EntryIds = JsonSerializer.Serialize(line.EntryIds ?? [], JsonDefaults.Options),
        };
    }

    public static LineDto ToDto(InvoiceLineEntity line)
    {
        ArgumentNullException.ThrowIfNull(line);
        return new LineDto(line.Kind.ToEnum(LineKind.Detail), line.Gpn, line.Dn, line.Lot, line.Finish, line.Qty,
            line.Rate is { } rate ? Convert.ToDecimal(rate) : null, line.Amount, line.AutoSum,
            JsonSerializer.Deserialize<List<long>>(line.EntryIds, JsonDefaults.Options) ?? []);
    }
}
