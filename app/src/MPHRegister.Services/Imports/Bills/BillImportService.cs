using System.Security.Cryptography;
using MPHRegister.Contracts.Billing;
using MPHRegister.Contracts.Entries;
using MPHRegister.Contracts.Imports;
using MPHRegister.Contracts.Masters;
using MPHRegister.Contracts.Settings;
using MPHRegister.Data.Config;
using MPHRegister.Data.Database;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Services.Billing;
using MPHRegister.Services.Interfaces;
using MPHRegister.Services.Mapping;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Imports.Bills;

/// <summary>
/// Imports bills made in the Excel bill workbook so they count as billed: each line is linked to the inward entries it
/// was made from, totals are re-worked and must match the sheet, and unknown parties are added from the Details sheet.
/// </summary>
public sealed class BillImportService(
    IDbSession session,
    IBackupService backups,
    IEntryRepository entries,
    IInvoiceRepository invoices,
    IConfigStore config,
    IImportLogRepository log,
    IMasterReader masters,
    IEntryReader reader,
    ISettingsService settings,
    BillLineSizer sizer,
    TimeProvider clock) : IBillImportService
{
    public BillImportReport Import(string filePath, string fileName, bool commit)
    {
        var errors = new List<string>();
        var warnings = new List<string>();
        var hash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(filePath)));
        BillSheet? sheet;
        try
        {
            sheet = BillSheetReader.Read(filePath);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            return Fail(fileName, $"Could not read the workbook: {ex.Message}");
        }
        if (sheet is null) return Fail(fileName, "The workbook has no sheet named \"Main\".");
        errors.AddRange(sheet.Errors);
        if (log.BillFileByHash(hash) is { } previous) errors.Add($"This exact bill file was already imported (as \"{previous}\").");

        var firm = settings.Snapshot();
        var (partyFor, added, filled) = ResolveParties(sheet, warnings);
        var docs = sheet.Bills.Select(b => (Bill: b, Doc: ToDoc(b, partyFor[b.PartyText], firm, warnings))).ToList();
        if (docs.Count == 0 && errors.Count == 0) errors.Add("No filled bills were found on the Main sheet.");
        foreach (var dup in docs.GroupBy(p => p.Doc.InvoiceNo, StringComparer.OrdinalIgnoreCase).Where(g => g.Count() > 1))
            errors.Add($"Bill number {dup.Key} appears {dup.Count()} times ({string.Join(", ", dup.Select(d => d.Bill.Cell))}).");
        foreach (var (bill, doc) in docs)
        {
            if (invoices.Exists(doc.InvoiceNo!, bill.Fy, bill.Serial)) errors.Add($"Bill {doc.InvoiceNo} is already in the app.");
        }

        var linked = LinkWorkbook(docs, firm, errors, warnings);
        var finished = linked.Finished;
        var unmatched = linked.Unmatched;
        if (unmatched.Count > 0)
            warnings.Add($"{unmatched.Count} bill line(s) could not be matched to inward entries. The bills still import; tick the left-over entries that were billed and mark them.");

        var imported = false;
        if (commit && errors.Count == 0)
        {
            backups.Backup(session.Connection, "before-bill-import");
            config.Backup("before-bill-import");
            using var unit = session.Begin();
            var now = Dates.Timestamp(clock.GetLocalNow());
            foreach (var (doc, fy, serial) in finished.OrderBy(f => f.Fy, StringComparer.Ordinal).ThenBy(f => f.Serial))
            {
                var id = invoices.Insert(InvoiceMapper.ToEntity(doc, fy, serial, now));
                invoices.ReplaceLines(id, doc.Lines.Select(InvoiceMapper.ToEntity).ToList(), doc.Lines.SelectMany(l => l.EntryIds ?? []).ToList());
            }
            log.AddBillImport(new BillImportEntity { FileName = fileName, Sha256 = hash, ImportedAt = now, InvoiceCount = finished.Count });
            unit.Commit();
            imported = true;
            SaveParties(added, filled);
        }
        return new BillImportReport(imported, fileName, finished.Count, finished.Sum(f => f.Doc.Total), finished.Sum(f => f.Doc.Lines.Sum(l => l.EntryIds?.Count ?? 0)),
            added.Select(p => p.Name).ToList(), linked.Bills.OrderBy(b => b.InvoiceNo, StringComparer.OrdinalIgnoreCase).ToList(), unmatched, linked.Leftovers, errors, warnings,
            linked.Suggestions);
    }

    public BillRelinkReport Relink(bool commit)
    {
        var stored = invoices.Saved(InvoiceSource.Excel.ToDbValue()).Select(i => new StoredBill(i, invoices.Lines(i.Id))).ToList();
        var rows = entries.List(null);
        // The order of Unbilled, so a re-check right after an import finds the same links.
        var all = reader.Read(rows).Where(e => e.NettThan > 0)
            .OrderBy(e => e.RegisterMonth, StringComparer.Ordinal).ThenByDescending(e => e.CarriedOver).ThenBy(e => e.InwardNo).ThenBy(e => e.Id).ToList();
        var elsewhere = rows.Where(r => r.Elsewhere is not null).Select(r => r.Id).ToHashSet();
        var onApp = entries.OnAppBills();
        var taken = new Dictionary<long, string>();
        var newLinks = new Dictionary<long, IReadOnlyList<LineDto>>();
        var unmatched = new List<BillImportLine>();
        var suggestions = new List<BillLinkSuggestion>();
        var warnings = new List<string>();
        foreach (var month in stored.GroupBy(b => b.Invoice.BillMonth, StringComparer.Ordinal).OrderBy(g => g.Key, StringComparer.Ordinal))
        {
            foreach (var group in LinkGroups(month.Select(b => b.Invoice.Party)))
            {
                var members = month.Where(b => group.Parties.Contains(b.Invoice.Party)).ToList();
                bool Free(EntryDto e) => !onApp.Contains(e.Id) && !elsewhere.Contains(e.Id) && !taken.ContainsKey(e.Id);
                var pool = all.Where(e => group.PoolParties.Contains(e.Party) && Free(e)).ToList();
                var billed = all.Where(e => group.PoolParties.Contains(e.Party) && !Free(e))
                    .Select(e => taken.TryGetValue(e.Id, out var bill) ? e with { BilledIn = bill } : e).ToList();
                var others = Around(all.Where(e => !group.PoolParties.Contains(e.Party) && Free(e)), members.Select(b => b.Invoice));
                var bills = members.Select(b => ToLinkBill(group, b.Invoice.InvoiceNo, b.Invoice.Party, b.Invoice.PartyName, b.Invoice.PeriodFrom,
                    b.Invoice.PeriodTo, b.Lines.Select(InvoiceMapper.ToDto).ToList())).ToList();
                var outcome = BillLinker.Link(bills, pool, billed, onApp, others);
                for (var i = 0; i < members.Count; i++) newLinks[members[i].Invoice.Id] = outcome.Lines[i];
                foreach (var (id, bill) in outcome.Used) taken.TryAdd(id, bill);
                unmatched.AddRange(outcome.Unmatched);
                suggestions.AddRange(outcome.Suggestions);
                warnings.AddRange(outcome.Conflicts);
                warnings.AddRange(outcome.Notes);
            }
        }
        return SaveRelink(stored, newLinks, all, onApp, taken, new RelinkFindings(unmatched, suggestions, warnings), commit);
    }

    private BillRelinkReport SaveRelink(List<StoredBill> stored, Dictionary<long, IReadOnlyList<LineDto>> newLinks, List<EntryDto> all, IReadOnlySet<long> onApp,
        Dictionary<long, string> taken, RelinkFindings findings, bool commit)
    {
        var before = stored.SelectMany(b => b.Lines.Select(InvoiceMapper.ToDto).SelectMany(l => l.EntryIds ?? [])).ToHashSet();
        var changed = stored.Where(b => !SameLinks(b.Lines.Select(InvoiceMapper.ToDto).ToList(), newLinks[b.Invoice.Id])).ToList();
        var unmatchedBefore = stored.Sum(b => Unlinked(b.Lines.Select(InvoiceMapper.ToDto).ToList()));
        var unmatchedAfter = stored.Sum(b => Unlinked(newLinks[b.Invoice.Id]));
        var dropped = all.Where(e => before.Contains(e.Id) && !taken.ContainsKey(e.Id) && !onApp.Contains(e.Id))
            .Select(e => new LeftoverEntry(e.Id, e.Party, e.RegisterMonth, e.InwardNo, e.DesignNo, e.LotNo, e.Finish, e.NettThan, BillingService.StateOf(e).ToDbValue()))
            .ToList();
        var saved = false;
        if (commit && changed.Count > 0)
        {
            backups.Backup(session.Connection, "before-relink");
            using var unit = session.Begin();
            foreach (var bill in changed)
            {
                var lines = newLinks[bill.Invoice.Id];
                var entities = bill.Lines.Select((l, i) => l with { EntryIds = InvoiceMapper.ToEntity(lines[i]).EntryIds }).ToList();
                invoices.ReplaceLines(bill.Invoice.Id, entities, lines.SelectMany(l => l.EntryIds ?? []).ToList());
            }
            unit.Commit();
            saved = true;
        }
        return new BillRelinkReport(saved, stored.Count, changed.Count, before.Count, taken.Count, unmatchedBefore, unmatchedAfter,
            findings.Unmatched, dropped, findings.Suggestions, findings.Warnings);
    }

    private static bool SameLinks(List<LineDto> a, IReadOnlyList<LineDto> b) =>
        a.Count == b.Count && a.Zip(b).All(p => (p.First.EntryIds ?? []).Order().SequenceEqual((p.Second.EntryIds ?? []).Order()));

    private static int Unlinked(IReadOnlyList<LineDto> lines) => BillLineMatcher.Billable(lines).Count(x => (lines[x.Index].EntryIds ?? []).Count == 0);

    /// <summary>Links the bills of the workbook party by party (sister firms together), works out each bill and compares it with the sheet.</summary>
    private LinkedWorkbook LinkWorkbook(List<(SheetBill Bill, InvoiceDoc Doc)> docs, FirmSettings firm, List<string> errors, List<string> warnings)
    {
        var result = new LinkedWorkbook();
        if (docs.Count == 0) return result;
        var onApp = entries.OnAppBills();
        var taken = new HashSet<long>();
        var from = docs.Min(d => Dates.ParseIsoOrDefault(d.Doc.PeriodFrom)).AddDays(-110);
        var to = docs.Max(d => Dates.ParseIsoOrDefault(d.Doc.PeriodTo)).AddDays(10);
        var everyone = reader.Read(entries.UnbilledAnyParty(Dates.Iso(from), Dates.Iso(to)));
        foreach (var group in LinkGroups(docs.Select(d => d.Doc.Party)))
        {
            var members = docs.Where(d => group.Parties.Contains(d.Doc.Party))
                .OrderBy(d => d.Bill.Fy, StringComparer.Ordinal).ThenBy(d => d.Bill.Serial).ToList();
            var maxMonth = members.Max(d => d.Doc.BillDate[..7]);
            var upto = Dates.Month(Dates.ParseIsoOrDefault(maxMonth + "-01").AddMonths(1));
            var pool = reader.Read(entries.Unbilled(group.PoolParties.ToList(), upto)).Where(e => !taken.Contains(e.Id)).ToList();
            var billed = reader.Read(entries.Billed(group.PoolParties.ToList(), upto));
            var others = everyone.Where(e => !group.PoolParties.Contains(e.Party) && !taken.Contains(e.Id)).ToList();
            var bills = members.Select(d => ToLinkBill(group, d.Doc.InvoiceNo!, d.Doc.Party, d.Doc.PartyName, d.Doc.PeriodFrom, d.Doc.PeriodTo, d.Doc.Lines)).ToList();
            var outcome = BillLinker.Link(bills, pool, billed, onApp, others);
            taken.UnionWith(outcome.Used.Keys);
            errors.AddRange(outcome.Conflicts);
            warnings.AddRange(outcome.Notes);
            warnings.AddRange(SuggestionTexts(outcome.Suggestions));
            result.Unmatched.AddRange(outcome.Unmatched);
            result.Suggestions.AddRange(outcome.Suggestions);
            for (var i = 0; i < members.Count; i++)
            {
                var (bill, sheetDoc) = members[i];
                var doc = BillCalculator.Complete(sheetDoc with { Lines = outcome.Lines[i] }, group.BillParty[sheetDoc.Party], null, firm, sizer);
                result.Bills.Add(Checked(bill, doc, outcome.Matched[i], outcome.Missed[i], errors));
                result.Finished.Add((doc, bill.Fy, bill.Serial));
            }
            result.Leftovers.AddRange(pool.Where(e => !outcome.Used.ContainsKey(e.Id) && string.CompareOrdinal(e.RegisterMonth, maxMonth) <= 0)
                .Select(e => new LeftoverEntry(e.Id, e.Party, e.RegisterMonth, e.InwardNo, e.DesignNo, e.LotNo, e.Finish, e.NettThan, BillingService.StateOf(e).ToDbValue())));
        }
        return result;
    }

    private static IEnumerable<string> SuggestionTexts(IEnumerable<BillLinkSuggestion> suggestions) => suggestions
        .GroupBy(s => (s.BillParty, s.EntryParty))
        .Select(g => $"{g.Count()} line(s) of {g.Key.BillParty} bills (first {g.First().InvoiceNo} row {g.First().Row}) match inward entries of {g.Key.EntryParty}, "
            + $"which are not linked. If the two are sister firms, give both the same sister-firm group in Masters → Parties, then re-check the links of imported bills.");

    private static BillImportInvoice Checked(SheetBill bill, InvoiceDoc doc, int matched, int missed, List<string> errors)
    {
        var problems = new List<string>();
        void Compare(string what, long sheetValue, long appValue)
        {
            if (sheetValue != appValue) problems.Add($"{what}: sheet {sheetValue}, app {appValue}");
        }
        Compare("Gross", bill.Gross, doc.Gross);
        Compare("Discount", bill.Discount, doc.Discount);
        Compare("Taxable", bill.Taxable, doc.Taxable);
        Compare("CGST", bill.Cgst, doc.Cgst);
        Compare("SGST", bill.Sgst, doc.Sgst);
        Compare("Total", bill.Total, doc.Total);
        problems.AddRange(doc.Warnings.Where(w => w.StartsWith("No rate", StringComparison.Ordinal) || w.Contains("GSTIN", StringComparison.Ordinal)));
        if (bill.Total != doc.Total) errors.Add($"{doc.InvoiceNo}: the app works out a total of {doc.Total} but the sheet shows {bill.Total}.");
        return new BillImportInvoice(doc.InvoiceNo!, doc.PartyName, doc.BillDate, bill.Cell, doc.Lines.Count(l => l.Kind != LineKind.Blank), matched, missed, bill.Total, doc.Total, problems);
    }

    /// <summary>Unbilled entries received or sent around the bills' periods (others are too far away to be on them).</summary>
    private static List<EntryDto> Around(IEnumerable<EntryDto> list, IEnumerable<InvoiceEntity> bills)
    {
        var periods = bills.ToList();
        var from = Dates.Iso(periods.Min(b => Dates.ParseIsoOrDefault(b.PeriodFrom)).AddDays(-110));
        var to = Dates.Iso(periods.Max(b => Dates.ParseIsoOrDefault(b.PeriodTo)).AddDays(10));
        return list.Where(e => string.CompareOrdinal(e.EntryDate, to) <= 0 && string.CompareOrdinal(e.EntryDate, from) >= 0).ToList();
    }

    private static LinkBill ToLinkBill(LinkGroup group, string invoiceNo, string party, string partyName, string from, string to, IReadOnlyList<LineDto> lines) =>
        new(invoiceNo, partyName, Dates.ParseIsoOrDefault(from), Dates.ParseIsoOrDefault(to), lines, group.Own[party], group.Finishes[party]);

    /// <summary>
    /// Bill parties whose bills are linked together: a party with its sister firms,
    /// so a sister firm's own bills are not robbed of their entries by the other firm's bills.
    /// </summary>
    private List<LinkGroup> LinkGroups(IEnumerable<string> billParties)
    {
        var fallbacks = masters.FinishFallbacks();
        var groups = new Dictionary<string, LinkGroup>(StringComparer.OrdinalIgnoreCase);
        foreach (var party in billParties.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var billParty = masters.Party(party);
            var key = billParty is { SisterGroup.Length: > 0 } ? $"group:{billParty.SisterGroup}" : $"party:{party}";
            if (!groups.TryGetValue(key, out var group)) groups[key] = group = new LinkGroup();
            group.Parties.Add(party);
            group.BillParty[party] = billParty;
            group.Own[party] = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { billParty?.Name ?? party };
            group.Finishes[party] = new FinishResolver(billParty?.BillAs ?? new Dictionary<string, string>(), billParty?.Rates ?? new Dictionary<string, decimal>(), fallbacks);
            group.PoolParties.UnionWith(masters.BillRecipients(party));
        }
        return groups.Values.ToList();
    }

    private sealed class LinkGroup
    {
        public HashSet<string> Parties { get; } = new(StringComparer.OrdinalIgnoreCase);

        public HashSet<string> PoolParties { get; } = new(StringComparer.OrdinalIgnoreCase);

        public Dictionary<string, PartyDto?> BillParty { get; } = new(StringComparer.OrdinalIgnoreCase);

        public Dictionary<string, IReadOnlySet<string>> Own { get; } = new(StringComparer.OrdinalIgnoreCase);

        public Dictionary<string, FinishResolver> Finishes { get; } = new(StringComparer.OrdinalIgnoreCase);
    }

    private sealed class LinkedWorkbook
    {
        public List<BillImportInvoice> Bills { get; } = [];

        public List<(InvoiceDoc Doc, string Fy, int Serial)> Finished { get; } = [];

        public List<BillImportLine> Unmatched { get; } = [];

        public List<LeftoverEntry> Leftovers { get; } = [];

        public List<BillLinkSuggestion> Suggestions { get; } = [];
    }

    private sealed record StoredBill(InvoiceEntity Invoice, IReadOnlyList<InvoiceLineEntity> Lines);

    private sealed record RelinkFindings(List<BillImportLine> Unmatched, List<BillLinkSuggestion> Suggestions, List<string> Warnings);

    private (Dictionary<string, PartyDto> PartyFor, List<SheetParty> Added, List<SheetParty> Filled) ResolveParties(BillSheet sheet, List<string> warnings)
    {
        var partyFor = new Dictionary<string, PartyDto>(StringComparer.OrdinalIgnoreCase);
        var added = new List<SheetParty>();
        var filled = new List<SheetParty>();
        foreach (var name in sheet.Bills.Select(b => b.PartyText).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var details = sheet.Parties.GetValueOrDefault(name) ?? new SheetParty(name, string.Empty, string.Empty, string.Empty, null, false, "black", new Dictionary<string, decimal>());
            var party = masters.Party(name);
            if (party is null)
            {
                added.Add(details);
                warnings.Add($"Party \"{name}\" was not in the party list; it will be added as inactive with the details from this workbook.");
                var style = ConfigIndex.For(config.Current).FallbackStyle;
                party = new PartyDto(name, false, details.Address, details.State, details.Gstin, details.Discount, details.Color,
                    style.Name, style, false, new Dictionary<string, string>(), details.Rates, 0, []);
            }
            else if (party.Gstin.Length == 0 && party.Rates.Count == 0 && details.Gstin.Length > 0)
            {
                filled.Add(details with { Name = party.Name });
                warnings.Add($"Party \"{party.Name}\" had no GSTIN or rates in the app; they will be filled in from this workbook.");
                party = party with { Address = details.Address, State = details.State, Gstin = details.Gstin, Discount = details.Discount, Rates = details.Rates };
            }
            partyFor[name] = party;
        }
        return (partyFor, added, filled);
    }

    private static InvoiceDoc ToDoc(SheetBill bill, PartyDto party, FirmSettings firm, List<string> warnings)
    {
        var pct = party.Discount ?? 0;
        if (bill.Gross > 0 && Money.RoundRupee(bill.Gross * pct / 100m) != bill.Discount)
        {
            var derived = Math.Round(bill.Discount * 100m / bill.Gross, 2);
            if (Money.RoundRupee(bill.Gross * derived / 100m) == bill.Discount) pct = derived;
            warnings.Add($"{bill.InvoiceNo}: discount on the sheet ({bill.Discount}) is not {party.Discount}% of {bill.Gross}; using {pct}%.");
        }
        return new InvoiceDoc(null, bill.InvoiceNo, party.Name, bill.PartyText, bill.Address, bill.State, bill.Gstin, bill.BillDate, bill.PeriodFrom,
            bill.PeriodTo, pct, TaxMode.Intra, bill.CgstRate ?? firm.CgstRate, bill.SgstRate ?? firm.SgstRate, firm.IgstRate, 0, 0, 0, 0, 0, 0, 0, 0,
            InvoiceStatus.Saved, InvoiceSource.Excel, string.Empty, string.Empty, bill.Lines, [], firm, null, null);
    }

    /// <summary>New parties (inactive, with the workbook's details) and empty ones filled in, after the bills are safely saved.</summary>
    private void SaveParties(List<SheetParty> added, List<SheetParty> filled)
    {
        if (added.Count == 0 && filled.Count == 0) return;
        config.Update(c =>
        {
            var index = ConfigIndex.For(c);
            var parties = c.Parties.Select(p =>
            {
                var details = filled.FirstOrDefault(f => string.Equals(f.Name, p.Name, StringComparison.OrdinalIgnoreCase));
                if (details is null) return p;
                return p with
                {
                    Address = p.Address.Length > 0 ? p.Address : details.Address,
                    State = p.State.Length > 0 ? p.State : details.State,
                    Gstin = details.Gstin,
                    DiscountPercent = p.DiscountPercent ?? details.Discount,
                    Rates = KnownRates(index, details),
                };
            }).ToList();
            parties.AddRange(added.Where(a => index.Party(a.Name) is null).Select(a => new PartyConfig
            {
                Name = a.Name,
                Active = false,
                Address = a.Address,
                State = a.State,
                Gstin = a.Gstin,
                DiscountPercent = a.Discount,
                Color = index.IsKnownColor(a.Color) ? a.Color : "black",
                BillingStyle = index.FallbackStyle.Name,
                Rates = KnownRates(index, a),
            }));
            return c with { Parties = parties };
        });
    }

    private static Dictionary<string, decimal> KnownRates(ConfigIndex index, SheetParty party)
    {
        var known = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var (finish, rate) in party.Rates)
        {
            if (index.Finish(finish) is { } found && rate > 0) known[found.Name] = rate;
        }
        return known;
    }

    private static BillImportReport Fail(string fileName, string error) => new(false, fileName, 0, 0, 0, [], [], [], [], [error], [], []);
}
