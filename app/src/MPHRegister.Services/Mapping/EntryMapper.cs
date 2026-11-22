using MPHRegister.Contracts.Entries;
using MPHRegister.Data.Entities;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Mapping;

public static class EntryMapper
{
    public const string MarkedButCharged = "LOT N. or D.N. is marked R (repair) but REP. is No, so it will be charged.";

    public static EntryDto ToDto(EntryEntity row, IReadOnlyList<DispatchEntity> dispatchRows, bool duplicateNumber, bool noBillNeeded = false, ImportMarkEntity? lastImport = null)
    {
        ArgumentNullException.ThrowIfNull(row);
        ArgumentNullException.ThrowIfNull(dispatchRows);
        var dispatches = dispatchRows.Select(d => new DispatchDto(d.Qty, d.GatePass, d.DispatchDate, d.DateText)).ToList();
        var nag = row.Than + row.Tp;
        var available = nag + row.TwoPart;
        var dispatched = dispatches.Sum(d => d.Qty);
        var allZero = AllZeroSlip.Is(row.Than, row.Tp, row.TwoPart, dispatches.Count);
        EntryStatus status;
        if (allZero) status = EntryStatus.AllZero;
        else if (dispatched > available) status = EntryStatus.Over;
        else if (available > 0 && dispatched == 0) status = EntryStatus.Pending;
        else if (available > dispatched) status = EntryStatus.Partial;
        else status = EntryStatus.Done;

        var warnings = new List<string>();
        // A repair is not charged, so it needs no finish to find a rate.
        if (!allZero && !row.Repair && string.IsNullOrWhiteSpace(row.Finish)) warnings.Add("Finish is missing.");
        if (!allZero && nag <= 0) warnings.Add("THAN + TP is 0.");
        if (!row.Repair && RepairMark.In(row.LotNo, row.DesignNo)) warnings.Add(MarkedButCharged);
        if (row.InwardNo == 0) warnings.Add("INW. NO. is blank in the register.");
        if (status == EntryStatus.Over) warnings.Add($"Dispatched ({dispatched}) is more than NAG + TWO PART ({available}).");
        if (row.ShortThan is { } shortThan && shortThan > row.Than) warnings.Add($"SHORT THAN ({shortThan}) is more than THAN ({row.Than}).");
        if (!row.CarriedOver && duplicateNumber) warnings.Add($"Inward number {row.InwardNo} is used more than once this month.");
        var entryDate = Dates.ParseIsoOrDefault(row.EntryDate);
        for (var i = 0; i < dispatches.Count; i++)
        {
            var d = dispatches[i];
            if (d.Date is null) warnings.Add($"Dispatch {i + 1} date is not a valid date (\"{d.DateText}\").");
            else if (Dates.TryParseIso(d.Date, out var dispatchDate) && dispatchDate < entryDate)
                warnings.Add($"Dispatch {i + 1} date ({d.Date}) is before the inward date.");
        }

        var billedIn = row.Bill ?? (row.Elsewhere is null ? null : $"Billed outside app: {row.Elsewhere}");
        return new EntryDto(row.Id, row.RegisterMonth, row.InwardNo, row.EntryDate, row.Party, row.DesignNo, row.LotNo, row.Repair,
            row.Than, row.Tp, nag, row.Finish, row.Repair ? 0 : row.Than, row.TwoPart, row.ShortThan, row.CarriedOver,
            row.ImportBatchId is not null, row.SourceRow, dispatches, dispatched, available - dispatched, status, warnings, billedIn, noBillNeeded,
            lastImport is null ? null : new ImportMarkDto(lastImport.Action, lastImport.FileName, lastImport.ImportedAt, lastImport.RegisterMonth, lastImport.Changes));
    }
}
