using System.Text.Json;
using FluentValidation;
using MPHRegister.Contracts.Entries;
using MPHRegister.Data.Config;
using MPHRegister.Data.Database;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Services.Arrivals;
using MPHRegister.Services.Interfaces;
using MPHRegister.Services.Validators;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Exceptions;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Entries;

public sealed class EntryService(
    IDbSession session,
    IEntryRepository entries,
    IConfigStore config,
    IEntryReader reader,
    IEntryLinker entryLinks,
    IValidator<EntryInput> validator,
    ArrivalLinker linker,
    TimeProvider clock) : IEntryService
{
    public IReadOnlyList<EntryDto> List(string? month, MonthRange? months = null)
    {
        if (Dates.IsValidMonth(month)) return reader.Read(entries.List(month));
        return reader.Read(months is null ? entries.List(null) : entries.InMonths(months.From, months.To));
    }

    public IReadOnlyList<EntryDto> Recent(int? limit) =>
        reader.Read(entries.Recent(Math.Clamp(limit ?? Limits.RecentEntriesDefault, 1, Limits.RecentEntriesMax)));

    public IReadOnlyList<EntryLinkDto> LinksFor(string? month, string? party, string? designNo) =>
        Dates.IsValidMonth(month) && !string.IsNullOrWhiteSpace(party) ? entryLinks.Preview(month!, party.Trim(), designNo) : [];

    public EntryDto Get(long id) => Find(id) ?? throw new NotFoundException("Entry not found.");

    public EntryDto Create(EntryInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var (party, finish) = Validate(input, null);
        long id;
        using (var unit = session.Begin())
        {
            var now = Dates.Timestamp(clock.GetLocalNow());
            id = entries.Insert(ToEntity(0, input, party, finish, now));
            entries.ReplaceDispatches(id, Dispatches(input));
            CommitWithArrivals(unit, id, [input.InwardNo!.Value], [input.EntryDate!]);
        }
        return Get(id);
    }

    public EntryDto Update(long id, EntryInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var before = entries.Get(id) ?? throw new NotFoundException("Entry not found.");
        var (party, finish) = Validate(input, id);
        using (var unit = session.Begin())
        {
            entries.Update(ToEntity(id, input, party, finish, Dates.Timestamp(clock.GetLocalNow())));
            entries.ReplaceDispatches(id, Dispatches(input));
            CommitWithArrivals(unit, id, [before.InwardNo, input.InwardNo!.Value], [before.EntryDate, input.EntryDate!]);
        }
        return Get(id);
    }

    /// <summary>
    /// Aawak rows that name the entry's slip number around its date (typed before the slip) link to it now, in the same commit
    /// as the save (one flush on Windows instead of two). Should linking fail, the save is still committed, as when they were
    /// two commits, and the error goes on.
    /// </summary>
    private void CommitWithArrivals(IUnitOfWork unit, long id, int[] numbers, string[] dates)
    {
        const string Savepoint = "link_arrivals";
        var transaction = session.Transaction ?? throw new InvalidOperationException("Linking needs the save's transaction.");
        transaction.Save(Savepoint);
        var linked = false;
        try
        {
            var ordered = dates.Order(StringComparer.Ordinal).ToList();
            linker.LinkAround([id], numbers, ordered[0], ordered[^1]);
            linked = true;
        }
        finally
        {
            if (linked) transaction.Release(Savepoint);
            else transaction.Rollback(Savepoint);
            unit.Commit();
        }
    }

    public DeleteEntryResult Delete(long id)
    {
        using var unit = session.Begin();
        var entry = entries.Get(id) ?? throw new NotFoundException("Entry not found.");
        if (entry.Bill is not null)
            throw new AppValidationException($"{Slip(entry)} is on bill {entry.Bill}. Take it off that bill (or cancel the bill) before deleting the entry.");
        if (entry.Elsewhere is not null)
            throw new AppValidationException($"{Slip(entry)} is marked as billed outside the app. Undo that mark before deleting the entry.");
        var cancelled = entries.CancelledBillsWith(id);
        entries.MoveToDeleted(id, Dates.Timestamp(clock.GetLocalNow()));
        var deleted = entries.GetDeleted(id)!;
        unit.Commit();
        var notes = new List<string>();
        if (cancelled.Count > 0)
            notes.Add($"Cancelled bill {string.Join(", ", cancelled)} lists this entry; that bill cannot be restored while the entry is deleted.");
        if (entry.ImportBatchId is not null)
            notes.Add("This entry came from an Excel workbook. Importing a newer copy of that workbook keeps it deleted.");
        return new DeleteEntryResult(ToDto(deleted), notes);
    }

    public IReadOnlyList<DeletedEntryDto> Deleted() => entries.Deleted().Select(ToDto).ToList();

    public PurgeDeletedResult PurgeDeleted()
    {
        using var unit = session.Begin();
        var removed = entries.PurgeDeleted();
        unit.Commit();
        return new PurgeDeletedResult(removed);
    }

    public EntryDto Restore(long id)
    {
        using (var unit = session.Begin())
        {
            var deleted = entries.GetDeleted(id) ?? throw new NotFoundException("Deleted entry not found. It may have been restored already.");
            var check = RestoreCheck(deleted);
            if (!check.Allowed) throw new AppValidationException(check.Clashes);
            entries.RestoreDeleted(id);
            var restored = entries.Get(id)!;
            CommitWithArrivals(unit, id, [restored.InwardNo], [restored.EntryDate]);
        }
        return Get(id);
    }

    /// <summary>
    /// What stops a deleted entry from going back: its INW. NO. or its slip is in use again (typed or imported after the
    /// delete), or its party or finish is no longer in the lists. Entries that only look the same are warnings.
    /// </summary>
    private EntryRestoreCheck RestoreCheck(DeletedEntryEntity deleted)
    {
        var clashes = new List<string>();
        var warnings = new List<string>();
        if (entries.Get(deleted.Id) is not null) clashes.Add("This entry is already in the register.");
        var index = ConfigIndex.For(config.Current);
        if (index.Party(deleted.Party) is null)
            clashes.Add($"Party \"{deleted.Party}\" is no longer in the party list. Add it in Masters first.");
        if (deleted.Finish.Length > 0 && index.Finish(deleted.Finish) is null)
            clashes.Add($"Finish \"{deleted.Finish}\" is no longer in the finish list. Add it in Masters first.");
        var numbered = !deleted.CarriedOver && deleted.InwardNo > 0;
        var taken = entries.SameSlip(deleted.RegisterMonth, deleted.InwardNo, deleted.EntryDate, deleted.Party, numbered)
            .Where(e => e.Id != deleted.Id).ToList();
        foreach (var other in taken)
        {
            var sameSlip = other.InwardNo == deleted.InwardNo && other.EntryDate == deleted.EntryDate
                && string.Equals(other.Party, deleted.Party, StringComparison.OrdinalIgnoreCase);
            clashes.Add(sameSlip
                ? $"The same slip is in the register again: {Slip(other)} in the {other.RegisterMonth} register."
                : $"INW. NO. {deleted.InwardNo} of the {deleted.RegisterMonth} register is now used by {Slip(other)}.");
        }
        var seen = taken.Select(e => e.Id).ToHashSet();
        foreach (var other in entries.SameContent(deleted.RegisterMonth, deleted.EntryDate, deleted.Party, deleted.DesignNo, deleted.LotNo, deleted.Than)
            .Where(e => e.Id != deleted.Id && !seen.Contains(e.Id)))
        {
            warnings.Add($"{Slip(other)} has the same date, party, D.N., LOT N. and THAN. Check that it is not this slip entered again.");
        }
        return new EntryRestoreCheck(clashes.Count == 0, clashes, warnings);
    }

    private DeletedEntryDto ToDto(DeletedEntryEntity d) => new(
        d.Id, d.RegisterMonth, d.InwardNo, d.EntryDate, d.Party, d.DesignNo, d.LotNo, d.Repair, d.Than, d.Tp, d.TwoPart, d.Finish,
        d.CarriedOver, d.ImportBatchId is not null, DispatchCount(d.Dispatches), d.DeletedAt, RestoreCheck(d));

    private static int DispatchCount(string json)
    {
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
        return doc.RootElement.ValueKind == JsonValueKind.Array ? doc.RootElement.GetArrayLength() : 0;
    }

    private static string Slip(EntryEntity entry) => $"INW. NO. {entry.InwardNo} of {entry.EntryDate} ({entry.Party})";

    public IReadOnlyList<EntryDto> PartyWise(string? month, string? party, MonthRange? months = null)
    {
        IEnumerable<EntryDto> list = List(month, months);
        if (!string.IsNullOrWhiteSpace(party))
            list = list.Where(e => string.Equals(e.Party, party.NormalizeName(), StringComparison.OrdinalIgnoreCase));
        return list
            .OrderBy(e => e.Party, StringComparer.OrdinalIgnoreCase)
            .ThenBy(e => e.Status == EntryStatus.AllZero)
            .ThenBy(e => e.Finish, StringComparer.OrdinalIgnoreCase)
            .ThenBy(e => e.DesignNo, StringComparer.OrdinalIgnoreCase)
            .ThenBy(e => e.EntryDate, StringComparer.Ordinal)
            .ThenBy(e => e.Id)
            .ToList();
    }

    public IReadOnlyList<MonthSummary> Months() => entries.Months().Select(m => new MonthSummary(m.RegisterMonth, m.Entries)).ToList();

    public NextInwardDto NextInward(string? month)
    {
        var target = Dates.IsValidMonth(month) ? month! : Dates.Month(Dates.Today(clock));
        return new NextInwardDto(target, entries.NextInwardNumber(target));
    }

    private EntryDto? Find(long id) => entries.Get(id) is { } row ? reader.Read([row])[0] : null;

    private (string Party, string Finish) Validate(EntryInput input, long? editingId)
    {
        var errors = validator.ErrorsFor(input);
        var index = ConfigIndex.For(config.Current);
        var party = index.Party(input.Party)?.Name;
        var finish = index.Finish(input.Finish)?.Name;
        if (!string.IsNullOrWhiteSpace(input.Party) && party is null) errors.Add($"Party \"{input.Party.Trim()}\" is not in the party list.");
        if (!string.IsNullOrWhiteSpace(input.Finish) && finish is null) errors.Add($"Finish \"{input.Finish.Trim()}\" is not in the finish list.");
        var carried = editingId is { } id && entries.IsCarriedOver(id);
        if (Dates.IsValidMonth(input.RegisterMonth) && input.InwardNo is >= 1 && !carried
            && entries.InwardNumberOwner(input.RegisterMonth!, input.InwardNo.Value, editingId) is { } other)
        {
            errors.Add($"Inward number {input.InwardNo} is already used this month (by {other}).");
        }
        if (errors.Count > 0) throw new AppValidationException(errors);
        // Only an all-zero slip or a repair may leave the finish blank (the validator checks that).
        return (party!, finish ?? string.Empty);
    }

    private static EntryEntity ToEntity(long id, EntryInput input, string party, string finish, string now) => new()
    {
        Id = id,
        RegisterMonth = input.RegisterMonth!,
        InwardNo = input.InwardNo!.Value,
        EntryDate = input.EntryDate!,
        Party = party,
        DesignNo = (input.DesignNo ?? string.Empty).Trim(),
        LotNo = (input.LotNo ?? string.Empty).Trim(),
        Repair = input.Repair,
        Than = input.Than ?? 0,
        Tp = input.Tp ?? 0,
        TwoPart = input.TwoPart ?? 0,
        Finish = finish,
        ShortThan = input.ShortThan,
        CreatedAt = now,
        UpdatedAt = now,
    };

    private static List<DispatchEntity> Dispatches(EntryInput input) => (input.Dispatches ?? [])
        .Select(d => new DispatchEntity { Qty = d.Qty!.Value, GatePass = d.GatePass!.Trim(), DispatchDate = d.Date })
        .ToList();
}
