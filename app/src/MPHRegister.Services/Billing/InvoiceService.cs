using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentValidation;
using MPHRegister.Contracts.Billing;
using MPHRegister.Contracts.Masters;
using MPHRegister.Data.Database;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Services.Interfaces;
using MPHRegister.Services.Mapping;
using MPHRegister.Services.Validators;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Exceptions;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Helpers;
using MPHRegister.Shared.Json;

namespace MPHRegister.Services.Billing;

public sealed class InvoiceService(
    IDbSession session,
    IInvoiceRepository invoices,
    IMasterReader masters,
    ISettingsService settings,
    BillLineSizer sizer,
    IValidator<BillDates> datesValidator,
    IValidator<BillLines> linesValidator,
    TimeProvider clock) : IInvoiceService
{
    private const int MaxNotes = 500;

    public IReadOnlyList<InvoiceSummary> List(string? month, string? party) => invoices
        .List(Dates.IsValidMonth(month) ? month : null, string.IsNullOrWhiteSpace(party) ? null : party.NormalizeName())
        .Select(r => new InvoiceSummary(r.Id, r.InvoiceNo, r.BillDate, r.BillMonth, r.Party, r.PartyName, r.Than, r.Total,
            r.Status.ToEnum(InvoiceStatus.Saved), r.Source.ToEnum(InvoiceSource.App), r.Finishes ?? string.Empty, r.Entries))
        .ToList();

    public InvoiceDoc Get(long id)
    {
        var invoice = invoices.Get(id) ?? throw new NotFoundException("Bill not found.");
        var lines = invoices.Lines(id);
        var doc = ToDoc(invoice, lines);
        var warnings = new List<string>();
        if (doc.Status == InvoiceStatus.Cancelled) warnings.Add("This bill is CANCELLED.");
        if (doc.Gstin.Length > 0 && !Gstin.IsValid(doc.Gstin)) warnings.Add($"GSTIN {doc.Gstin} on this bill is not valid.");
        foreach (var finish in doc.Lines.Where(l => l.Kind == LineKind.Priced && l.Rate is null).Select(l => l.Finish).Distinct())
            warnings.Add($"No rate for {finish}.");
        if (doc.Firm is { InvoiceLimit: > 0 } f && doc.Total >= f.InvoiceLimit) warnings.Add($"Bill total is not below the {IndianNumbers.Rupees(f.InvoiceLimit)} limit.");
        return doc with { Warnings = warnings, UndoSave = UndoAvailability(invoice, Snapshot(invoice, lines)), Restore = RestoreAvailability(invoice, doc) };
    }

    public InvoiceDoc Edit(long id, InvoiceEdit edit)
    {
        ArgumentNullException.ThrowIfNull(edit);
        using var unit = session.Begin();
        var current = Find(id) ?? throw new NotFoundException("Bill not found.");
        if (current.Status != InvoiceStatus.Saved) throw new AppValidationException("A cancelled bill cannot be changed.");
        var firm = settings.Snapshot();
        var bill = current.Firm ?? firm;
        var errors = datesValidator.ErrorsFor(new BillDates(edit.BillDate, edit.PeriodFrom, edit.PeriodTo));
        var lineErrors = linesValidator.ErrorsFor(new BillLines(edit.Lines));
        errors.AddRange(lineErrors);
        if (lineErrors.Count == 0)
        {
            var sized = edit.Lines!.Select(l => l with { Rows = sizer.RowsFor(l, BillCalculator.SmallestFont(bill, firm)) }).ToList();
            if (BillCalculator.RowsProblem(sized, bill.RowsPerInvoice, "The bill ") is { } rows) errors.Add(rows);
        }
        if ((edit.Notes ?? string.Empty).Length > MaxNotes) errors.Add($"Notes can be at most {MaxNotes} characters.");
        if (Dates.TryParseIso(edit.BillDate, out var newDate) && Dates.TryParseIso(current.BillDate, out var oldDate)
            && FinancialYear.Of(newDate) != FinancialYear.Of(oldDate))
        {
            errors.Add($"The bill date must stay in financial year {FinancialYear.Of(oldDate)} because the bill number belongs to it.");
        }
        var allowed = current.Lines.SelectMany(l => l.EntryIds ?? []).ToHashSet();
        var ids = (edit.Lines ?? []).SelectMany(l => l.EntryIds ?? []).ToList();
        if (ids.Any(i => !allowed.Contains(i))) errors.Add("Entries can only be removed from a saved bill, not added. Make a new bill for new entries.");
        if (ids.Count != ids.Distinct().Count()) errors.Add("An entry appears on more than one line.");
        if (errors.Count > 0) throw new AppValidationException(errors);

        var doc = current with { BillDate = edit.BillDate!, PeriodFrom = edit.PeriodFrom!, PeriodTo = edit.PeriodTo!, Notes = (edit.Notes ?? string.Empty).Trim(), Lines = edit.Lines! };
        PartyDto? party = null;
        if (edit.RefreshParty)
        {
            party = masters.Party(current.Party) ?? throw new AppValidationException($"Party \"{current.Party}\" is no longer in the party list.");
            doc = doc with
            {
                PartyName = party.Name,
                Address = party.Address,
                State = party.State,
                Gstin = party.Gstin,
                DiscountPct = party.Discount ?? 0,
                TaxMode = TaxModes.Resolve(firm, party.Gstin, party.State),
                CgstRate = firm.CgstRate,
                SgstRate = firm.SgstRate,
                IgstRate = firm.IgstRate,
            };
        }
        var finished = BillCalculator.Complete(doc, party, null, firm, sizer);
        invoices.UpdateEdited(InvoiceMapper.ToEntity(finished, string.Empty, 0, Dates.Timestamp(clock.GetLocalNow())));
        invoices.ReplaceLines(id, finished.Lines.Select(InvoiceMapper.ToEntity).ToList(), ids);
        unit.Commit();
        return Get(id);
    }

    public InvoiceDoc Cancel(long id)
    {
        using var unit = session.Begin();
        var current = Find(id) ?? throw new NotFoundException("Bill not found.");
        if (current.Status == InvoiceStatus.Cancelled) throw new AppValidationException("This bill is already cancelled.");
        invoices.Cancel(id, Dates.Timestamp(clock.GetLocalNow()));
        unit.Commit();
        return Get(id);
    }

    public InvoiceDoc Restore(long id)
    {
        using var unit = session.Begin();
        var invoice = invoices.Get(id) ?? throw new NotFoundException("Bill not found.");
        if (invoice.Status != InvoiceStatus.Cancelled.ToDbValue()) throw new AppValidationException("Only a cancelled bill can be restored.");
        var entryIds = EntryIdsOf(ToDoc(invoice, invoices.Lines(id)));
        if (RestoreBlockers(id, entryIds) is { } reason) throw new AppValidationException(reason);
        invoices.Restore(id, entryIds, Dates.Timestamp(clock.GetLocalNow()));
        unit.Commit();
        return Get(id);
    }

    private InvoiceRestoreAvailability? RestoreAvailability(InvoiceEntity invoice, InvoiceDoc doc)
    {
        if (invoice.Status != InvoiceStatus.Cancelled.ToDbValue()) return null;
        var reason = RestoreBlockers(invoice.Id, EntryIdsOf(doc));
        return new(reason is null, reason);
    }

    private static List<long> EntryIdsOf(InvoiceDoc doc) => doc.Lines.SelectMany(l => l.EntryIds ?? []).Distinct().ToList();

    /// <summary>Null when every entry of the bill is free to go back on it; otherwise says which ones are not.</summary>
    private string? RestoreBlockers(long id, IReadOnlyCollection<long> entryIds)
    {
        var claims = invoices.EntryClaims(id, entryIds);
        if (claims.Count == 0) return null;
        const int shown = 5;
        var lines = claims.Take(shown).Select(c => c switch
        {
            { Missing: true } => $"Entry {c.EntryId} no longer exists.",
            { Bill.Length: > 0 } => $"{Slip(c)} is already on bill {c.Bill}.",
            _ => $"{Slip(c)} is marked billed elsewhere ({c.Elsewhere}).",
        }).ToList();
        if (claims.Count > shown) lines.Add($"…and {claims.Count - shown} more.");
        return $"This bill cannot be restored because its entries are in use. {string.Join(" ", lines)}";
    }

    private static string Slip(InvoiceEntryClaim claim) => $"{claim.Party} inward {claim.InwardNo} ({claim.RegisterMonth})";

    public UndoInvoiceSaveResult UndoSave(long id, UndoInvoiceSaveRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!request.NeverIssued) throw new AppValidationException("Confirm that this bill was never issued to a customer, reported for GST, or given an IRN.");
        using var unit = session.Begin();
        var invoice = invoices.Get(id) ?? throw new NotFoundException("Bill not found.");
        var snapshot = Snapshot(invoice, invoices.Lines(id));
        var availability = UndoAvailability(invoice, snapshot);
        if (!availability.Allowed) throw new AppValidationException(availability.Reason!);
        if (!string.Equals(request.Token, availability.Token, StringComparison.Ordinal))
            throw new AppValidationException("The bill has changed. Reopen it before undoing the save.");

        invoices.UndoSave(new InvoiceUndoEntity(id, invoice.InvoiceNo, invoice.Fy, invoice.Serial, snapshot, Dates.Timestamp(clock.GetLocalNow())));
        settings.SetNextSerial(invoice.Fy, invoice.Serial);
        unit.Commit();
        return new UndoInvoiceSaveResult(invoice.InvoiceNo, invoice.Serial);
    }

    private InvoiceUndoAvailability UndoAvailability(InvoiceEntity invoice, string snapshot)
    {
        if (invoice.Status != InvoiceStatus.Saved.ToDbValue())
            return new(false, "A cancelled bill keeps its number and cannot be undone.", null);
        if (invoice.Source != InvoiceSource.App.ToDbValue())
            return new(false, "Imported Excel bills cannot release their numbers.", null);
        if (invoices.MaxSerial(invoice.Fy) != invoice.Serial)
            return new(false, "A later bill exists in this financial year, even if it is cancelled or for another party.", null);
        if ((long)settings.NextSerial(invoice.Fy) != (long)invoice.Serial + 1)
            return new(false, "The next bill number has been changed. It cannot be rewound by undoing this save.", null);
        return new(true, null, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(snapshot))));
    }

    private static string Snapshot(InvoiceEntity invoice, IReadOnlyList<InvoiceLineEntity> lines) =>
        JsonSerializer.Serialize(new { invoice, lines }, JsonDefaults.Options);

    /// <summary>A saved bill with the printed rows of each line worked out, as the print page needs them.</summary>
    private InvoiceDoc? Find(long id)
    {
        if (invoices.Get(id) is not { } invoice) return null;
        return ToDoc(invoice, invoices.Lines(id));
    }

    private InvoiceDoc ToDoc(InvoiceEntity invoice, IReadOnlyList<InvoiceLineEntity> lines)
    {
        var doc = InvoiceMapper.ToDoc(invoice, lines);
        var current = settings.Snapshot();
        var smallest = BillCalculator.SmallestFont(doc.Firm ?? current, current);
        return doc with { Lines = doc.Lines.Select(l => l with { Rows = sizer.RowsFor(l, smallest) }).ToList() };
    }
}
