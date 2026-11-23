using System.Globalization;
using FluentValidation;
using MPHRegister.Contracts.Arrivals;
using MPHRegister.Data.Config;
using MPHRegister.Data.Database;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Services.Interfaces;
using MPHRegister.Services.Validators;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Exceptions;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Arrivals;

public sealed class ArrivalService(
    IDbSession session,
    IArrivalRepository arrivals,
    IConfigStore config,
    ArrivalReader reader,
    ArrivalLinker linker,
    IValidator<ArrivalInput> validator,
    TimeProvider clock) : IArrivalService
{
    public IReadOnlyList<ArrivalDto> List(string? month) => reader.Read(arrivals.List(Dates.IsValidMonth(month) ? month : null));

    public IReadOnlyList<ArrivalDto> Recent(int? limit) =>
        reader.Read(arrivals.Recent(Math.Clamp(limit ?? Limits.RecentEntriesDefault, 1, Limits.RecentEntriesMax)));

    public ArrivalDto Get(long id) => reader.Read(arrivals.Get(id)) ?? throw new NotFoundException("Aawak row not found.");

    public ArrivalDto Create(ArrivalInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        using var unit = session.Begin();
        var arrival = Validate(input, null);
        var now = Now();
        var id = arrivals.Insert(arrival with { CreatedAt = now, UpdatedAt = now });
        linker.Link(arrivals.Get(id)!);
        unit.Commit();
        return Get(id);
    }

    public ArrivalDto Update(long id, ArrivalInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        using var unit = session.Begin();
        var existing = arrivals.Get(id) ?? throw new NotFoundException("Aawak row not found.");
        var arrival = Validate(input, existing);
        arrivals.Update(arrival with { Id = id, UpdatedAt = Now() });
        linker.Link(arrivals.Get(id)!);
        unit.Commit();
        return Get(id);
    }

    public DeleteArrivalResult Delete(long id)
    {
        using var unit = session.Begin();
        var arrival = arrivals.Get(id) ?? throw new NotFoundException("Aawak row not found.");
        var linked = arrivals.Links([id]).Select(l => l.EntryId).ToList();
        arrivals.MoveToDeleted(id, Now());
        linker.Shares(linked);
        var deleted = arrivals.GetDeleted(id)!;
        unit.Commit();
        var notes = new List<string>();
        if (arrival.ImportBatchId is not null) notes.Add("This row came from an Aawak workbook. Importing a newer copy of that workbook keeps it deleted.");
        return new DeleteArrivalResult(ToDto(deleted), notes);
    }

    public IReadOnlyList<DeletedArrivalDto> Deleted() => arrivals.Deleted().Select(ToDto).ToList();

    public ArrivalDto Restore(long id)
    {
        using (var unit = session.Begin())
        {
            var deleted = arrivals.GetDeleted(id) ?? throw new NotFoundException("Deleted Aawak row not found. It may have been restored already.");
            var problems = RestoreProblems(deleted);
            if (problems.Count > 0) throw new AppValidationException(problems);
            arrivals.RestoreDeleted(id);
            linker.Link(arrivals.Get(id)!);
            unit.Commit();
        }
        return Get(id);
    }

    public IReadOnlyList<AawakMonthDto> Months() => arrivals.Months().Select(m => new AawakMonthDto(m.AawakMonth, m.Arrivals)).ToList();

    public NextAawakDto Next(string? month)
    {
        var target = Dates.IsValidMonth(month) ? month! : Dates.Month(Dates.Today(clock));
        return new NextAawakDto(target, arrivals.NextNumber(target));
    }

    public SlipPreviewDto Preview(string? date, string? party, int? nag, string? inward, long? arrivalId)
    {
        var index = ConfigIndex.For(config.Current);
        var partyName = index.Party(party)?.Name ?? party.NormalizeName();
        var day = Dates.TryParseIso(date, out var parsed) ? Dates.Iso(parsed) : Dates.Iso(Dates.Today(clock));
        var covered = new HashSet<int>();
        var coveredNag = 0;
        var manual = new List<ArrivalSlipDto>();
        if (arrivalId is { } id)
        {
            var links = arrivals.Links([id]).Where(l => l.How == ArrivalLinkHow.Manual).ToList();
            foreach (var slip in arrivals.SlipsByIds(links.Select(l => l.EntryId).ToList()).Where(s => !s.Deleted))
            {
                var share = links.First(l => l.EntryId == slip.Id).Nag;
                manual.Add(ArrivalReader.Slip(slip, share, true, partyName, index));
                covered.Add(slip.InwardNo);
                coveredNag += share ?? slip.Nag;
            }
        }
        var plan = linker.PlanFor(day, partyName, nag ?? 0, inward ?? string.Empty, arrivalId ?? 0, covered, coveredNag);
        var found = manual.Concat(plan.Found.Select(s => ArrivalReader.Slip(s, null, false, partyName, index))).OrderBy(s => s.InwardNo).ToList();
        var choices = plan.Choices.Select(c => new SlipChoiceDto(c.InwardNo, c.Entries.Select(s => ArrivalReader.Slip(s, null, false, partyName, index)).ToList())).ToList();
        var suggestion = plan.Reading > 0 && plan.SlipsNag == nag ? InwardNumbers.Format(plan.Numbers) : null;
        return new SlipPreviewDto(plan.Numbers, found, plan.Missing, choices, plan.SlipsNag,
            ArrivalReader.Status(nag ?? 0, plan.SlipsNag, found.Count, plan.Missing.Count), suggestion, partyName.Length > 0 ? index.GroupOf(partyName) : string.Empty);
    }

    public ArrivalDto AddLink(long arrivalId, ArrivalLinkInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        using var unit = session.Begin();
        var arrival = arrivals.Get(arrivalId) ?? throw new NotFoundException("Aawak row not found.");
        var slip = arrivals.SlipsByIds([input.EntryId]).FirstOrDefault(s => !s.Deleted) ?? throw new NotFoundException("Inward entry not found.");
        if (input.Nag is { } share && (share < 1 || share > slip.Nag))
            throw new AppValidationException(string.Create(CultureInfo.InvariantCulture, $"The NAG that came on this Aawak must be from 1 to the slip's NAG ({slip.Nag})."));
        arrivals.SetLink(new ArrivalLinkEntity { ArrivalId = arrivalId, EntryId = slip.Id, Nag = input.Nag, How = ArrivalLinkHow.Manual, CreatedAt = Now() });
        linker.Link(arrival);
        unit.Commit();
        return Get(arrivalId);
    }

    public ArrivalDto RemoveLink(long arrivalId, long entryId)
    {
        using var unit = session.Begin();
        var arrival = arrivals.Get(arrivalId) ?? throw new NotFoundException("Aawak row not found.");
        var link = arrivals.Links([arrivalId]).FirstOrDefault(l => l.EntryId == entryId) ?? throw new NotFoundException("That slip is not linked to this Aawak row.");
        if (link.How != ArrivalLinkHow.Manual)
            throw new AppValidationException("This slip was linked by the number in INW NO. Change INW NO to take it off.");
        arrivals.RemoveLink(arrivalId, entryId);
        linker.Link(arrival);
        linker.Shares([entryId]);
        unit.Commit();
        return Get(arrivalId);
    }

    public IReadOnlyList<ArrivalDto> ForEntry(long entryId) =>
        reader.Read(arrivals.ByIds(arrivals.LinksOfEntries([entryId]).Select(l => l.ArrivalId).Distinct().ToList()));

    public IReadOnlyList<ArrivalCandidateDto> Candidates(string? date, string? party)
    {
        if (!Dates.TryParseIso(date, out var day) || string.IsNullOrWhiteSpace(party)) return [];
        var index = ConfigIndex.For(config.Current);
        var (from, to) = linker.Window(day, day);
        var nearby = arrivals.Between(from, to).Where(a => index.SameFamily(a.Party, party)).ToList();
        return reader.Read(nearby)
            .Where(a => a.Nag > a.SlipsNag || a.Missing.Count > 0)
            .OrderBy(a => Math.Abs(Dates.ParseIsoOrDefault(a.ArrivalDate).DayNumber - day.DayNumber)).ThenBy(a => a.AawakNo)
            .Select(a => new ArrivalCandidateDto(a.Id, a.AawakMonth, a.Number, a.ArrivalDate, a.Party, a.Transporter, a.Nag, Math.Max(a.Nag - a.SlipsNag, 0), a.InwardText))
            .ToList();
    }

    public void MarkNoArrival(long entryId, NoArrivalInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var note = (input.Note ?? string.Empty).Trim();
        if (note.Length > ArrivalInputValidator.MaxNote) throw new AppValidationException("The note is too long.");
        if (arrivals.SlipsByIds([entryId]).All(s => s.Deleted)) throw new NotFoundException("Inward entry not found.");
        arrivals.SetNoArrival(entryId, note, Now());
    }

    public void ClearNoArrival(long entryId) => arrivals.ClearNoArrival(entryId);

    public RelinkResult Relink(string? month)
    {
        using var unit = session.Begin();
        var rows = arrivals.List(Dates.IsValidMonth(month) ? month : null);
        linker.Link(rows);
        unit.Commit();
        var summary = ArrivalReader.Summary(reader.Read(rows.Select(r => arrivals.Get(r.Id)!).ToList()));
        return new RelinkResult(rows.Count, summary.Linked, summary.NagDiffers, summary.PartlyLinked, summary.NotLinked);
    }

    public ArrivalTotalsDto Totals(string? from, string? to, bool groupSisters, string? order)
    {
        var (start, end) = Period(from, to);
        return ArrivalTotals.Compute(arrivals.Between(start, end), ConfigIndex.For(config.Current), groupSisters, order, start, end);
    }

    public ArrivalStatementDto Statement(string? from, string? to, string? transporter)
    {
        var (start, end) = Period(from, to);
        var index = ConfigIndex.For(config.Current);
        var name = index.Transporter(transporter)?.Name ?? transporter.NormalizeName();
        if (name.Length == 0) throw new AppValidationException("Choose a lorry wala.");
        var rows = arrivals.Between(start, end).Where(a => string.Equals(index.Transporter(a.Transporter)?.Name ?? a.Transporter, name, StringComparison.OrdinalIgnoreCase)).ToList();
        return new ArrivalStatementDto(start, end, name, rows.Sum(a => a.Nag), reader.Read(rows));
    }

    public ArrivalCheckDto Check(string? from, string? to)
    {
        var (start, end) = Period(from, to);
        var list = reader.Read(arrivals.Between(start, end));
        var checkFrom = CheckSlipsFrom();
        var without = new List<SlipWithoutArrivalDto>();
        var overlinked = new List<OverlinkedSlipDto>();
        string? slipsFrom = null;
        if (checkFrom is not null) slipsFrom = string.CompareOrdinal(checkFrom, start) > 0 ? checkFrom : start;
        if (slipsFrom is not null && string.CompareOrdinal(slipsFrom, end) <= 0)
        {
            var slips = arrivals.SlipsBetween(slipsFrom, end).Where(s => s.Nag + s.TwoPart > 0).ToList();
            var links = arrivals.LinksOfEntries(slips.Select(s => s.Id).ToList()).ToLookup(l => l.EntryId);
            var marked = arrivals.NoArrival();
            without.AddRange(slips.Where(s => !links.Contains(s.Id) && !marked.ContainsKey(s.Id))
                .Select(s => new SlipWithoutArrivalDto(s.Id, s.RegisterMonth, s.InwardNo, s.EntryDate, s.Party, s.Nag)));
            var owners = arrivals.ByIds(links.SelectMany(g => g).Select(l => l.ArrivalId).Distinct().ToList()).ToDictionary(a => a.Id);
            foreach (var slip in slips.Where(s => links[s.Id].Count() > 1))
            {
                var mine = links[slip.Id].Where(l => owners.ContainsKey(l.ArrivalId)).ToList();
                var arrived = mine.Sum(l => l.Nag ?? owners[l.ArrivalId].Nag);
                if (arrived <= slip.Nag) continue;
                overlinked.Add(new OverlinkedSlipDto(slip.Id, slip.RegisterMonth, slip.InwardNo, slip.EntryDate, slip.Party, slip.Nag, arrived,
                    mine.Select(l => l.ArrivalId).ToList(), mine.Select(l => AawakNumber.Format(owners[l.ArrivalId].AawakNo, owners[l.ArrivalId].AawakSuffix)).ToList()));
            }
        }
        return new ArrivalCheckDto(start, end, checkFrom,
            list.Where(a => a.Status is ArrivalStatus.NotLinked or ArrivalStatus.PartlyLinked).ToList(),
            list.Where(a => a.Status == ArrivalStatus.NagDiffers).ToList(),
            without, overlinked);
    }

    /// <summary>Slips are checked for an Aawak row from the configured day, else from the first Aawak row; null when there is none.</summary>
    private string? CheckSlipsFrom() => config.Current.Aawak.CheckSlipsFrom ?? arrivals.EarliestDate();

    private (string From, string To) Period(string? from, string? to)
    {
        var today = Dates.Today(clock);
        var start = Dates.TryParseIso(from, out var f) ? f : new DateOnly(today.Year, today.Month, 1);
        var end = Dates.TryParseIso(to, out var t) ? t : start.AddMonths(1).AddDays(-1);
        if (end < start) throw new AppValidationException("The period ends before it starts.");
        return (Dates.Iso(start), Dates.Iso(end));
    }

    private ArrivalEntity Validate(ArrivalInput input, ArrivalEntity? existing)
    {
        var errors = validator.ErrorsFor(input);
        var index = ConfigIndex.For(config.Current);
        var party = index.Party(input.Party)?.Name;
        if (!string.IsNullOrWhiteSpace(input.Party) && party is null) errors.Add($"Party \"{input.Party.NormalizeName()}\" is not in the party list.");
        var transporter = index.Transporter(input.Transporter)?.Name;
        if (!string.IsNullOrWhiteSpace(input.Transporter) && transporter is null)
            errors.Add($"Lorry wala \"{input.Transporter.NormalizeName()}\" is not in the list. Add it in Masters → Lorry walas.");
        if (errors.Count > 0) throw new AppValidationException(errors);

        var date = Dates.ParseIsoOrDefault(input.ArrivalDate);
        var month = string.IsNullOrWhiteSpace(input.AawakMonth) ? Dates.Month(date) : input.AawakMonth.Trim();
        int number;
        string suffix;
        if (string.IsNullOrWhiteSpace(input.AawakNo))
        {
            number = existing is not null && existing.AawakMonth == month ? existing.AawakNo : arrivals.NextNumber(month);
            suffix = existing is not null && existing.AawakMonth == month ? existing.AawakSuffix : string.Empty;
        }
        else if (!AawakNumber.TryParse(input.AawakNo, out number, out suffix))
        {
            throw new AppValidationException("Aawak NO must be a number, with at most one letter after it (like 217A).");
        }
        if (arrivals.ByNumber(month, number, suffix) is { } other && other.Id != existing?.Id)
            throw new AppValidationException($"Aawak NO {AawakNumber.Format(number, suffix)} is already used in {MonthName(month)} (by {other.Party}, {other.ArrivalDate}).");

        return (existing ?? new ArrivalEntity()) with
        {
            AawakMonth = month,
            AawakNo = number,
            AawakSuffix = suffix,
            ArrivalDate = Dates.Iso(date),
            Party = party!,
            Nag = input.Nag!.Value,
            Transporter = transporter!,
            InwardText = (input.InwardText ?? string.Empty).Trim(),
            Note = (input.Note ?? string.Empty).Trim(),
        };
    }

    private List<string> RestoreProblems(DeletedArrivalEntity deleted)
    {
        var problems = new List<string>();
        if (arrivals.Get(deleted.Id) is not null) problems.Add("This Aawak row is already in the register.");
        if (arrivals.ByNumber(deleted.AawakMonth, deleted.AawakNo, deleted.AawakSuffix) is { } other)
            problems.Add($"Aawak NO {AawakNumber.Format(deleted.AawakNo, deleted.AawakSuffix)} of {MonthName(deleted.AawakMonth)} is now used by {other.Party} ({other.ArrivalDate}).");
        var index = ConfigIndex.For(config.Current);
        if (index.Party(deleted.Party) is null) problems.Add($"Party \"{deleted.Party}\" is no longer in the party list. Add it in Masters first.");
        if (index.Transporter(deleted.Transporter) is null) problems.Add($"Lorry wala \"{deleted.Transporter}\" is no longer in the list. Add it in Masters first.");
        return problems;
    }

    private DeletedArrivalDto ToDto(DeletedArrivalEntity d)
    {
        var problems = RestoreProblems(d);
        return new DeletedArrivalDto(d.Id, d.AawakMonth, AawakNumber.Format(d.AawakNo, d.AawakSuffix), d.ArrivalDate, d.Party, d.Nag, d.Transporter, d.InwardText,
            d.ImportBatchId is not null, d.DeletedAt, problems.Count == 0, problems);
    }

    private static string MonthName(string month) =>
        DateTime.TryParseExact(month, Formats.Month, CultureInfo.InvariantCulture, DateTimeStyles.None, out var m) ? m.ToString("MMM yyyy", CultureInfo.InvariantCulture) : month;

    private string Now() => Dates.Timestamp(clock.GetLocalNow());
}
