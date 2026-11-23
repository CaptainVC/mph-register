using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using MPHRegister.Contracts.Entries;
using MPHRegister.Contracts.Imports;
using MPHRegister.Data.Config;
using MPHRegister.Data.Database;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Services.Arrivals;
using MPHRegister.Services.Interfaces;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Imports.Inward;

public sealed partial class InwardImportService(
    IDbSession session,
    IBackupService backups,
    IEntryRepository entries,
    IConfigStore config,
    IImportLogRepository log,
    ArrivalLinker linker,
    TimeProvider clock) : IInwardImportService
{
    private const int CarryoverDateSlipDays = 20;

    /// <summary>"INWARD REG.-OCT.-26-27.xlsm" → 2026-10. Only the first year counts (the June file is named 26-29).</summary>
    public static string? GuessMonth(string fileName) => RegisterFileName.GuessMonth(fileName);

    /// <summary>
    /// Checks (and with <paramref name="commit"/> saves) a month's inward workbook. Into a month that already has entries it
    /// is an update: new rows are added, saved entries take what the workbook changed since their last import and keep what
    /// was changed in the app, and imported entries the workbook no longer has are removed (refused when they are billed).
    /// </summary>
    public ImportReport Import(string filePath, string fileName, string? registerMonth, bool commit)
    {
        var month = string.IsNullOrWhiteSpace(registerMonth) ? GuessMonth(fileName) ?? string.Empty : registerMonth.Trim();
        var warnings = new List<ImportIssue>();
        var errors = new List<ImportIssue>();
        if (!Dates.IsValidMonth(month)) errors.Add(new ImportIssue(0, "Register month is missing or invalid."));
        var hash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(filePath)));

        InwardSheet sheet;
        try
        {
            sheet = InwardSheetReader.Read(filePath);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            sheet = new InwardSheet([], [], [new ImportIssue(0, $"Could not read the workbook: {ex.Message}")]);
        }
        warnings.AddRange(sheet.Warnings);
        errors.AddRange(sheet.Errors);
        var readable = errors.Count == 0;
        if (readable && log.InwardFileByHash(hash) is { } previous)
            errors.Add(new ImportIssue(0, $"This exact file was already imported (as \"{previous}\")."));

        var (rows, addedParties, addedFinishes) = UseMasterSpelling(sheet.Rows, warnings);
        var plan = readable
            ? Plan(rows, month, addedParties, addedFinishes, warnings, errors)
            : new MonthPlan(0, rows.Select(r => new RowPlan(r, RowAction.Insert, ToEntity(r, month), [], true)).ToList(), [], [], [], []);
        var plans = plan.Rows;
        var upToDate = errors.Count == 0 && plan.Saved > 0 && plan.Removals.Count == 0
            && plans.All(p => (p.Action is RowAction.UpdateSaved or RowAction.MergeIntoEarlier or RowAction.KeepDeleted) && !p.Changed);

        var imported = false;
        if (commit && errors.Count == 0 && !upToDate)
        {
            backups.Backup(session.Connection, "before-import");
            config.Backup("before-import");
            using var unit = session.Begin();
            var now = Dates.Timestamp(clock.GetLocalNow());
            var inserts = plans.Where(p => p.Action == RowAction.Insert).ToList();
            var batchId = log.AddInwardBatch(new ImportBatchEntity
            {
                FileName = fileName,
                Sha256 = hash,
                RegisterMonth = month,
                ImportedAt = now,
                EntryCount = inserts.Count,
                DispatchCount = inserts.Sum(p => p.Dispatches.Count),
            });
            var marks = new List<ImportBatchEntryEntity>();
            foreach (var p in plans)
            {
                var source = SourceValues.Of(p.Row).ToJson();
                var entryId = p.Entry.Id;
                switch (p.Action)
                {
                    case RowAction.Insert:
                        entryId = entries.Insert(p.Entry with { ImportBatchId = batchId, SourceValues = source, CreatedAt = now, UpdatedAt = now });
                        entries.ReplaceDispatches(entryId, p.Dispatches);
                        break;
                    case RowAction.AdoptLaterCarryover:
                        entries.MoveToMonth(p.Entry.Id, month, batchId, p.Row.Row, source);
                        if (p.Changed) Apply(p, now);
                        break;
                    case RowAction.KeepDeleted:
                        break;
                    case RowAction.UpdateSaved:
                        if (p.Changed) entries.Update(p.Entry with { UpdatedAt = now });
                        if (p.DispatchesChanged) entries.ReplaceDispatches(p.Entry.Id, p.Dispatches);
                        entries.MarkImported(p.Entry.Id, batchId, p.Row.Row, source);
                        break;
                    default:
                        if (p.Changed) Apply(p, now);
                        entries.SaveCarryoverSource(p.Entry.Id, month, source);
                        break;
                }
                if (Mark(p) is { } action)
                    marks.Add(new ImportBatchEntryEntity
                    {
                        BatchId = batchId, EntryId = entryId, Action = action, SourceRow = p.Row.Row, Changes = string.Join("; ", p.Changes),
                        Details = action == ImportMarks.Updated && p.Before is not null
                            ? ImportDetailsBuilder.ToJson(ImportDetailsBuilder.Between(p.Before, p.BeforeDispatches, p.Entry, p.Dispatches))
                            : string.Empty,
                    });
            }
            foreach (var removed in plan.Removals) entries.Delete(removed.Id);
            log.AddInwardBatchEntries(marks.GroupBy(m => m.EntryId).Select(Combine).ToList());
            unit.Commit();
            imported = true;
            AddInactive(addedParties, addedFinishes);
            LinkArrivals(marks.Select(m => m.EntryId).Concat(plan.Removals.Select(r => r.Id)).ToList(), rows);
            // A month of new rows: SQLite's query statistics are brought up to date.
            session.Optimize();
        }

        var notInWorkbook = plan.Removals.Select(e => (Entry: e, Note: imported ? "was removed" : "will be removed"))
            .Concat(plan.Typed.Select(e => (Entry: e, Note: "was entered in the app; it stays")))
            .OrderBy(x => x.Entry.InwardNo).ThenBy(x => x.Entry.Id)
            .Select(x => new ImportIssue(0, $"{Slip(x.Entry)} {x.Note}."))
            .ToList();
        var added = plans.Where(p => p.Action == RowAction.Insert).Select(p => new ImportIssue(p.Row.Row, Describe(p.Row))).ToList();
        return new ImportReport(imported, fileName, month, plans.Count(p => p.Action == RowAction.Insert), rows.Sum(r => r.Dispatches.Count),
            rows.Count(r => r.AfterBlankRows), rows.Sum(r => r.Than), rows.Sum(r => r.Tp), rows.Sum(r => r.Than + r.Tp),
            rows.Sum(r => r.Repair ? 0 : r.Than), rows.Sum(r => r.TwoPart), rows.Sum(r => r.Dispatches.Sum(d => d.Qty)),
            plans.Count(p => p.Action is RowAction.MergeIntoEarlier or RowAction.AdoptLaterCarryover), addedParties, addedFinishes, warnings, errors,
            plan.Saved, plans.Count(p => p.Action == RowAction.UpdateSaved && p.Changed), plans.Count(p => p.Action == RowAction.UpdateSaved && !p.Changed),
            plan.Removals.Count, upToDate, plan.Changes, plan.Kept, notInWorkbook, added,
            plans.Count(p => p.Action == RowAction.AdoptLaterCarryover || (p.Action == RowAction.MergeIntoEarlier && p.Changed)));
    }

    /// <summary>What the import is remembered to have done to the row's entry (the Register's New and Updated filters).</summary>
    private static string? Mark(RowPlan plan) => plan.Action switch
    {
        RowAction.Insert => ImportMarks.Added,
        RowAction.AdoptLaterCarryover => ImportMarks.Updated,
        RowAction.UpdateSaved or RowAction.MergeIntoEarlier when plan.Changed => ImportMarks.Updated,
        _ => null,
    };

    /// <summary>Two carryover rows of one earlier slip update the same entry: kept once, with both rows' changes.</summary>
    private static ImportBatchEntryEntity Combine(IGrouping<long, ImportBatchEntryEntity> marks)
    {
        var first = marks.First();
        if (!marks.Skip(1).Any()) return first;
        var action = marks.Any(m => m.Action == ImportMarks.Added) ? ImportMarks.Added : ImportMarks.Updated;
        var details = marks.Select(m => ImportDetailsBuilder.FromJson(m.Details)).OfType<ImportChangeDetails>().ToList();
        return first with
        {
            Action = action,
            Changes = string.Join("; ", marks.Select(m => m.Changes).Where(c => c.Length > 0)),
            Details = action == ImportMarks.Added || details.Count == 0 ? string.Empty : ImportDetailsBuilder.ToJson(details.Aggregate(ImportDetailsBuilder.Merge)),
        };
    }

    /// <summary>"INW. NO. 7 of 2026-04-04 (PARTY): D.N. D7, LOT N. L7, THAN 11, FINISH F1, 1 dispatch."</summary>
    private static string Describe(InwardRow row)
    {
        var parts = new List<string>();
        if (row.Design.Length > 0) parts.Add($"D.N. {row.Design}");
        if (row.Lot.Length > 0) parts.Add($"LOT N. {row.Lot}");
        if (row.Repair) parts.Add("REP. YES");
        parts.Add(string.Create(CultureInfo.InvariantCulture, $"THAN {row.Than}"));
        if (row.Tp != 0) parts.Add(string.Create(CultureInfo.InvariantCulture, $"TP {row.Tp}"));
        if (row.TwoPart != 0) parts.Add(string.Create(CultureInfo.InvariantCulture, $"TWO PART {row.TwoPart}"));
        if (row.Finish.Length > 0) parts.Add($"FINISH {row.Finish}");
        if (row.Dispatches.Count > 0) parts.Add(string.Create(CultureInfo.InvariantCulture, $"{row.Dispatches.Count} {(row.Dispatches.Count == 1 ? "dispatch" : "dispatches")}"));
        if (row.AfterBlankRows) parts.Add("carryover row");
        return string.Create(CultureInfo.InvariantCulture, $"INW. NO. {row.InwardNo} of {row.Date} ({row.Party}): {string.Join(", ", parts)}.");
    }

    /// <summary>Aawak rows naming the imported slips (or linked to entries the import changed or removed) are linked again.</summary>
    private void LinkArrivals(List<long> entryIds, List<InwardRow> rows)
    {
        if (rows.Count == 0) return;
        var dates = rows.Select(r => r.Date).Order(StringComparer.Ordinal).ToList();
        using var unit = session.Begin();
        linker.LinkAround(entryIds, rows.Where(r => !r.AfterBlankRows).Select(r => r.InwardNo).ToList(), dates[0], dates[^1]);
        unit.Commit();
    }

    /// <summary>Names the register uses but the config file lacks are added as inactive, after the entries are safely saved.</summary>
    private void AddInactive(List<string> parties, List<string> finishes)
    {
        if (parties.Count == 0 && finishes.Count == 0) return;
        config.Update(c =>
        {
            var index = ConfigIndex.For(c);
            var style = index.FallbackStyle.Name;
            return c with
            {
                Parties = [.. c.Parties, .. parties.Where(p => index.Party(p) is null).Select(p => new PartyConfig { Name = p, Active = false, BillingStyle = style })],
                Finishes = [.. c.Finishes, .. finishes.Where(f => index.Finish(f) is null).Select(f => new FinishConfig { Name = f, Active = false })],
            };
        });
    }

    private void Apply(RowPlan plan, string now)
    {
        entries.Update(plan.Entry with { UpdatedAt = now });
        entries.ReplaceDispatches(plan.Entry.Id, plan.Dispatches);
    }

    /// <summary>
    /// Rows that are saved entries of the month update them; other rows are carryovers of an earlier month, originals of a
    /// later month's carryover, or new. Imported entries of the month that no row matches are removed; billed ones refuse.
    /// </summary>
    private MonthPlan Plan(List<InwardRow> rows, string month, List<string> newParties, List<string> newFinishes, List<ImportIssue> warnings, List<ImportIssue> errors)
    {
        var saved = entries.List(month);
        var parties = newParties.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var finishes = newFinishes.ToHashSet(StringComparer.OrdinalIgnoreCase);
        bool NewParty(InwardRow row) => parties.Contains(row.Party);
        bool NewFinish(InwardRow row) => row.Finish.Length > 0 && finishes.Contains(row.Finish);
        var lastRows = Parse(entries.SourceValues(month));
        var carried = new CarriedRows(Parse(entries.CarryoverSources(month)));
        var importedBefore = saved.Any(e => e.ImportBatchId is not null) || carried.Rows.Count > 0;
        var changes = new List<ImportIssue>();
        var kept = new List<ImportIssue>();
        var (matches, shared) = SavedEntryMatcher.BySlip(rows, saved, lastRows);
        var sharedRows = shared.SelectMany(s => s.Rows).ToHashSet();
        var plans = new RowPlan?[rows.Count];
        for (var i = 0; i < rows.Count; i++)
        {
            if (!matches.ContainsKey(i) && !sharedRows.Contains(i)) plans[i] = FromOtherMonth(rows[i], month, importedBefore, carried, NewParty(rows[i]), NewFinish(rows[i]), warnings, changes, kept);
        }
        var bySlip = matches.Values.Select(e => e.Id).ToHashSet();
        foreach (var (i, entry) in SavedEntryMatcher.Loosely(rows, Enumerable.Range(0, rows.Count).Where(i => !matches.ContainsKey(i) && plans[i] is null), saved.Where(e => !bySlip.Contains(e.Id))))
            matches[i] = entry;
        SavedEntryMatcher.InOrder(shared, matches);

        var dispatches = entries.Dispatches(matches.Values.Select(e => e.Id).ToHashSet());
        var laterImports = log.InwardImportTimesAfter(month);
        for (var i = 0; i < rows.Count; i++)
        {
            var row = rows[i];
            if (matches.TryGetValue(i, out var stored))
            {
                var storedDispatches = dispatches.GetValueOrDefault(stored.Id) ?? [];
                var hasRow = lastRows.TryGetValue(stored.Id, out var last);
                // An entry imported before rows were kept still holds its workbook row if nothing changed it since: not edited
                // (updated when created) and no later month imported in that same second, whose carryovers would not show.
                if (!hasRow && stored.ImportBatchId is not null && stored.UpdatedAt == stored.CreatedAt && !laterImports.Contains(stored.CreatedAt))
                    last = SourceValues.Of(stored, storedDispatches);
                var update = EntryUpdater.Update(stored, storedDispatches, row, last, hasRow, NewParty(row), NewFinish(row));
                var slip = Slip(stored);
                if (update.Changes.Count > 0) changes.Add(new ImportIssue(row.Row, $"{slip}: {string.Join("; ", update.Changes)}."));
                if (update.Kept.Count > 0) kept.Add(new ImportIssue(row.Row, $"{slip}: {string.Join("; ", update.Kept)}."));
                if (update.FieldsChanged) WarnIfBilled(stored, row.Row, slip, warnings);
                plans[i] = new RowPlan(row, RowAction.UpdateSaved, update.Entry, update.Dispatches, update.Changed, update.DispatchesChanged) { Changes = update.Changes, Before = stored, BeforeDispatches = storedDispatches };
            }
            else
            {
                plans[i] ??= new RowPlan(row, RowAction.Insert, ToEntity(row, month), ToDispatches(row), true);
            }
        }

        KeepDeleted(rows, plans, month, kept);

        var matched = matches.Values.Select(e => e.Id).ToHashSet();
        var removals = new List<EntryEntity>();
        var typed = new List<EntryEntity>();
        foreach (var entry in saved.Where(e => !matched.Contains(e.Id)))
        {
            if (entry.ImportBatchId is null)
                typed.Add(entry);
            else if (entry.Bill is not null)
                errors.Add(new ImportIssue(0, $"{Slip(entry)} is on bill {entry.Bill} but is not in this workbook. Put the row back in the workbook, or cancel the bill first."));
            else if (entry.Elsewhere is not null)
                errors.Add(new ImportIssue(0, $"{Slip(entry)} is marked as billed outside the app but is not in this workbook. Put the row back in the workbook, or undo the mark first."));
            else
                removals.Add(entry);
        }
        return new MonthPlan(saved.Count, [.. plans.Select(p => p!)], removals, typed, [.. changes.OrderBy(c => c.Row)], kept);
    }

    /// <summary>
    /// A deletion made in the app is kept like its other changes: a row that would be added but holds the slip of an entry
    /// deleted in the app (this month's own, or an earlier month's for a carryover row) is left out and listed as kept. A
    /// slip without INW. NO. must also have the same D.N., LOT N. and THAN. Register → Deleted entries brings it back.
    /// </summary>
    private void KeepDeleted(List<InwardRow> rows, RowPlan?[] plans, string month, List<ImportIssue> kept)
    {
        var deleted = entries.DeletedUpTo(month).Select(d => (Entry: d, Rows: DeletedRows(d))).ToList();
        if (deleted.Count == 0) return;
        var used = new HashSet<long>();
        for (var i = 0; i < rows.Count; i++)
        {
            if (plans[i] is not { Action: RowAction.Insert } plan) continue;
            var row = rows[i];
            var match = deleted.FirstOrDefault(d => !used.Contains(d.Entry.Id)
                && (d.Entry.RegisterMonth == month || row.AfterBlankRows)
                && d.Rows.Any(v => SameSlip(v, row)));
            if (match.Entry is null) continue;
            used.Add(match.Entry.Id);
            plans[i] = plan with { Action = RowAction.KeepDeleted, Changed = false, DispatchesChanged = false };
            kept.Add(new ImportIssue(row.Row, $"INW. NO. {row.InwardNo} of {row.Date} ({row.Party}) was deleted in the app; it stays deleted. Restore it from Register → Deleted entries if it is needed."));
        }
    }

    /// <summary>The deleted entry as saved, as its workbook row was last imported, and as its carryover rows were.</summary>
    private static List<SourceValues> DeletedRows(DeletedEntryEntity deleted)
    {
        var list = new List<SourceValues>
        {
            new(deleted.InwardNo, deleted.EntryDate, deleted.Party, deleted.DesignNo, deleted.LotNo, deleted.Repair, deleted.Than,
                deleted.Tp, deleted.TwoPart, deleted.Finish, deleted.ShortThan, []),
        };
        if (SourceValues.FromJson(deleted.SourceValues) is { } own) list.Add(own);
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(deleted.CarryoverSources) ? "[]" : deleted.CarryoverSources);
            if (doc.RootElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in doc.RootElement.EnumerateArray())
                {
                    if (item.TryGetProperty("sourceValues", out var text) && text.ValueKind == JsonValueKind.String
                        && SourceValues.FromJson(text.GetString()) is { } carried)
                    {
                        list.Add(carried);
                    }
                }
            }
        }
        catch (JsonException)
        {
            // A damaged list of carryover rows only means those rows are not recognised.
        }
        return list;
    }

    private static bool SameSlip(SourceValues values, InwardRow row) =>
        string.Equals(SavedEntryMatcher.Slip(values.InwardNo, values.Date, values.Party), SavedEntryMatcher.Slip(row.InwardNo, row.Date, row.Party), StringComparison.Ordinal)
        && (row.InwardNo > 0 || (string.Equals(values.Design.Trim(), row.Design.Trim(), StringComparison.OrdinalIgnoreCase)
            && string.Equals(values.Lot.Trim(), row.Lot.Trim(), StringComparison.OrdinalIgnoreCase)
            && values.Than == row.Than));

    /// <summary>
    /// A carryover row of an earlier month's slip merges into it; the original of a later month's carryover adopts it. When
    /// the month was imported before, its carryover rows were merged then, so only what changed in them since is taken.
    /// A carryover row still finds its entry after the entry's INW. NO., DATE or PARTY was corrected: through this month's
    /// carryover rows as last imported, or (for the carryover section) any row the entry was ever imported as.
    /// </summary>
    private RowPlan? FromOtherMonth(
        InwardRow row, string month, bool importedBefore, CarriedRows carried, bool newParty, bool newFinish, List<ImportIssue> warnings, List<ImportIssue> updated, List<ImportIssue> kept)
    {
        if (row.InwardNo <= 0) return null;
        var earlier = entries.FindEarlier(row.Party, row.Date, row.InwardNo, month);
        if (earlier is null && carried.EntryFor(row) is { } linked && entries.Get(linked) is { } entry && string.CompareOrdinal(entry.RegisterMonth, month) < 0)
            earlier = entry;
        var later = earlier is null ? entries.FindLaterCarryover(row.Party, row.Date, row.InwardNo, month) : null;
        if (earlier is null && later is null && row.AfterBlankRows
            && entries.EarlierByImportedSlip(row.Party, row.Date, row.InwardNo, month) is [var only])
            earlier = entries.Get(only);
        if (earlier is null && later is null) earlier = SameSlipOtherDate(row, month, warnings);
        var stored = earlier ?? later;
        if (stored is null) return null;

        var storedDispatches = entries.Dispatches([stored.Id]).GetValueOrDefault(stored.Id) ?? [];
        EntryEntity merged;
        List<DispatchEntity> dispatches;
        List<string> changes;
        if (earlier is not null && importedBefore)
        {
            var last = carried.Rows.GetValueOrDefault(earlier.Id);
            var update = EntryUpdater.Update(earlier, storedDispatches, row, last, last is not null, newParty, newFinish);
            (merged, dispatches, changes) = (update.Entry, update.Dispatches, update.Changes);
            if (update.Kept.Count > 0) kept.Add(new ImportIssue(row.Row, $"{Slip(earlier)}: {string.Join("; ", update.Kept)}."));
        }
        else
        {
            (merged, dispatches, changes) = CarryoverMerger.Merge(stored, storedDispatches, row);
            // An adopted carryover becomes this month's own entry; saving its changes must not put it back in the later month.
            if (later is not null) merged = merged with { RegisterMonth = month, CarriedOver = false };
        }
        var slip = $"INW. NO. {row.InwardNo} of {row.Date}";
        if (earlier is not null)
        {
            if (!row.AfterBlankRows) warnings.Add(new ImportIssue(row.Row, $"{slip} is already in the {earlier.RegisterMonth} register; treated as a carryover."));
            warnings.Add(new ImportIssue(row.Row, changes.Count == 0
                ? $"{slip} matches the {earlier.RegisterMonth} entry; nothing new."
                : $"{slip} updates the {earlier.RegisterMonth} entry: {string.Join("; ", changes)}."));
        }
        else
        {
            warnings.Add(new ImportIssue(row.Row, $"{slip} was already brought in as a carryover in {later!.RegisterMonth}; it moves to this month{(changes.Count > 0 ? ": " + string.Join("; ", changes) : string.Empty)}."));
        }
        if (changes.Any(c => c.StartsWith("THAN", StringComparison.Ordinal) || c.StartsWith("FINISH", StringComparison.Ordinal) || c.StartsWith("REP.", StringComparison.Ordinal)))
            WarnIfBilled(stored, row.Row, slip, warnings);
        // An earlier month's entry this row changes, and a later month's carryover moved here, are entries the import updates.
        var changed = changes.Count > 0;
        if (later is not null) changes.Insert(0, $"moved here from the {later.RegisterMonth} register");
        if (changes.Count > 0)
        {
            updated.Add(new ImportIssue(row.Row, earlier is not null
                ? $"{Slip(earlier)}, {earlier.RegisterMonth} register: {string.Join("; ", changes)}."
                : $"{Slip(later!)}: {string.Join("; ", changes)}."));
        }
        return new RowPlan(row, earlier is not null ? RowAction.MergeIntoEarlier : RowAction.AdoptLaterCarryover, merged, dispatches, changed) { Changes = changes, Before = stored, BeforeDispatches = storedDispatches };
    }

    private static void WarnIfBilled(EntryEntity entry, int row, string slip, List<ImportIssue> warnings)
    {
        if (entry.Bill is not null)
            warnings.Add(new ImportIssue(row, $"{slip} is already on bill {entry.Bill}; that bill is not changed."));
        else if (entry.Elsewhere is not null)
            warnings.Add(new ImportIssue(row, $"{slip} is marked as billed outside the app; check that the mark still fits."));
    }

    private static Dictionary<long, SourceValues> Parse(IReadOnlyList<EntrySource> stored)
    {
        var rows = new Dictionary<long, SourceValues>();
        foreach (var s in stored)
        {
            if (SourceValues.FromJson(s.SourceValues) is { } values) rows[s.Id] = values;
        }
        return rows;
    }

    private static string Slip(EntryEntity entry) => $"INW. NO. {entry.InwardNo} of {entry.EntryDate} ({entry.Party})";

    /// <summary>The month's carryover rows as last imported, by the earlier entry they belong to and by their slip.</summary>
    private sealed class CarriedRows(Dictionary<long, SourceValues> rows)
    {
        private readonly Dictionary<string, long> bySlip = rows
            .GroupBy(r => SavedEntryMatcher.Slip(r.Value.InwardNo, r.Value.Date, r.Value.Party), StringComparer.Ordinal)
            .Where(g => g.Count() == 1)
            .ToDictionary(g => g.Key, g => g.Single().Key, StringComparer.Ordinal);

        public Dictionary<long, SourceValues> Rows => rows;

        public long? EntryFor(InwardRow row) => bySlip.TryGetValue(SavedEntryMatcher.Slip(row.InwardNo, row.Date, row.Party), out var id) ? id : null;
    }

    /// <summary>
    /// A carryover row whose date was typed differently from the original slip (08.06 for 13.06): same party, INW. NO. and THAN,
    /// the same lot or design, dated within <see cref="CarryoverDateSlipDays"/> days. Without this it would be stored a second time.
    /// </summary>
    private EntryEntity? SameSlipOtherDate(InwardRow row, string month, List<ImportIssue> warnings)
    {
        if (!row.AfterBlankRows || !Dates.TryParseIso(row.Date, out var date)) return null;
        var near = entries.FindEarlierNear(row.Party, row.InwardNo, month, Dates.Iso(date.AddDays(-CarryoverDateSlipDays)), Dates.Iso(date.AddDays(CarryoverDateSlipDays)))
            .Where(e => e.Than == row.Than && (SameText(e.LotNo, row.Lot) || SameText(e.DesignNo, row.Design)))
            .ToList();
        if (near.Count != 1) return null;
        warnings.Add(new ImportIssue(row.Row, $"INW. NO. {row.InwardNo} of {row.Date} matches the {near[0].RegisterMonth} slip dated {near[0].EntryDate} in everything but the date; treated as the same slip (the {near[0].RegisterMonth} date is kept)."));
        return near[0];
    }

    private static bool SameText(string a, string b) => a.Trim().Length > 0 && string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);

    private (List<InwardRow> Rows, List<string> AddedParties, List<string> AddedFinishes) UseMasterSpelling(IReadOnlyList<InwardRow> rows, List<ImportIssue> warnings)
    {
        var current = config.Current;
        var knownParties = current.Parties.ToDictionary(p => p.Name, p => p.Name, StringComparer.OrdinalIgnoreCase);
        var knownFinishes = current.Finishes.ToDictionary(f => f.Name, f => f.Name, StringComparer.OrdinalIgnoreCase);
        var addedParties = new List<string>();
        var addedFinishes = new List<string>();
        var result = new List<InwardRow>(rows.Count);
        foreach (var row in rows)
        {
            if (!knownParties.TryGetValue(row.Party, out var party))
            {
                knownParties[row.Party] = party = row.Party;
                addedParties.Add(party);
                warnings.Add(new ImportIssue(row.Row, $"Party \"{party}\" was not in the party list; it will be added as inactive."));
            }
            var finish = row.Finish;
            if (finish.Length > 0)
            {
                if (knownFinishes.TryGetValue(row.Finish, out var knownFinish))
                {
                    finish = knownFinish;
                }
                else
                {
                    knownFinishes[row.Finish] = row.Finish;
                    addedFinishes.Add(row.Finish);
                    warnings.Add(new ImportIssue(row.Row, $"Finish \"{row.Finish}\" was not in the finish list; it will be added as inactive."));
                }
            }
            result.Add(row with { Party = party, Finish = finish });
        }
        return (result, addedParties, addedFinishes);
    }

    private static EntryEntity ToEntity(InwardRow row, string month) => new()
    {
        RegisterMonth = month,
        InwardNo = row.InwardNo,
        EntryDate = row.Date,
        Party = row.Party,
        DesignNo = row.Design,
        LotNo = row.Lot,
        Repair = row.Repair,
        Than = row.Than,
        Tp = row.Tp,
        TwoPart = row.TwoPart,
        Finish = row.Finish,
        ShortThan = row.ShortThan,
        CarriedOver = row.AfterBlankRows,
        SourceRow = row.Row,
    };

    private static List<DispatchEntity> ToDispatches(InwardRow row) => row.Dispatches
        .Select(d => new DispatchEntity { Qty = d.Qty, GatePass = d.GatePass, DispatchDate = d.Date, DateText = d.DateText })
        .ToList();

    /// <summary>What importing does: <c>Saved</c> entries were in the month, <c>Typed</c> ones were entered in the app and stay.</summary>
    private sealed record MonthPlan(int Saved, List<RowPlan> Rows, List<EntryEntity> Removals, List<EntryEntity> Typed, List<ImportIssue> Changes, List<ImportIssue> Kept);

}
