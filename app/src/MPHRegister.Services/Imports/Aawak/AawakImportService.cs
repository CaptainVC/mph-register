using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using MPHRegister.Contracts.Arrivals;
using MPHRegister.Contracts.Imports;
using MPHRegister.Data.Config;
using MPHRegister.Data.Database;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Services.Arrivals;
using MPHRegister.Services.Interfaces;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Helpers;
using MPHRegister.Shared.Json;

namespace MPHRegister.Services.Imports.Aawak;

/// <summary>
/// Checks (and with commit saves) a month's AAWAK workbook, as often as the gate clerk sends a newer copy. Rows are matched by
/// AAWAK NO: new rows are added, what the workbook changed since the last import is applied, what was changed in the app is
/// kept, rows deleted in the app stay deleted and imported rows the workbook no longer has are removed. Afterwards the rows
/// are linked to their inward slips.
/// </summary>
public sealed class AawakImportService(
    IDbSession session,
    IBackupService backups,
    IArrivalRepository arrivals,
    IConfigStore config,
    ArrivalLinker linker,
    ArrivalReader reader,
    TimeProvider clock) : IAawakImportService
{
    private const int CloseSpelling = 2;

    private enum Action
    {
        Insert,
        Update,
        Unchanged,
        Adopt,
        KeepTyped,
        KeepDeleted,
    }

    private sealed record RowPlan(AawakRow Row, Action Action, ArrivalEntity Arrival, Source Source, List<string> Changes, bool Conflict = false);

    /// <summary>What the workbook row says, kept with the arrival so the next import knows what changed in the workbook.</summary>
    private sealed record Source(string Date, string Party, int Nag, string Transporter, string InwardText, string Note)
    {
        public string ToJson() => JsonSerializer.Serialize(this, JsonDefaults.Options);

        public static Source? FromJson(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return null;
            try
            {
                return JsonSerializer.Deserialize<Source>(json, JsonDefaults.Options);
            }
            catch (JsonException)
            {
                return null;
            }
        }

        public static Source Of(ArrivalEntity a) => new(a.ArrivalDate, a.Party, a.Nag, a.Transporter, a.InwardText, a.Note);
    }

    public AawakImportReport Import(string filePath, string fileName, string? month, bool commit, bool applyGroups)
    {
        ArgumentNullException.ThrowIfNull(filePath);
        ArgumentNullException.ThrowIfNull(fileName);
        var target = string.IsNullOrWhiteSpace(month) ? RegisterFileName.GuessMonth(fileName) ?? string.Empty : month.Trim();
        var warnings = new List<ImportIssue>();
        var errors = new List<ImportIssue>();
        if (!Dates.IsValidMonth(target)) errors.Add(new ImportIssue(0, "AAWAK month is missing or invalid. Choose the month of the workbook."));
        var hash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(filePath)));

        AawakSheet sheet;
        try
        {
            sheet = AawakSheetReader.Read(filePath);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            sheet = new AawakSheet([], AawakDetails.Empty, [], [new ImportIssue(0, $"Could not read the workbook: {ex.Message}")]);
        }
        warnings.AddRange(sheet.Warnings);
        errors.AddRange(sheet.Errors);
        if (errors.Count == 0 && arrivals.FileByHash(hash) is { } previous)
            errors.Add(new ImportIssue(0, $"This exact file was already imported (as \"{previous}\")."));
        foreach (var row in sheet.Rows.Where(r => Dates.IsValidMonth(target) && !r.Date.StartsWith(target, StringComparison.Ordinal)))
            warnings.Add(new ImportIssue(row.Row, $"DATE {row.Date} is not in the AAWAK month; the row is kept in {target}."));

        var current = config.Current;
        var index = ConfigIndex.For(current);
        var (rows, addedParties, addedTransporters) = UseMasterSpelling(sheet, index, warnings);
        var groups = GroupProposals(sheet.Details, index, applyGroups && commit);
        var plans = errors.Count == 0 ? Plan(rows, target, warnings) : [];
        var existing = errors.Count == 0 ? arrivals.List(target) : [];
        var keys = rows.Select(r => r.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var removals = existing.Where(a => a.ImportBatchId is not null && !keys.Contains(AawakNumber.Format(a.AawakNo, a.AawakSuffix))).ToList();
        var changes = plans.Where(p => p.Action == Action.Update).Select(p => new ImportIssue(p.Row.Row, $"AAWAK NO {p.Row.Key}: {string.Join("; ", p.Changes)}.")).ToList();
        var kept = plans.Where(p => p.Action == Action.KeepTyped || p.Conflict)
            .Select(p => new ImportIssue(p.Row.Row, $"AAWAK NO {p.Row.Key} was typed or changed in the app and differs from the workbook; the app's row is kept.")).ToList();
        var notInWorkbook = removals.Select(a => new ImportIssue(0, $"AAWAK NO {AawakNumber.Format(a.AawakNo, a.AawakSuffix)} ({a.Party}, {a.ArrivalDate}) {(commit && errors.Count == 0 ? "was" : "will be")} removed: the workbook no longer has it.")).ToList();
        var upToDate = errors.Count == 0 && existing.Count > 0 && removals.Count == 0
            && plans.All(p => p.Action is Action.Unchanged or Action.KeepDeleted or Action.KeepTyped);

        var imported = false;
        ArrivalLinkSummary? links = null;
        if (commit && errors.Count == 0 && (!upToDate || groups.Any(g => g.Applied)))
        {
            backups.Backup(session.Connection, "before-aawak-import");
            config.Backup("before-aawak-import");
            var touched = new List<long>();
            using (var unit = session.Begin())
            {
                var now = Dates.Timestamp(clock.GetLocalNow());
                var batchId = arrivals.AddBatch(new ArrivalImportBatchEntity
                {
                    FileName = fileName, Sha256 = hash, AawakMonth = target, ImportedAt = now, ArrivalCount = plans.Count(p => p.Action == Action.Insert),
                });
                var marks = new List<ArrivalImportMarkEntity>();
                foreach (var plan in plans)
                {
                    var source = plan.Source.ToJson();
                    switch (plan.Action)
                    {
                        case Action.Insert:
                            var id = arrivals.Insert(plan.Arrival with { ImportBatchId = batchId, SourceRow = plan.Row.Row, SourceValues = source, CreatedAt = now, UpdatedAt = now });
                            touched.Add(id);
                            marks.Add(Mark(batchId, id, "added", plan));
                            break;
                        case Action.Update:
                            if (plan.Changes.Count > 0)
                            {
                                arrivals.Update(plan.Arrival with { UpdatedAt = now });
                                touched.Add(plan.Arrival.Id);
                                marks.Add(Mark(batchId, plan.Arrival.Id, "updated", plan));
                            }
                            arrivals.MarkImported(plan.Arrival.Id, batchId, plan.Row.Row, source);
                            break;
                        case Action.Unchanged:
                        case Action.Adopt:
                        case Action.KeepTyped:
                            arrivals.MarkImported(plan.Arrival.Id, batchId, plan.Row.Row, source);
                            break;
                        default:
                            break;
                    }
                }
                foreach (var removed in removals) arrivals.Remove(removed.Id);
                arrivals.AddMarks(marks);
                unit.Commit();
            }
            AddNames(addedParties, addedTransporters, sheet.Details, groups);
            using (var unit = session.Begin())
            {
                linker.Link(arrivals.ByIds(touched));
                linker.Shares(arrivals.AllLinks().Select(l => l.EntryId).Distinct().ToList());
                unit.Commit();
            }
            imported = true;
            links = ArrivalReader.Summary(reader.Read(arrivals.List(target)));
        }

        return new AawakImportReport(imported, fileName, target, rows.Count, rows.Sum(r => r.Nag),
            plans.Count(p => p.Action == Action.Insert), plans.Count(p => p.Action == Action.Update && p.Changes.Count > 0),
            plans.Count(p => p.Action is Action.Unchanged or Action.Adopt), removals.Count, plans.Count(p => p.Action == Action.KeepDeleted),
            plans.Count(p => p.Action == Action.KeepTyped), upToDate, addedParties, addedTransporters, groups, changes, kept, notInWorkbook, warnings, errors, links);
    }

    private List<RowPlan> Plan(IReadOnlyList<AawakRow> rows, string month, List<ImportIssue> warnings)
    {
        var existing = arrivals.List(month).ToDictionary(a => AawakNumber.Format(a.AawakNo, a.AawakSuffix), StringComparer.OrdinalIgnoreCase);
        var deleted = arrivals.DeletedInMonth(month).Select(d => AawakNumber.Format(d.AawakNo, d.AawakSuffix)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var plans = new List<RowPlan>();
        foreach (var row in rows)
        {
            var source = SourceOf(row, warnings);
            var fresh = new ArrivalEntity
            {
                AawakMonth = month, AawakNo = row.Number, AawakSuffix = row.Suffix, ArrivalDate = source.Date, Party = source.Party, Nag = source.Nag,
                Transporter = source.Transporter, InwardText = source.InwardText, Note = source.Note,
            };
            if (!existing.TryGetValue(row.Key, out var saved))
            {
                plans.Add(new RowPlan(row, deleted.Contains(row.Key) ? Action.KeepDeleted : Action.Insert, fresh, source, []));
                continue;
            }
            var now = Source.Of(saved);
            var last = Source.FromJson(saved.SourceValues);
            if (last is null)
            {
                plans.Add(new RowPlan(row, now == source ? Action.Adopt : Action.KeepTyped, saved, source, []));
                continue;
            }
            if (last == source)
            {
                plans.Add(new RowPlan(row, Action.Unchanged, saved, source, []));
                continue;
            }
            // Fields the workbook changed since the last import take the workbook's value unless they were also changed in the app.
            var changes = new List<string>();
            var updated = saved;
            void Field<T>(string name, T was, T app, T workbook, Func<ArrivalEntity, ArrivalEntity> apply)
            {
                if (EqualityComparer<T>.Default.Equals(was, workbook) || EqualityComparer<T>.Default.Equals(app, workbook)) return;
                if (!EqualityComparer<T>.Default.Equals(app, was)) return;
                updated = apply(updated);
                changes.Add(string.Create(CultureInfo.InvariantCulture, $"{name} {app} → {workbook}"));
            }
            Field("DATE", last.Date, now.Date, source.Date, a => a with { ArrivalDate = source.Date });
            Field("PARTY", last.Party, now.Party, source.Party, a => a with { Party = source.Party });
            Field("NAG", last.Nag, now.Nag, source.Nag, a => a with { Nag = source.Nag });
            Field("LORRY WALA", last.Transporter, now.Transporter, source.Transporter, a => a with { Transporter = source.Transporter });
            Field("INW NO", last.InwardText, now.InwardText, source.InwardText, a => a with { InwardText = source.InwardText });
            Field("COMMENTS", last.Note, now.Note, source.Note, a => a with { Note = source.Note });
            var conflict = Source.Of(updated) != source;
            plans.Add(new RowPlan(row, changes.Count == 0 && conflict ? Action.KeepTyped : Action.Update, updated, source, changes, conflict));
        }
        return plans;
    }

    /// <summary>INW NO and COMMENTS become the slip numbers as written and a note with the rest of COMMENTS.</summary>
    private static Source SourceOf(AawakRow row, List<ImportIssue> warnings)
    {
        var read = InwardNumbers.Read(row.Comments);
        string inwardText;
        var note = read.Note;
        if (read.Numbers.Count > 0)
        {
            inwardText = read.NumbersText;
            if (row.InwardNo > 0 && !read.Readings.Any(r => r.Contains(row.InwardNo)))
                warnings.Add(new ImportIssue(row.Row, string.Create(CultureInfo.InvariantCulture, $"INW NO {row.InwardNo} is not among the slips in COMMENTS ({read.NumbersText}); COMMENTS are used.")));
        }
        else
        {
            inwardText = row.InwardNo > 0 ? row.InwardNo.ToString(CultureInfo.InvariantCulture) : string.Empty;
            note = row.Comments;
        }
        return new Source(row.Date, row.Party, row.Nag, row.Transporter, inwardText, note);
    }

    private static ArrivalImportMarkEntity Mark(long batchId, long arrivalId, string action, RowPlan plan) => new()
    {
        BatchId = batchId, ArrivalId = arrivalId, Action = action, SourceRow = plan.Row.Row, Changes = string.Join("; ", plan.Changes),
    };

    private static (List<AawakRow> Rows, List<string> AddedParties, List<string> AddedTransporters) UseMasterSpelling(AawakSheet sheet, ConfigIndex index, List<ImportIssue> warnings)
    {
        var addedParties = new List<string>();
        var addedTransporters = new List<string>();
        var rows = new List<AawakRow>();
        foreach (var row in sheet.Rows)
        {
            var party = index.Party(row.Party)?.Name ?? addedParties.FirstOrDefault(p => Same(p, row.Party));
            if (party is null)
            {
                party = row.Party;
                addedParties.Add(party);
                warnings.Add(new ImportIssue(row.Row, $"Party \"{party}\" was not in the party list; it will be added as inactive."));
            }
            var transporter = index.Transporter(row.Transporter)?.Name ?? addedTransporters.FirstOrDefault(t => Same(t, row.Transporter));
            if (transporter is null)
            {
                transporter = row.Transporter;
                addedTransporters.Add(transporter);
                var close = index.Config.Transporters.Select(t => t.Name).FirstOrDefault(t => Distance(t, transporter) <= CloseSpelling);
                warnings.Add(new ImportIssue(row.Row, close is null
                    ? $"Lorry wala \"{transporter}\" was not in the list; it will be added."
                    : $"Lorry wala \"{transporter}\" was not in the list; it will be added. It looks like \"{close}\": if it is the same, rename it to \"{close}\" in Masters → Lorry walas to merge the two."));
            }
            rows.Add(row with { Party = party, Transporter = transporter });
        }
        return (rows, addedParties, addedTransporters);
    }

    /// <summary>The workbook's party groups, for parties that have no sister-firm group in the app yet.</summary>
    private static List<GroupProposal> GroupProposals(AawakDetails details, ConfigIndex index, bool apply)
    {
        var proposals = new List<GroupProposal>();
        foreach (var (name, (_, group)) in details.Parties.Where(p => p.Value.Group.Length > 0).OrderBy(p => p.Value.Group, StringComparer.OrdinalIgnoreCase).ThenBy(p => p.Key, StringComparer.OrdinalIgnoreCase))
        {
            var party = index.Party(name);
            if (party is null) continue;
            if (party.SisterGroup.Length > 0)
            {
                if (!Same(party.SisterGroup, group)) proposals.Add(new GroupProposal(party.Name, group, party.SisterGroup, false));
                continue;
            }
            proposals.Add(new GroupProposal(party.Name, group, string.Empty, apply));
        }
        return proposals;
    }

    /// <summary>After the rows are saved: new parties (inactive), new lorry walas and ticked party groups go into the config file.</summary>
    private void AddNames(List<string> parties, List<string> transporters, AawakDetails details, List<GroupProposal> groups)
    {
        var assign = groups.Where(g => g.Applied).ToDictionary(g => g.Party, g => g.Group, StringComparer.OrdinalIgnoreCase);
        if (parties.Count == 0 && transporters.Count == 0 && assign.Count == 0) return;
        config.Update(c =>
        {
            var index = ConfigIndex.For(c);
            var style = index.FallbackStyle.Name;
            return c with
            {
                Parties = [.. c.Parties.Select(p => assign.TryGetValue(p.Name, out var g) && p.SisterGroup.Length == 0 ? p with { SisterGroup = g } : p),
                    .. parties.Where(p => index.Party(p) is null).Select(p => new PartyConfig { Name = p, Active = false, BillingStyle = style })],
                Transporters = [.. c.Transporters, .. transporters.Where(t => index.Transporter(t) is null)
                    .Select(t => new TransporterConfig { Name = t, Active = !details.Transporters.TryGetValue(t, out var active) || active })],
            };
        });
    }

    private static bool Same(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

    /// <summary>Edits between two names (case ignored), to point out a likely misspelling.</summary>
    private static int Distance(string a, string b)
    {
        a = a.ToUpperInvariant();
        b = b.ToUpperInvariant();
        var row = Enumerable.Range(0, b.Length + 1).ToArray();
        for (var i = 1; i <= a.Length; i++)
        {
            var previous = row[0];
            row[0] = i;
            for (var j = 1; j <= b.Length; j++)
            {
                var keep = row[j];
                row[j] = Math.Min(Math.Min(row[j] + 1, row[j - 1] + 1), previous + (a[i - 1] == b[j - 1] ? 0 : 1));
                previous = keep;
            }
        }
        return row[b.Length];
    }
}
