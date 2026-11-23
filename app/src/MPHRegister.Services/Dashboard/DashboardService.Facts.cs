using MPHRegister.Contracts.Dashboard;
using MPHRegister.Data.Entities;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Dashboard;

/// <summary>
/// The dashboard's figures per party and month, for a screen that adds up any selection by itself. Uses the same rules as
/// <see cref="Get"/>: bills up to today, unbilled work valued the way the bill maker would bill it, the same stock balances.
/// </summary>
public sealed partial class DashboardService
{
    public DashboardFactsDto Facts()
    {
        using var snapshot = session.Begin(deferred: true);
        var today = Dates.Today(clock);
        var asOf = Dates.Iso(today);
        var start = YearStart(FinancialYear.Of(Dates.TryParseIso(data.EarliestDate(), out var earliest) && earliest < today ? earliest : today));
        var months = new List<string>();
        for (var month = start; month <= today; month = month.AddMonths(1)) months.Add(Dates.Month(month));
        var monthIndex = months.Select((m, i) => (m, i)).ToDictionary(x => x.m, x => x.i, StringComparer.Ordinal);
        int? MonthOf(string date) => date.Length >= 7 && monthIndex.TryGetValue(date[..7], out var i) ? i : null;
        // The register starts at its first register month: older entries are only the unfinished work it carried in, so they are
        // not cloth received in their own month, and that work counts in the first month recorded.
        var recordedFrom = data.EarliestRegisterMonth() is { } first && monthIndex.TryGetValue(first, out var firstIndex) ? firstIndex : 0;
        int? InwardMonth(string date) => MonthOf(date) is { } i && i >= recordedFrom ? i : null;
        int OpenMonth(string date) => Math.Max(MonthOf(date) ?? 0, recordedFrom);

        var bills = data.Bills(Dates.Iso(start), asOf);
        var lines = data.FinishMonths(asOf);
        var entries = data.Entries(asOf);
        var sent = data.SentPieces(asOf);
        var billDates = data.LatestBillDates(asOf);
        var config = masters.Config;
        var index = ConfigIndex.For(config);
        var valuer = new Valuer(masters, data.Bills(Dates.Iso(today.AddYears(-1)), asOf));
        var parties = new NameIndex(config.Parties.Select(p => p.Name).Concat(entries.Select(e => e.Party)).Concat(bills.Select(b => b.Party))
            .Concat(billDates.Select(b => b.Party)).Concat(lines.Select(l => l.Party)).Concat(sent.Select(s => s.Party)));
        string FinishName(string finish) => index.Finish(finish)?.Name ?? finish;
        var finishes = new NameIndex(lines.Select(l => FinishName(l.Finish)));

        var billRows = bills
            .Select(b => (Bill: b, Month: MonthOf(b.BillDate)))
            .Where(x => x.Month is not null)
            .GroupBy(x => (Party: parties.Id(x.Bill.Party), Month: x.Month!.Value))
            .OrderBy(g => g.Key.Party).ThenBy(g => g.Key.Month)
            .Select(g => new long[]
            {
                g.Key.Party, g.Key.Month, g.Count(), g.Sum(x => x.Bill.Than), g.Sum(x => x.Bill.Gross), g.Sum(x => x.Bill.Discount),
                g.Sum(x => x.Bill.Taxable), g.Sum(x => x.Bill.Cgst), g.Sum(x => x.Bill.Sgst), g.Sum(x => x.Bill.Igst), g.Sum(x => x.Bill.Total),
            })
            .ToList();
        var finishRows = lines
            .Select(l => (Line: l, Month: MonthOf(l.Month)))
            .Where(x => x.Month is not null)
            .GroupBy(x => (Party: parties.Id(x.Line.Party), Month: x.Month!.Value, Finish: finishes.Id(FinishName(x.Line.Finish))))
            .Select(g => new long[] { g.Key.Party, g.Key.Month, g.Key.Finish, g.Sum(x => x.Line.Than), g.Sum(x => x.Line.Amount) })
            .Where(r => r[3] != 0 || r[4] != 0)
            .OrderBy(r => r[0]).ThenBy(r => r[1]).ThenBy(r => r[2])
            .ToList();

        var inward = new Dictionary<(int Party, int Month), long[]>();
        long[] InwardRow(int party, int month)
        {
            if (!inward.TryGetValue((party, month), out var row))
            {
                row = [party, month, 0, 0, 0, 0, 0, 0, 0];
                inward[(party, month)] = row;
            }
            return row;
        }
        foreach (var e in entries)
        {
            if (InwardMonth(e.EntryDate) is not { } month) continue;
            var row = InwardRow(parties.Id(e.Party), month);
            row[2]++;
            row[3] += e.Than;
            row[4] += Available(e);
            if (e.Repair)
            {
                row[5]++;
                row[6] += e.Than;
            }
            else if (e.Than > 0)
            {
                row[7] += valuer.Value(valuer.BillParty(e.Party), e.Finish, e.Than).Value;
            }
        }
        foreach (var s in sent)
        {
            if (InwardMonth(s.Month) is { } month) InwardRow(parties.Id(s.Party), month)[8] += s.Pieces;
        }

        var lastBill = billDates.Select(b => b.LastBill).Max();
        var lastInward = entries.Count == 0 ? null : entries[^1].EntryDate;
        var queue = OpenWorkOf(entries, valuer, today, lastBill)
            .GroupBy(o => (Party: parties.Id(o.Party), Month: OpenMonth(o.Entry.EntryDate)))
            .Select(g =>
            {
                var ready = g.Where(o => o.Ready).ToList();
                return new FactsUnbilled(
                    g.Key.Party,
                    g.Key.Month,
                    Estimate(ready),
                    Estimate(g.Where(o => !o.Ready)),
                    Estimate(g.Where(o => !o.Exact)),
                    Estimate(ready.Where(o => o.Age > OldAfterDays)),
                    ready.Count == 0 ? null : ready.Min(o => o.Entry.EntryDate),
                    ready.Count == 0 ? 0 : ready.Max(o => o.Age),
                    Ageing(ready).Select(b => Estimate(b.Work)).ToList(),
                    Estimate(ready.Where(o => o.EarlierInward)),
                    Estimate(ready.Where(o => !o.Exact)),
                    Estimate(ready.Where(o => o.DispatchIssue)),
                    Estimate(ready.Where(o => o.BeforeDispatch)));
            })
            .OrderBy(q => q.Party).ThenBy(q => q.Month)
            .ToList();
        var stock = entries
            .GroupBy(e => (Party: parties.Id(e.Party), Month: OpenMonth(e.EntryDate)))
            .Select(g => (g.Key.Party, g.Key.Month, Figures: Stock(g.ToList(), valuer)))
            .Where(s => s.Figures.Total.Entries > 0)
            .OrderBy(s => s.Party).ThenBy(s => s.Month)
            .Select(s => new FactsStock(s.Party, s.Month, s.Figures.Total, s.Figures.Unbilled, s.Figures.BeforeDispatch, s.Figures.Billed, s.Figures.Repairs, s.Figures.NoBill))
            .ToList();
        var quiet = Quiet(entries, today, lastInward, int.MaxValue)
            .Select(q => new FactsQuiet(parties.Id(q.Party), q.UsualThan, q.RecentThan, q.LastInward, q.DaysSinceLast))
            .ToList();

        var partyBills = billDates.GroupBy(b => parties.Id(b.Party)).ToDictionary(g => g.Key, g => g.Max(b => b.LastBill));
        var partyEntries = entries.GroupBy(e => parties.Id(e.Party)).ToDictionary(g => g.Key, g => (Inward: g.Last().EntryDate, Dispatch: g.Max(e => e.LastValidDispatch)));
        var partyList = parties.Names.Select((name, i) =>
        {
            var party = index.Party(name);
            var recorded = partyEntries.GetValueOrDefault(i);
            return new FactsParty(name, party?.SisterGroup.NormalizeName() ?? string.Empty, party?.Active ?? true, party?.NoBillNeeded ?? false,
                recorded.Inward, recorded.Dispatch, partyBills.GetValueOrDefault(i));
        }).ToList();

        return new DashboardFactsDto(
            asOf,
            months,
            partyList,
            finishes.Names,
            billRows,
            finishRows,
            [.. inward.Values.OrderBy(r => r[0]).ThenBy(r => r[1])],
            queue,
            stock,
            quiet,
            ThisMonthFacts(entries, today, lastInward, parties),
            new DashboardCoverage(lastInward, entries.Max(e => e.LastValidDispatch), lastBill),
            OldAfterDays);
    }

    private static FactsThisMonth ThisMonthFacts(IReadOnlyList<DashboardEntryRow> entries, DateOnly today, string? lastInward, NameIndex parties)
    {
        var first = new DateOnly(today.Year, today.Month, 1);
        if (!Dates.TryParseIso(lastInward, out var upTo) || upTo < first) return new FactsThisMonth(Dates.Month(today), null, false, []);
        static bool Between(DashboardEntryRow e, DateOnly from, DateOnly to) =>
            string.CompareOrdinal(e.EntryDate, Dates.Iso(from)) >= 0 && string.CompareOrdinal(e.EntryDate, Dates.Iso(to)) <= 0;
        var previous = first.AddMonths(-1);
        var previousTo = previous.AddDays(upTo.Day - 1);
        var comparable = previousTo < first && entries.Any(e => Between(e, previousTo, first.AddDays(-1)));
        var sameDays = comparable
            ? entries.Where(e => Between(e, previous, previousTo)).GroupBy(e => parties.Id(e.Party))
                .Select(g => new FactsPartyCount(g.Key, g.Count(), g.Sum(e => e.Than))).OrderBy(c => c.Party).ToList()
            : [];
        return new FactsThisMonth(Dates.Month(today), Dates.Iso(upTo), comparable, sameDays);
    }

    /// <summary>Names with case and extra spaces ignored, in alphabetical order, numbered from 0; the first spelling seen is kept.</summary>
    private sealed class NameIndex
    {
        private readonly Dictionary<string, int> ids = new(StringComparer.OrdinalIgnoreCase);

        public NameIndex(IEnumerable<string> names)
        {
            Names = names.Select(Clean).Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.OrdinalIgnoreCase).ToList();
            for (var i = 0; i < Names.Count; i++) ids[Names[i]] = i;
        }

        public List<string> Names { get; }

        public int Id(string name) => ids[Clean(name)];

        private static string Clean(string name) => name.NormalizeName() is { Length: > 0 } clean ? clean : "-";
    }
}
