using FluentValidation;
using MPHRegister.Contracts.Entries;
using MPHRegister.Data.Config;
using MPHRegister.Data.Database;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;
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
    IValidator<EntryInput> validator,
    TimeProvider clock) : IEntryService
{
    public IReadOnlyList<EntryDto> List(string? month) => reader.Read(entries.List(Dates.IsValidMonth(month) ? month : null));

    public IReadOnlyList<EntryDto> Recent(int? limit) =>
        reader.Read(entries.Recent(Math.Clamp(limit ?? Limits.RecentEntriesDefault, 1, Limits.RecentEntriesMax)));

    public EntryDto Get(long id) => Find(id) ?? throw new NotFoundException("Entry not found.");

    public EntryDto Create(EntryInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var (party, finish) = Validate(input, null);
        using var unit = session.Begin();
        var now = Dates.Timestamp(clock.GetLocalNow());
        var id = entries.Insert(ToEntity(0, input, party, finish, now));
        entries.ReplaceDispatches(id, Dispatches(input));
        unit.Commit();
        return Get(id);
    }

    public EntryDto Update(long id, EntryInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (entries.Get(id) is null) throw new NotFoundException("Entry not found.");
        var (party, finish) = Validate(input, id);
        using var unit = session.Begin();
        entries.Update(ToEntity(id, input, party, finish, Dates.Timestamp(clock.GetLocalNow())));
        entries.ReplaceDispatches(id, Dispatches(input));
        unit.Commit();
        return Get(id);
    }

    public IReadOnlyList<EntryDto> PartyWise(string? month, string? party)
    {
        IEnumerable<EntryDto> list = List(month);
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
