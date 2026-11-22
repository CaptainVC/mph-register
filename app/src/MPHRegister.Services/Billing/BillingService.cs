using FluentValidation;
using MPHRegister.Contracts.Billing;
using MPHRegister.Contracts.Entries;
using MPHRegister.Contracts.Masters;
using MPHRegister.Contracts.Settings;
using MPHRegister.Data.Database;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Services.Interfaces;
using MPHRegister.Services.Mapping;
using MPHRegister.Services.Validators;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Exceptions;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Billing;

public sealed class BillingService(
    IDbSession session,
    IEntryRepository entries,
    IInvoiceRepository invoices,
    IBilledElsewhereRepository elsewhere,
    IMasterReader masters,
    IEntryReader reader,
    ISettingsService settings,
    IInvoiceService invoiceService,
    BillLineSizer sizer,
    IValidator<BillDates> datesValidator,
    IValidator<BillPeriod> periodValidator,
    IValidator<BillLines> linesValidator,
    IValidator<StyleInput> styleValidator,
    TimeProvider clock) : IBillingService
{
    private const int MaxNoteLength = 200;

    public IReadOnlyList<PartyToBillDto> PartiesToBill(string? from, string? to)
    {
        CheckPeriod(from, to);
        var index = ConfigIndex.For(masters.Config);
        return entries.PartiesToBill(from!, to!)
            .Where(r => index.Party(r.Party)?.NoBillNeeded != true)
            .GroupBy(r => index.Party(r.Party)?.Name ?? r.Party.NormalizeName(), StringComparer.OrdinalIgnoreCase)
            .Select(g => new PartyToBillDto(g.Key, g.Sum(r => r.Entries), g.Sum(r => r.NettThan), g.Sum(r => r.NotDispatched)))
            .OrderBy(p => p.Party, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public CandidatesDto Candidates(string? party, string? from, string? to)
    {
        CheckPeriod(from, to);
        var bill = masters.Party(party);
        if (bill is null) throw new AppValidationException($"Party \"{party}\" is not in the party list.");
        if (bill.NoBillNeeded)
            return new CandidatesDto(bill.Name, [bill.Name], bill.Style, bill.BillBeforeDispatch, bill.Discount, bill.Gstin, bill.Active,
                bill.Problems, [], masters.BillRecipients(bill.Name), NoBillNeeded: true);
        var finishes = Resolver(bill);
        var list = reader.Read(entries.UnbilledBetween([bill.Name], from!, to!)).Select(e =>
        {
            var finish = finishes.Resolve(e.Finish);
            var state = StateOf(e);
            return new CandidateDto(e.Id, e.RegisterMonth, e.InwardNo, e.EntryDate, e.Party, e.DesignNo, e.LotNo, e.Finish, finish,
                e.NettThan, e.Nag, e.Dispatched, e.Nag + e.TwoPart, state, BillItem.GatePasses(e),
                e.Dispatches.Select(d => d.Date).Where(d => d is not null).DefaultIfEmpty(null).Max(StringComparer.Ordinal), e.CarriedOver,
                bill.BillBeforeDispatch || state != DispatchState.None, finishes.Rate(finish));
        }).ToList();
        return new CandidatesDto(bill.Name, [bill.Name], bill.Style, bill.BillBeforeDispatch, bill.Discount, bill.Gstin, bill.Active,
            bill.Problems, list, masters.BillRecipients(bill.Name));
    }

    public IReadOnlyList<InvoiceDoc> Build(BillRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var bill = masters.Party(request.Party);
        if (bill is null) throw new AppValidationException($"Party \"{request.Party}\" is not in the party list.");
        if (bill.NoBillNeeded) throw new AppValidationException(NoBillMessage(bill.Name));
        if (!Dates.IsValidMonth(request.Month)) throw new AppValidationException("Choose the bill month.");
        var errors = datesValidator.ErrorsFor(new BillDates(request.BillDate, request.PeriodFrom, request.PeriodTo));
        var wanted = (request.EntryIds ?? []).ToHashSet();
        if (wanted.Count == 0) errors.Add("Tick at least one entry to bill.");
        var available = reader.Read(entries.Unbilled([bill.Name], null)).Where(e => wanted.Contains(e.Id)).ToList();
        if (available.Count != wanted.Count) errors.Add("Some ticked entries are already billed or do not belong to this party. Refresh the list.");
        var entriesFrom = request.EntriesFrom ?? request.PeriodFrom;
        var entriesTo = request.EntriesTo ?? request.PeriodTo;
        if (BillPeriodValidator.Problem(entriesFrom, entriesTo) is { } windowProblem)
        {
            if (request.EntriesFrom is not null || request.EntriesTo is not null) errors.Add(windowProblem);
        }
        else if (available.Any(e => !InPeriod(e.EntryDate, entriesFrom!, entriesTo!)))
            errors.Add("Some ticked entries have an inward date outside the bill period. Refresh the list.");
        if (errors.Count > 0) throw new AppValidationException(errors);

        var firm = settings.Snapshot();
        var finishes = Resolver(bill);
        var discount = bill.Discount ?? 0;
        var mode = TaxModes.Resolve(firm, bill.Gstin, bill.State);
        var pages = PackPages(bill, available, firm, finishes, discount, mode);
        return pages.Select(lines => BillCalculator.Complete(
            new InvoiceDoc(null, null, bill.Name, bill.Name, bill.Address, bill.State, bill.Gstin, request.BillDate!, request.PeriodFrom!,
                request.PeriodTo!, discount, mode, firm.CgstRate, firm.SgstRate, firm.IgstRate, 0, 0, 0, 0, 0, 0, 0, 0,
                InvoiceStatus.Draft, InvoiceSource.App, string.Empty, string.Empty, lines, [], firm, null, null),
            bill, available, firm, sizer)).ToList();
    }

    public int CountBills(CountBillsRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var bill = masters.Party(request.Party);
        if (bill is null) throw new AppValidationException($"Party \"{request.Party}\" is not in the party list.");
        if (bill.NoBillNeeded) throw new AppValidationException(NoBillMessage(bill.Name));
        var wanted = (request.EntryIds ?? []).ToHashSet();
        if (wanted.Count == 0) return 0;
        var available = reader.Read(entries.Unbilled([bill.Name], null)).Where(e => wanted.Contains(e.Id)).ToList();
        var firm = settings.Snapshot();
        return PackPages(bill, available, firm, Resolver(bill), bill.Discount ?? 0, TaxModes.Resolve(firm, bill.Gstin, bill.State)).Count;
    }

    private static string NoBillMessage(string party) =>
        $"{party} is marked \"No bill needed\", so no bill can be made for it. Untick it in Masters → Parties first.";

    private List<List<LineDto>> PackPages(PartyDto bill, IReadOnlyList<EntryDto> available, FirmSettings firm, FinishResolver finishes, decimal discount, TaxMode mode)
    {
        var smallest = BillCalculator.SmallestFont(firm, firm);
        return BillPacker.Pack(BillItemBuilder.Build(available, bill.Style, firm, finishes), finishes, discount, mode, firm, l => sizer.RowsFor(l, smallest));
    }

    public InvoiceDoc Recompute(InvoiceDoc doc, string? recipient = null)
    {
        ArgumentNullException.ThrowIfNull(doc);
        doc = Sanitize(doc);
        var errors = linesValidator.ErrorsFor(new BillLines(doc.Lines));
        if (errors.Count > 0) throw new AppValidationException(errors);
        var ids = doc.Lines.SelectMany(l => l.EntryIds ?? []).ToHashSet();
        var list = ids.Count == 0 ? [] : reader.Read(entries.ByIds(ids));
        var firm = settings.Snapshot();
        var party = masters.Party(doc.Party);
        if (recipient is not null)
        {
            var next = masters.Party(recipient);
            if (doc.Status != InvoiceStatus.Draft || party is null || next is null ||
                !masters.BillRecipients(party.Name).Contains(next.Name, StringComparer.OrdinalIgnoreCase))
                throw new AppValidationException("Choose a recipient from the same sister-firm group as this draft.");
            var sources = masters.BillRecipients(next.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
            if (list.Count != ids.Count || list.Any(e => !sources.Contains(e.Party.NormalizeName())))
                throw new AppValidationException("Some entries do not belong to this recipient or its sister firms.");
            var previousRates = Resolver(party);
            var nextRates = Resolver(next);
            var lines = doc.Lines.Select(l => l.Kind == LineKind.Priced && (l.Rate is null || l.Rate == previousRates.Rate(l.Finish ?? string.Empty))
                ? l with { Rate = nextRates.Rate(l.Finish ?? string.Empty) }
                : l).ToList();
            doc = WithRecipient(doc with { Lines = lines }, next, firm);
            party = next;
        }
        return BillCalculator.Complete(doc with { Firm = doc.Firm ?? firm }, party, list, firm, sizer);
    }

    public IReadOnlyList<InvoiceDoc> Save(SaveBillsRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var docs = (request.Invoices ?? []).Select(Sanitize).ToList();
        if (docs.Count == 0) throw new AppValidationException("Nothing to save.");
        using var unit = session.Begin();
        var firm = settings.Snapshot();
        var errors = new List<string>();
        var seen = new HashSet<long>();
        var prepared = new List<(int Index, InvoiceDoc Doc, PartyDto Party, string Fy, IReadOnlyList<EntryDto> Entries)>();
        for (var index = 0; index < docs.Count; index++)
        {
            var doc = docs[index];
            var label = docs.Count > 1 ? $"Bill {index + 1}: " : string.Empty;
            var party = masters.Party(doc.Party);
            if (party is null)
            {
                errors.Add($"{label}party \"{doc.Party}\" is not in the party list.");
                continue;
            }
            errors.AddRange(datesValidator.ErrorsFor(new BillDates(doc.BillDate, doc.PeriodFrom, doc.PeriodTo)).Select(e => label + e));
            var lineErrors = linesValidator.ErrorsFor(new BillLines(doc.Lines)).Select(e => label + e).ToList();
            errors.AddRange(lineErrors);
            if (lineErrors.Count == 0)
            {
                var sized = doc.Lines.Select(l => l with { Rows = sizer.RowsFor(l, BillCalculator.SmallestFont(firm, firm)) }).ToList();
                if (BillCalculator.RowsProblem(sized, firm.RowsPerInvoice, label.Length > 0 ? label : "The bill ") is { } rows) errors.Add(rows);
            }
            var ids = doc.Lines.SelectMany(l => l.EntryIds ?? []).ToList();
            if (ids.Any(id => !seen.Add(id))) errors.Add($"{label}an entry appears on more than one line or bill.");
            var unbilled = reader.Read(entries.Unbilled(masters.BillRecipients(party.Name), null)).Where(e => ids.Contains(e.Id)).ToList();
            if (unbilled.Count != ids.Distinct().Count()) errors.Add($"{label}some entries are already billed or belong to another party. Make the bills again.");
            if (Dates.TryParseIso(doc.BillDate, out var date)) prepared.Add((index, doc, party, FinancialYear.Of(date), unbilled));
        }
        var serials = request.Serials ?? [];
        var numbers = ResolveNumbers(prepared.Select(p => (p.Fy, p.Index < serials.Count ? serials[p.Index] : null)).ToList(), firm);
        for (var n = 0; n < numbers.Count; n++)
        {
            if (numbers[n].Problem is { } problem) errors.Add(docs.Count > 1 ? $"Bill {prepared[n].Index + 1}: {problem}" : problem);
        }
        if (errors.Count > 0) throw new AppValidationException(errors);

        var now = Dates.Timestamp(clock.GetLocalNow());
        var saved = new List<long>();
        for (var n = 0; n < prepared.Count; n++)
        {
            var (_, doc, party, fy, list) = prepared[n];
            var finished = BillCalculator.Complete(WithRecipient(doc, party, firm), party, list, firm, sizer);
            var (_, serial, number, _) = numbers[n];
            var id = invoices.Insert(InvoiceMapper.ToEntity(finished with { InvoiceNo = number, Status = InvoiceStatus.Saved, Source = InvoiceSource.App }, fy, serial, now));
            invoices.ReplaceLines(id, finished.Lines.Select(InvoiceMapper.ToEntity).ToList(), finished.Lines.SelectMany(l => l.EntryIds ?? []).ToList());
            settings.SetNextSerial(fy, Math.Max(settings.NextSerial(fy), serial + 1));
            saved.Add(id);
        }
        unit.Commit();
        return saved.Select(invoiceService.Get).ToList();
    }

    public IReadOnlyList<BillNumberDto> Numbers(BillNumbersRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var asks = request.Bills ?? [];
        var firm = settings.Snapshot();
        var dated = asks.Select((a, i) => (Index: i, Fy: Dates.TryParseIso(a.BillDate, out var date) ? FinancialYear.Of(date) : null, a.Serial)).ToList();
        var resolved = ResolveNumbers(dated.Where(d => d.Fy is not null).Select(d => (d.Fy!, d.Serial)).ToList(), firm);
        var next = 0;
        return dated.Select(d => d.Fy is null ? new BillNumberDto(string.Empty, 0, string.Empty, "Choose the bill date.") : resolved[next++]).ToList();
    }

    private const int MaxSerial = 999_999;

    /// <summary>
    /// Gives each bill its number: a typed number is kept if no saved bill (even a cancelled one) or other bill in this batch has it,
    /// and the rest take the next free numbers of their financial year in order.
    /// </summary>
    private List<BillNumberDto> ResolveNumbers(IReadOnlyList<(string Fy, int? Serial)> asks, FirmSettings firm)
    {
        string NumberOf(string fy, int serial) => firm.InvoicePrefix.Replace(Formats.FinancialYearPlaceholder, fy, StringComparison.OrdinalIgnoreCase) + serial;
        var result = new BillNumberDto[asks.Count];
        foreach (var year in asks.Select((a, i) => (a.Fy, a.Serial, Index: i)).GroupBy(a => a.Fy, StringComparer.Ordinal))
        {
            var typed = year.Where(a => a.Serial is not null).ToList();
            var counts = typed.GroupBy(a => a.Serial!.Value).ToDictionary(g => g.Key, g => g.Count());
            foreach (var (fy, serial, index) in typed)
            {
                var value = serial!.Value;
                var number = NumberOf(fy, value);
                string? problem = null;
                if (value is < 1 or > MaxSerial) problem = $"Bill no. must be between 1 and {MaxSerial}.";
                else if (counts[value] > 1) problem = $"Bill no. {number} is typed for more than one of these bills.";
                else if (invoices.Exists(number, fy, value)) problem = $"Bill no. {number} is already used by another bill (a cancelled bill keeps its number).";
                result[index] = new BillNumberDto(fy, value, number, problem);
            }
            var next = settings.NextSerial(year.Key);
            foreach (var (fy, _, index) in year.Where(a => a.Serial is null))
            {
                while (counts.ContainsKey(next) || invoices.Exists(NumberOf(fy, next), fy, next)) next++;
                result[index] = new BillNumberDto(fy, next, NumberOf(fy, next), null);
                next++;
            }
        }
        return [.. result];
    }

    public ElsewhereResult MarkBilledElsewhere(ElsewhereRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var ids = (request.EntryIds ?? []).Distinct().ToList();
        if (ids.Count == 0) throw new AppValidationException("Tick at least one entry.");
        var note = (request.Note ?? string.Empty).Trim();
        if (!request.Undo && note.Length == 0) note = "Billed in Excel";
        if (note.Length > MaxNoteLength) note = note[..MaxNoteLength];
        using var unit = session.Begin();
        var now = Dates.Timestamp(clock.GetLocalNow());
        var changed = ids.Sum(id => request.Undo ? elsewhere.Unmark(id) : elsewhere.Mark(id, note, now));
        unit.Commit();
        return new ElsewhereResult(changed);
    }

    /// <summary>The style's bill lines for a few sample entries, made by the real bill maker, to show what the style does.</summary>
    public IReadOnlyList<LineDto> PreviewStyle(StyleInput style)
    {
        ArgumentNullException.ThrowIfNull(style);
        var errors = styleValidator.ErrorsFor(style);
        if (errors.Count > 0) throw new AppValidationException(errors);
        var billing = new BillingStyle
        {
            Name = style.Name.NormalizeName(),
            GpnColumn = style.GpnColumn,
            DnColumn = style.DnColumn,
            LotColumn = style.LotColumn,
            Lines = style.Lines,
            Order = style.Order,
            ShowQuantityBreakdown = style.ShowQuantityBreakdown,
            CombineSmallEntries = style.CombineSmallEntries,
        };
        var firm = settings.Snapshot();
        var rules = firm with { SmallThanBelow = firm.SmallThanBelow > 0 ? firm.SmallThanBelow : 5, CombineMax = Math.Max(2, firm.CombineMax), InvoiceLimit = 0, RowsPerInvoice = Limits.MaxBillRows };
        var finishes = new FinishResolver(new Dictionary<string, string>(), new Dictionary<string, decimal> { [SampleFinish] = 100 }, new Dictionary<string, IReadOnlyList<string>>());
        var smallest = BillCalculator.SmallestFont(firm, firm);
        var pages = BillPacker.Pack(BillItemBuilder.Build(SampleEntries(), billing, rules, finishes), finishes, 0, TaxMode.Intra, rules, l => sizer.RowsFor(l, smallest));
        return BillCalculator.Totals(pages.SelectMany(p => p).ToList(), 0, TaxMode.Intra, rules).Lines.Select(l => l with { Rows = sizer.RowsFor(l, smallest) }).ToList();
    }

    public static DispatchState StateOf(EntryDto entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        if (entry.Dispatched == 0) return DispatchState.None;
        return entry.Dispatched >= entry.Nag + entry.TwoPart ? DispatchState.Full : DispatchState.Partial;
    }

    private const string SampleFinish = "FINISH";

    private static List<EntryDto> SampleEntries()
    {
        static EntryDto Sample(long id, int inward, string date, string dn, string lot, int than, string gatePass) =>
            new(id, "2000-01", inward, date, "SAMPLE", dn, lot, false, than, 0, than, SampleFinish, than, 0, null, false, false, null,
                [new DispatchDto(than, gatePass, date, null)], than, 0, EntryStatus.Done, [], null);
        return
        [
            Sample(1, 101, "2000-01-03", "12409", "1188", 28, "4306"),
            Sample(2, 102, "2000-01-03", "12410", "1188", 15, "4306"),
            Sample(3, 103, "2000-01-02", "12415", "L 1194", 3, "4311"),
            Sample(4, 104, "2000-01-05", "12420", "1198", 2, "4311"),
            Sample(5, 105, "2000-01-01", "12398", "1170", 30, "4290"),
        ];
    }

    private static InvoiceDoc WithRecipient(InvoiceDoc doc, PartyDto party, FirmSettings firm) => doc with
    {
        Party = party.Name,
        PartyName = party.Name,
        Address = party.Address,
        State = party.State,
        Gstin = party.Gstin,
        DiscountPct = party.Discount ?? 0,
        TaxMode = TaxModes.Resolve(firm, party.Gstin, party.State),
        CgstRate = firm.CgstRate,
        SgstRate = firm.SgstRate,
        IgstRate = firm.IgstRate,
        Firm = firm,
    };

    private FinishResolver Resolver(PartyDto bill) => new(bill.BillAs, bill.Rates, masters.FinishFallbacks());

    private void CheckPeriod(string? from, string? to)
    {
        var errors = periodValidator.ErrorsFor(new BillPeriod(from, to));
        if (errors.Count > 0) throw new AppValidationException(errors);
    }

    private static bool InPeriod(string date, string from, string to) =>
        string.CompareOrdinal(date, from) >= 0 && string.CompareOrdinal(date, to) <= 0;

    private static InvoiceDoc Sanitize(InvoiceDoc doc) => doc with
    {
        Party = doc.Party ?? string.Empty,
        PartyName = doc.PartyName ?? string.Empty,
        Address = doc.Address ?? string.Empty,
        State = doc.State ?? string.Empty,
        Gstin = doc.Gstin ?? string.Empty,
        BillDate = doc.BillDate ?? string.Empty,
        PeriodFrom = doc.PeriodFrom ?? string.Empty,
        PeriodTo = doc.PeriodTo ?? string.Empty,
        Notes = (doc.Notes ?? string.Empty).Trim(),
        Lines = doc.Lines ?? [],
        Warnings = doc.Warnings ?? [],
    };
}
