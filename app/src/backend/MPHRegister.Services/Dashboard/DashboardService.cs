using System.Globalization;
using MPHRegister.Contracts.Dashboard;
using MPHRegister.Data.Database;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Services.Billing;
using MPHRegister.Services.Interfaces;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Dashboard;

/// <summary>
/// Works the dashboard out from scratch on every call, so it always matches the register, the bills and the rates.
/// Unbilled work is valued the way the bill maker would bill it: the bill-to party's rate for the finish it is billed as,
/// less that party's discount, before GST.
/// </summary>
public sealed partial class DashboardService(IDashboardRepository data, IMasterReader masters, TimeProvider clock, IDbSession session) : IDashboardService
{
    /// <summary>Ready work waiting longer than this is called old: it may have been forgotten or billed outside the app.</summary>
    public const int OldAfterDays = 60;

    /// <summary>A party is "quiet" when it sent at most this share of its usual THAN in the last 30 days.</summary>
    public const decimal QuietShare = 0.4m;

    /// <summary>Parties sending less than this many THAN in a usual 30 days are too small to call quiet.</summary>
    public const int QuietMinimumUsualThan = 25;

    private const int RecentDays = 30;
    private const int UsualDays = 90;
    private const int MaxQuietParties = 12;
    private const int MaxRepairParties = 5;

    private static readonly (string Key, int UpTo)[] AgeBuckets = [("0-30", 30), ("31-60", 60), ("61-90", 90), ("90+", int.MaxValue)];

    public DashboardDto Get(string? fy, string? month, string? party)
    {
        var today = Dates.Today(clock);
        var currentFy = FinancialYear.Of(today);
        var asOf = Dates.Iso(today);
        var requested = party.NormalizeName();
        bool Matches(string name) => string.Equals(requested, name.NormalizeName(), StringComparison.OrdinalIgnoreCase);
        var (years, allBills, priorBills, allEntries, billDates, recentBills, finishRows) = Snapshot(() =>
        {
            var years = Years(data.EarliestDate(), today);
            var (start, end, through) = Span(fy is not null && years.Contains(fy) ? fy : currentFy, currentFy, today);
            var bills = data.Bills(Dates.Iso(start), Dates.Iso(through));
            return (years, bills, data.Bills(Dates.Iso(start.AddYears(-1)), Dates.Iso(end.AddYears(-1))), data.Entries(asOf), data.LatestBillDates(asOf),
                data.Bills(Dates.Iso(today.AddYears(-1)), asOf),
                data.Finishes(Dates.Iso(start), Dates.Iso(through), requested.Length == 0 ? null : bills.Where(b => Matches(b.Party)).Select(b => b.Party).Distinct().ToList()));
        });
        var chosenFy = fy is not null && years.Contains(fy) ? fy : currentFy;
        var (start, end, _) = Span(chosenFy, currentFy, today);
        var isCurrent = chosenFy == currentFy;
        var months = Enumerable.Range(0, 12).Select(i => start.AddMonths(i))
            .Where(m => !isCurrent || m <= today)
            .Select(Dates.Month)
            .ToList();

        var lastBill = billDates.Select(b => b.LastBill).Max();
        var lastInward = allEntries.Count == 0 ? null : allEntries[^1].EntryDate;
        var config = masters.Config;
        var partyOptions = config.Parties.Select(p => p.Name).Concat(allEntries.Select(e => e.Party)).Concat(billDates.Select(b => b.Party))
            .Select(p => p.NormalizeName()).Where(p => p.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.OrdinalIgnoreCase).ToList();
        var chosenParty = requested.Length == 0 ? null : partyOptions.Find(Matches) ?? requested;
        var bills = chosenParty is null ? allBills : allBills.Where(b => Matches(b.Party)).ToList();
        var lastYearBills = chosenParty is null ? priorBills : priorBills.Where(b => Matches(b.Party)).ToList();
        var entries = chosenParty is null ? allEntries : allEntries.Where(e => Matches(e.Party)).ToList();
        var scopedLastBill = chosenParty is null ? lastBill : billDates.Where(b => Matches(b.Party)).Select(b => b.LastBill).Max();
        var valuer = new Valuer(masters, recentBills);

        var chosenMonth = month is not null && months.Contains(month) ? month : DefaultMonth(months, allBills, isCurrent, today);
        var monthly = Monthly(months, bills, lastYearBills, entries);
        var completed = isCurrent ? CompletedMonths(monthly, today) : null;
        var year = YearOf(bills, completed);
        var overall = chosenParty is null ? null : new DashboardOverall(
            allBills.Where(b => b.BillDate.StartsWith(chosenMonth, StringComparison.Ordinal)).Sum(b => b.Taxable),
            allBills.Sum(b => b.Taxable), allBills.Sum(b => b.Than), lastInward);

        var (unbilled, unbilledParties, review) = Unbilled(entries, valuer, today, scopedLastBill);
        return new DashboardDto(
            asOf,
            chosenFy,
            years,
            chosenMonth,
            months,
            year,
            Compare(completed ?? monthly, lastYearBills),
            monthly,
            unbilled,
            unbilledParties,
            PartiesOf(bills, overall?.YearTaxable ?? year.Taxable),
            FinishesOf(finishRows),
            Quiet(entries, today, lastInward),
            RepairsOf(entries, start, end),
            ThisMonth(entries, allEntries, valuer, today, lastInward),
            new DashboardCoverage(entries.Count == 0 ? null : entries[^1].EntryDate, entries.Max(e => e.LastValidDispatch), scopedLastBill),
            Stock(entries, valuer),
            review,
            chosenParty,
            partyOptions,
            overall);
    }

    /// <summary>
    /// The SELECTs run in one read transaction, so they see one moment of the data, and it ends before the figures are worked
    /// out: a save waiting for the read lock (and every reader queued behind it) waits only for the reading.
    /// </summary>
    private T Snapshot<T>(Func<T> read)
    {
        using var snapshot = session.Begin(deferred: true);
        return read();
    }

    /// <summary>The financial year's first and last day, and the day its bills are counted up to (today for this year).</summary>
    private static (DateOnly Start, DateOnly End, DateOnly Through) Span(string fy, string currentFy, DateOnly today)
    {
        var start = YearStart(fy);
        var end = start.AddYears(1).AddDays(-1);
        return (start, end, fy == currentFy ? today : end);
    }

    /// <summary>Every financial year from the first bill or entry up to today, newest first.</summary>
    private static List<string> Years(string? earliestDate, DateOnly today)
    {
        var first = Dates.TryParseIso(earliestDate, out var f) && f < today ? f : today;
        var years = new List<string>();
        for (var year = YearStart(FinancialYear.Of(first)); year <= today; year = year.AddYears(1)) years.Add(FinancialYear.Of(year));
        years.Reverse();
        return years;
    }

    private static DateOnly YearStart(string fy) => new(2000 + int.Parse(fy[..2], CultureInfo.InvariantCulture), 4, 1);

    /// <summary>Bills are made at the end of the month, so the last finished month is the one worth looking at.</summary>
    private static string DefaultMonth(List<string> months, IReadOnlyList<DashboardBillRow> bills, bool isCurrent, DateOnly today)
    {
        if (isCurrent)
        {
            var previous = Dates.Month(today.AddMonths(-1));
            return months.Contains(previous) ? previous : months[^1];
        }
        return months.LastOrDefault(m => bills.Any(b => b.BillDate.StartsWith(m, StringComparison.Ordinal))) ?? months[^1];
    }

    private static List<MonthFigures> Monthly(List<string> months, IReadOnlyList<DashboardBillRow> bills, IReadOnlyList<DashboardBillRow> lastYear, IReadOnlyList<DashboardEntryRow> entries)
    {
        var byMonth = bills.ToLookup(b => b.BillDate[..7]);
        var lastByMonth = lastYear.GroupBy(b => b.BillDate[..7]).ToDictionary(g => g.Key, g => g.Sum(b => b.Taxable));
        var inward = entries.Where(e => e.EntryDate.Length >= 7).ToLookup(e => e.EntryDate[..7]);
        return months.Select(m =>
        {
            var list = byMonth[m].ToList();
            var start = YearMonth(m);
            var sameLastYear = Dates.Month(start.AddYears(-1));
            var received = inward[m].ToList();
            return new MonthFigures(m, list.Count, list.Sum(b => b.Than), list.Sum(b => b.Gross), list.Sum(b => b.Discount), list.Sum(b => b.Taxable),
                list.Sum(b => b.Cgst), list.Sum(b => b.Sgst), list.Sum(b => b.Igst), list.Sum(b => b.Total),
                received.Count, received.Sum(e => e.Than), lastByMonth.GetValueOrDefault(sameLastYear));
        }).ToList();
    }

    /// <summary>This year's income in the given whole months against the same months a year before.</summary>
    private static YearComparison? Compare(List<MonthFigures> months, IReadOnlyList<DashboardBillRow> previousBills)
    {
        var previousMonths = previousBills.Select(b => b.BillDate[..7]).ToHashSet(StringComparer.Ordinal);
        if (months.Count == 0 || months.Any(m => m.Bills == 0 || !previousMonths.Contains(Dates.Month(YearMonth(m.Month).AddYears(-1))))) return null;
        var lastYear = months.Sum(m => m.LastYearTaxable);
        return lastYear == 0 ? null : new YearComparison(months[0].Month, months[^1].Month, months.Sum(m => m.Taxable), lastYear);
    }

    private static DateOnly YearMonth(string month) => DateOnly.ParseExact(month + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>Months of the current year that are over (bills for them are made).</summary>
    private static List<MonthFigures> CompletedMonths(List<MonthFigures> monthly, DateOnly today)
    {
        var current = Dates.Month(today);
        return monthly.Where(m => string.CompareOrdinal(m.Month, current) < 0).ToList();
    }

    /// <param name="completed">Finished months of the current year, used for the projection; null when the year is over.</param>
    private static YearFigures YearOf(IReadOnlyList<DashboardBillRow> bills, List<MonthFigures>? completed)
    {
        var taxable = bills.Sum(b => b.Taxable);
        var monthsWithBills = bills.Select(b => b.BillDate[..7]).Distinct().Count();
        var projected = taxable;
        if (completed is not null)
        {
            projected = completed.Count == 0 || completed.Any(m => m.Bills == 0)
                ? 0
                : Money.RoundRupee(completed.Sum(m => m.Taxable) / (decimal)completed.Count * 12);
        }
        return new YearFigures(bills.Count, bills.Select(b => b.Party.NormalizeName().ToUpperInvariant()).Distinct().Count(), bills.Sum(b => b.Than),
            bills.Sum(b => b.Gross), bills.Sum(b => b.Discount), taxable, bills.Sum(b => b.Cgst + b.Sgst + b.Igst), bills.Sum(b => b.Total),
            monthsWithBills, projected);
    }

    private sealed record OpenWork(DashboardEntryRow Entry, string Party, long Value, bool Exact, bool Ready, int Age,
        bool EarlierInward, bool DispatchIssue, bool BeforeDispatch);

    /// <summary>Work with no bill link that should be billed, valued the way the bill maker would bill it.</summary>
    /// <param name="lastBill">Entries dated on or before it are flagged as earlier inward.</param>
    private static List<OpenWork> OpenWorkOf(IReadOnlyList<DashboardEntryRow> entries, Valuer valuer, DateOnly today, string? lastBill) =>
        entries.Where(e => !e.Billed && !e.Repair && e.Than > 0 && !valuer.BillParty(e.Party).NoBill).Select(e =>
        {
            var party = valuer.BillParty(e.Party);
            var (value, exact) = valuer.Value(party, e.Finish, e.Than);
            var ready = e.Dispatched > 0 || party.BillBeforeDispatch;
            var since = Waiting(e);
            var age = since == default ? 0 : Math.Max(0, today.DayNumber - since.DayNumber);
            return new OpenWork(e, party.Name, value, exact, ready, age,
                lastBill is not null && string.CompareOrdinal(e.EntryDate, lastBill) <= 0,
                e.Dispatched > 0 && (e.DispatchDateIssue || e.Dispatched != Available(e)), e.Dispatched == 0 && party.BillBeforeDispatch);
        }).ToList();

    /// <summary>Ready work by days waiting, in <see cref="AgeBuckets"/> order.</summary>
    private static List<(string Key, List<OpenWork> Work)> Ageing(List<OpenWork> ready)
    {
        var lower = 0;
        return AgeBuckets.Select(bucket =>
        {
            var from = lower;
            lower = bucket.UpTo == int.MaxValue ? int.MaxValue : bucket.UpTo + 1;
            return (bucket.Key, ready.Where(o => o.Age >= from && o.Age <= bucket.UpTo).ToList());
        }).ToList();
    }

    private static (UnbilledFigures, List<UnbilledParty>, BillingReview) Unbilled(
        IReadOnlyList<DashboardEntryRow> entries, Valuer valuer, DateOnly today, string? lastBill)
    {
        var open = OpenWorkOf(entries, valuer, today, lastBill);
        var ready = open.Where(o => o.Ready).ToList();
        var factory = open.Where(o => !o.Ready).ToList();
        var old = ready.Where(o => o.Age > OldAfterDays).ToList();
        var noRate = open.Where(o => !o.Exact).ToList();
        var ageing = Ageing(ready).Select(b => new AgeBucket(b.Key, b.Work.Count, b.Work.Sum(o => o.Entry.Than), b.Work.Sum(o => o.Value))).ToList();
        var figures = new UnbilledFigures(
            ready.Count, ready.Sum(o => o.Entry.Than), ready.Sum(o => o.Value),
            factory.Count, factory.Sum(o => o.Entry.Than), factory.Sum(o => o.Value),
            noRate.Count, noRate.Sum(o => o.Entry.Than),
            old.Count, old.Sum(o => o.Value),
            ready.Count == 0 ? null : ready.Min(o => o.Entry.EntryDate),
            ageing,
            OldAfterDays);
        var parties = open.GroupBy(o => o.Party, StringComparer.OrdinalIgnoreCase).Select(g =>
        {
            var r = g.Where(o => o.Ready).ToList();
            var f = g.Where(o => !o.Ready).ToList();
            return new UnbilledParty(g.Key, r.Count, r.Sum(o => o.Entry.Than), r.Sum(o => o.Value), g.Count(o => !o.Exact),
                r.Count == 0 ? string.Empty : r.Min(o => o.Entry.EntryDate) ?? string.Empty, r.Count == 0 ? 0 : r.Max(o => o.Age),
                f.Sum(o => o.Entry.Than), f.Sum(o => o.Value))
            {
                EarlierInwardEntries = r.Count(o => o.EarlierInward),
                DispatchIssueEntries = r.Count(o => o.DispatchIssue),
                ReadyNoRateEntries = r.Count(o => !o.Exact),
            };
        })
        .OrderByDescending(p => p.Value).ThenByDescending(p => p.Than).ThenByDescending(p => p.FactoryValue).ThenBy(p => p.Party, StringComparer.OrdinalIgnoreCase)
        .ToList();
        return (figures, parties, new BillingReview(
            Estimate(ready.Where(o => o.EarlierInward)),
            Estimate(ready.Where(o => !o.Exact)),
            Estimate(ready.Where(o => o.DispatchIssue)),
            Estimate(ready.Where(o => o.BeforeDispatch))));
    }

    private static WorkEstimate Estimate(IEnumerable<OpenWork> work)
    {
        var rows = work.ToList();
        return new WorkEstimate(rows.Count, rows.Sum(o => o.Entry.Than), rows.Sum(o => o.Value));
    }

    private static int Available(DashboardEntryRow entry) => entry.Than + entry.Tp + entry.TwoPart;

    private static StockFigures Stock(IReadOnlyList<DashboardEntryRow> entries, Valuer valuer)
    {
        var open = entries.Where(e => Available(e) > e.Dispatched).ToList();
        static StockBalance Balance(IEnumerable<DashboardEntryRow> rows)
        {
            var list = rows.ToList();
            return new StockBalance(list.Count, list.Sum(e => Available(e) - e.Dispatched),
                list.Where(e => e.Dispatched == 0).Sum(e => e.Than), list.Count(e => e.Dispatched > 0));
        }

        var unbilled = open.Where(e => !e.Billed && !e.Repair && !valuer.BillParty(e.Party).NoBill).ToLookup(e => valuer.BillParty(e.Party).BillBeforeDispatch);
        return new StockFigures(Balance(open), Balance(unbilled[false]), Balance(unbilled[true]),
            Balance(open.Where(e => e.Billed && !e.Repair)), Balance(open.Where(e => e.Repair)),
            Balance(open.Where(e => !e.Billed && !e.Repair && valuer.BillParty(e.Party).NoBill)));
    }

    /// <summary>Ready since the last dispatch, or the inward date when nothing was sent or the dispatch is dated before it (a typing slip).</summary>
    private static DateOnly Waiting(DashboardEntryRow e)
    {
        var received = Dates.ParseIsoOrDefault(e.EntryDate);
        return Dates.TryParseIso(e.LastValidDispatch, out var sent) ? sent : received;
    }

    private static List<PartyIncome> PartiesOf(IReadOnlyList<DashboardBillRow> bills, long yearTaxable) => bills
        .GroupBy(b => b.Party.NormalizeName(), StringComparer.OrdinalIgnoreCase)
        .Select(g =>
        {
            var gross = g.Sum(b => b.Gross);
            var discount = g.Sum(b => b.Discount);
            var taxable = g.Sum(b => b.Taxable);
            var than = g.Sum(b => b.Than);
            var latest = g.MaxBy(b => b.BillDate)!;
            return new PartyIncome(latest.PartyName.Length > 0 ? latest.PartyName : latest.Party, g.Count(), than, gross, discount, taxable,
                Percent(taxable, yearTaxable), Percent(discount, gross), than == 0 ? 0 : Math.Round((decimal)taxable / than, 2), latest.BillDate);
        })
        .OrderByDescending(p => p.Taxable).ThenBy(p => p.Party, StringComparer.OrdinalIgnoreCase)
        .ToList();

    private static List<FinishIncome> FinishesOf(IReadOnlyList<DashboardFinishRow> rows)
    {
        var total = rows.Sum(r => r.Amount);
        return rows.Where(r => r.Amount != 0 || r.Than != 0)
            .Select(r => new FinishIncome(r.Finish.Length > 0 ? r.Finish : "-", r.Than, r.Amount, Percent(r.Amount, total), r.Than == 0 ? 0 : Math.Round((decimal)r.Amount / r.Than, 2)))
            .OrderByDescending(f => f.Amount)
            .ToList();
    }

    /// <summary>
    /// Parties that sent much less cloth in the last 30 days than in their usual 30 days (the average of the 90 days before).
    /// The window ends at the last inward date, so a few days without entries in the app do not make every party look quiet.
    /// </summary>
    private List<QuietParty> Quiet(IReadOnlyList<DashboardEntryRow> entries, DateOnly today, string? lastInward, int limit = MaxQuietParties)
    {
        if (!Dates.TryParseIso(lastInward, out var anchor)) return [];
        var dated = entries.Select(e => (Entry: e, Date: Dates.ParseIsoOrDefault(e.EntryDate))).Where(x => x.Date != default && x.Date <= today).ToList();
        var recentFrom = anchor.AddDays(1 - RecentDays);
        var usualFrom = recentFrom.AddDays(-UsualDays);
        var index = ConfigIndex.For(masters.Config);
        return dated
            .GroupBy(x => index.Party(x.Entry.Party)?.Name ?? x.Entry.Party.NormalizeName(), StringComparer.OrdinalIgnoreCase)
            .Where(g => index.Party(g.Key)?.Active != false)
            .Select(g =>
            {
                var usual = (int)Math.Round(g.Where(x => x.Date >= usualFrom && x.Date < recentFrom).Sum(x => x.Entry.Than) * RecentDays / (decimal)UsualDays, MidpointRounding.AwayFromZero);
                var recent = g.Where(x => x.Date >= recentFrom).Sum(x => x.Entry.Than);
                var last = g.Max(x => x.Date);
                return new QuietParty(g.Key, usual, recent, Dates.Iso(last), today.DayNumber - last.DayNumber);
            })
            .Where(p => p.UsualThan >= QuietMinimumUsualThan && p.RecentThan <= p.UsualThan * QuietShare)
            .OrderByDescending(p => p.UsualThan - p.RecentThan).ThenBy(p => p.Party, StringComparer.OrdinalIgnoreCase)
            .Take(limit)
            .ToList();
    }

    private static RepairFigures RepairsOf(IReadOnlyList<DashboardEntryRow> entries, DateOnly start, DateOnly end)
    {
        var from = Dates.Iso(start);
        var to = Dates.Iso(end);
        var repairs = entries.Where(e => e.Repair && string.CompareOrdinal(e.EntryDate, from) >= 0 && string.CompareOrdinal(e.EntryDate, to) <= 0).ToList();
        var top = repairs.GroupBy(e => e.Party.NormalizeName(), StringComparer.OrdinalIgnoreCase)
            .Select(g => new RepairParty(g.Key, g.Count(), g.Sum(e => e.Than)))
            .OrderByDescending(p => p.Than).ThenByDescending(p => p.Entries).ThenBy(p => p.Party, StringComparer.OrdinalIgnoreCase)
            .Take(MaxRepairParties)
            .ToList();
        return new RepairFigures(repairs.Count, repairs.Sum(e => e.Than), top);
    }

    /// <summary>Cloth received this month up to the last inward date entered, against the same days of the month before.</summary>
    private static InwardNow ThisMonth(IReadOnlyList<DashboardEntryRow> entries, IReadOnlyList<DashboardEntryRow> allEntries,
        Valuer valuer, DateOnly today, string? lastInward)
    {
        var first = new DateOnly(today.Year, today.Month, 1);
        static bool Between(DashboardEntryRow e, DateOnly from, DateOnly to) =>
            string.CompareOrdinal(e.EntryDate, Dates.Iso(from)) >= 0 && string.CompareOrdinal(e.EntryDate, Dates.Iso(to)) <= 0;
        var now = entries.Where(e => Between(e, first, today)).ToList();
        if (!Dates.TryParseIso(lastInward, out var upTo) || upTo < first)
            return new InwardNow(Dates.Month(today), null, 0, 0, null, 0, 0);
        var previous = first.AddMonths(-1);
        var previousTo = previous.AddDays(upTo.Day - 1);
        int? comparison = previousTo < first && allEntries.Any(e => Between(e, previousTo, first.AddDays(-1)))
            ? entries.Where(e => Between(e, previous, previousTo)).Sum(e => e.Than)
            : null;
        var value = now.Where(e => !e.Repair && e.Than > 0).Sum(e => valuer.Value(valuer.BillParty(e.Party), e.Finish, e.Than).Value);
        return new InwardNow(Dates.Month(today), Dates.Iso(upTo), now.Count, now.Sum(e => e.Than), comparison, value,
            now.Where(e => e.Repair).Sum(e => e.Than));
    }

    private static decimal Percent(long part, long whole) => whole == 0 ? 0 : Math.Round(part * 100m / whole, 1);

    /// <summary>The bill-to party, its rates and discount, looked up once per party name.</summary>
    /// <param name="recentBills">Bills of the last 12 months: their income per THAN values work whose finish or rate is not known yet.</param>
    private sealed class Valuer(IMasterReader masters, IReadOnlyList<DashboardBillRow> recentBills)
    {
        private readonly ConfigIndex index = ConfigIndex.For(masters.Config);
        private readonly IReadOnlyDictionary<string, IReadOnlyList<string>> fallbacks = masters.FinishFallbacks();
        private readonly Dictionary<string, BillTo> cache = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, decimal> averages = recentBills
            .GroupBy(b => b.Party.NormalizeName(), StringComparer.OrdinalIgnoreCase)
            .Where(g => g.Sum(b => b.Than) > 0)
            .ToDictionary(g => g.Key, g => g.Sum(b => b.Taxable) / (decimal)g.Sum(b => b.Than), StringComparer.OrdinalIgnoreCase);
        private readonly decimal overall = recentBills.Sum(b => b.Than) is > 0 and var than ? recentBills.Sum(b => b.Taxable) / (decimal)than : 0;

        public BillTo BillParty(string party)
        {
            if (cache.TryGetValue(party, out var known)) return known;
            var bill = index.Party(party);
            var result = bill is null
                ? new BillTo(party.NormalizeName(), false, 0, null, false)
                : new BillTo(bill.Name, bill.BillBeforeDispatch, bill.DiscountPercent ?? 0, new FinishResolver(bill.BillAs, bill.Rates, fallbacks), bill.NoBillNeeded);
            cache[party] = result;
            return result;
        }

        /// <summary>
        /// THAN × the party's rate for the finish, less its discount, rounded to the rupee (Exact). Without a finish or a rate:
        /// THAN × what the party earned per THAN on its bills of the last 12 months, or the firm's average for a new party.
        /// </summary>
        public (long Value, bool Exact) Value(BillTo party, string finish, int than)
        {
            if (party.NoBill) return (0, true);
            if (party.Finishes?.Rate(party.Finishes.Resolve(finish)) is { } rate) return (Money.RoundRupee(rate * than * (100 - party.Discount) / 100), true);
            return (Money.RoundRupee(averages.GetValueOrDefault(party.Name, overall) * than), false);
        }
    }

    private sealed record BillTo(string Name, bool BillBeforeDispatch, decimal Discount, FinishResolver? Finishes, bool NoBill);
}
