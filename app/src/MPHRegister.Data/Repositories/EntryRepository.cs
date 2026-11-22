using MPHRegister.Data.Database;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;

namespace MPHRegister.Data.Repositories;

public sealed class EntryRepository(IDbSession session) : RepositoryBase(session), IEntryRepository
{
    private const int InListLimit = 500;

    private const string Select = """
        SELECT e.id, e.register_month, e.inward_no, e.entry_date, e.party, e.design_no, e.lot_no, e.repair, e.than, e.tp,
            e.two_part, e.finish, e.short_than, e.carried_over, e.import_batch_id, e.source_row, e.created_at, e.updated_at,
            (SELECT group_concat(i.invoice_no, ', ') FROM invoice_entries ie JOIN invoices i ON i.id = ie.invoice_id
             WHERE ie.entry_id = e.id AND i.status = 'saved') AS bill,
            (SELECT note FROM billed_elsewhere b WHERE b.entry_id = e.id) AS elsewhere
        FROM entries e
        """;

    private const string NotBilled = """
        NOT EXISTS (SELECT 1 FROM invoice_entries ie JOIN invoices i ON i.id = ie.invoice_id WHERE ie.entry_id = e.id AND i.status = 'saved')
        AND NOT EXISTS (SELECT 1 FROM billed_elsewhere b WHERE b.entry_id = e.id)
        """;

    public IReadOnlyList<EntryEntity> List(string? month) => month is null
        ? Query<EntryEntity>($"{Select} ORDER BY e.id;")
        : Query<EntryEntity>($"{Select} WHERE e.register_month = @month ORDER BY e.id;", new { month });

    public IReadOnlyList<EntryEntity> Recent(int limit) =>
        Query<EntryEntity>($"{Select} WHERE e.import_batch_id IS NULL ORDER BY e.id DESC LIMIT @limit;", new { limit });

    public EntryEntity? Get(long id) => First<EntryEntity>($"{Select} WHERE e.id = @id;", new { id });

    public IReadOnlyList<EntryEntity> ByIds(IReadOnlyCollection<long> ids) => ids.Count == 0
        ? []
        : Query<EntryEntity>($"{Select} WHERE e.id IN @ids ORDER BY e.id;", new { ids });

    public IReadOnlyList<EntryEntity> Unbilled(IReadOnlyList<string> parties, string? uptoMonth) => Query<EntryEntity>(
        $"""
        {Select}
        WHERE e.party COLLATE NOCASE IN @parties AND e.repair = 0 AND e.than > 0
          AND (@uptoMonth IS NULL OR e.register_month <= @uptoMonth)
          AND {NotBilled}
        ORDER BY e.register_month, e.carried_over DESC, e.inward_no, e.id;
        """,
        new { parties, uptoMonth });

    public IReadOnlyList<EntryEntity> UnbilledBetween(IReadOnlyList<string> parties, string from, string to) => Query<EntryEntity>(
        $"""
        {Select}
        WHERE e.party COLLATE NOCASE IN @parties AND e.repair = 0 AND e.than > 0
          AND e.entry_date BETWEEN @from AND @to
          AND {NotBilled}
        ORDER BY e.register_month, e.carried_over DESC, e.inward_no, e.id;
        """,
        new { parties, from, to });

    public IReadOnlyList<EntryEntity> UnbilledAnyParty(string from, string to) => Query<EntryEntity>(
        $"""
        {Select}
        WHERE e.repair = 0 AND e.than > 0 AND e.entry_date BETWEEN @from AND @to AND {NotBilled}
        ORDER BY e.register_month, e.carried_over DESC, e.inward_no, e.id;
        """,
        new { from, to });

    public IReadOnlySet<long> OnAppBills() => Query<long>(
        """
        SELECT DISTINCT ie.entry_id FROM invoice_entries ie JOIN invoices i ON i.id = ie.invoice_id
        WHERE i.status = 'saved' AND i.source = 'app';
        """).ToHashSet();

    public IReadOnlyList<EntryEntity> Billed(IReadOnlyList<string> parties, string? uptoMonth) => Query<EntryEntity>(
        $"""
        {Select}
        WHERE e.party COLLATE NOCASE IN @parties AND (@uptoMonth IS NULL OR e.register_month <= @uptoMonth)
          AND NOT ({NotBilled})
        ORDER BY e.id;
        """,
        new { parties, uptoMonth });

    public EntryEntity? FindEarlier(string party, string entryDate, int inwardNo, string beforeMonth) => First<EntryEntity>(
        $"""
        {Select}
        WHERE e.party = @party COLLATE NOCASE AND e.entry_date = @entryDate AND e.inward_no = @inwardNo AND e.register_month < @beforeMonth
        ORDER BY e.register_month DESC, e.id DESC LIMIT 1;
        """,
        new { party, entryDate, inwardNo, beforeMonth });

    public IReadOnlyList<EntryEntity> FindEarlierNear(string party, int inwardNo, string beforeMonth, string from, string to) => Query<EntryEntity>(
        $"""
        {Select}
        WHERE e.party = @party COLLATE NOCASE AND e.inward_no = @inwardNo AND e.register_month < @beforeMonth
          AND e.entry_date BETWEEN @from AND @to
        ORDER BY e.register_month DESC, e.id DESC;
        """,
        new { party, inwardNo, beforeMonth, from, to });

    public EntryEntity? FindLaterCarryover(string party, string entryDate, int inwardNo, string afterMonth) => First<EntryEntity>(
        $"""
        {Select}
        WHERE e.party = @party COLLATE NOCASE AND e.entry_date = @entryDate AND e.inward_no = @inwardNo
          AND e.register_month > @afterMonth AND e.carried_over = 1
        ORDER BY e.register_month, e.id LIMIT 1;
        """,
        new { party, entryDate, inwardNo, afterMonth });

    public void MoveToMonth(long id, string month, long importBatchId, int sourceRow, string sourceValues) => Execute(
        """
        INSERT OR REPLACE INTO carryover_sources(entry_id, register_month, source_values)
        SELECT id, register_month, source_values FROM entries WHERE id = @id AND source_values IS NOT NULL AND register_month <> @month;
        UPDATE entries SET register_month = @month, carried_over = 0, import_batch_id = @importBatchId, source_row = @sourceRow,
            source_values = @sourceValues
        WHERE id = @id;
        """,
        new { id, month, importBatchId, sourceRow, sourceValues });

    public IReadOnlyList<EntrySource> SourceValues(string month) => Query<EntrySource>(
        "SELECT id, source_values FROM entries WHERE register_month = @month AND source_values IS NOT NULL;",
        new { month });

    public void MarkImported(long id, long importBatchId, int sourceRow, string sourceValues) => Execute(
        "UPDATE entries SET import_batch_id = @importBatchId, source_row = @sourceRow, source_values = @sourceValues WHERE id = @id;",
        new { id, importBatchId, sourceRow, sourceValues });

    public IReadOnlyList<EntrySource> CarryoverSources(string month) => Query<EntrySource>(
        "SELECT entry_id AS id, source_values FROM carryover_sources WHERE register_month = @month;",
        new { month });

    public IReadOnlyList<long> EarlierByImportedSlip(string party, string entryDate, int inwardNo, string beforeMonth) => Query<long>(
        """
        SELECT e.id FROM entries e
        WHERE e.register_month < @beforeMonth AND (
            (json_extract(e.source_values, '$.inwardNo') = @inwardNo AND json_extract(e.source_values, '$.date') = @entryDate
             AND json_extract(e.source_values, '$.party') = @party COLLATE NOCASE)
            OR EXISTS (SELECT 1 FROM carryover_sources c WHERE c.entry_id = e.id
                AND json_extract(c.source_values, '$.inwardNo') = @inwardNo AND json_extract(c.source_values, '$.date') = @entryDate
                AND json_extract(c.source_values, '$.party') = @party COLLATE NOCASE));
        """,
        new { party, entryDate, inwardNo, beforeMonth });

    public void SaveCarryoverSource(long entryId, string month, string sourceValues) => Execute(
        "INSERT OR REPLACE INTO carryover_sources(entry_id, register_month, source_values) VALUES (@entryId, @month, @sourceValues);",
        new { entryId, month, sourceValues });

    public void Delete(long id) => Execute("DELETE FROM entries WHERE id = @id;", new { id });

    private const string DeletedColumns = """
        id, register_month, inward_no, entry_date, party, design_no, lot_no, repair, than, tp, two_part, finish, short_than,
        carried_over, import_batch_id, source_values, dispatches, carryover_sources, deleted_at
        """;

    public void MoveToDeleted(long id, string at) => Execute(
        """
        INSERT INTO deleted_entries(id, register_month, inward_no, entry_date, party, design_no, lot_no, repair, than, tp, two_part,
            finish, short_than, carried_over, import_batch_id, source_row, source_values, created_at, updated_at, dispatches,
            carryover_sources, deleted_at)
        SELECT e.id, e.register_month, e.inward_no, e.entry_date, e.party, e.design_no, e.lot_no, e.repair, e.than, e.tp, e.two_part,
            e.finish, e.short_than, e.carried_over, e.import_batch_id, e.source_row, e.source_values, e.created_at, e.updated_at,
            (SELECT json_group_array(json_object('seq', d.seq, 'qty', d.qty, 'gatePass', d.gate_pass, 'dispatchDate', d.dispatch_date,
                'dateText', d.date_text)) FROM (SELECT * FROM dispatches WHERE entry_id = e.id ORDER BY seq) d),
            (SELECT json_group_array(json_object('registerMonth', c.register_month, 'sourceValues', c.source_values))
             FROM carryover_sources c WHERE c.entry_id = e.id),
            @at
        FROM entries e WHERE e.id = @id;
        DELETE FROM entries WHERE id = @id;
        """,
        new { id, at });

    public void RestoreDeleted(long id) => Execute(
        """
        INSERT INTO entries(id, register_month, inward_no, entry_date, party, design_no, lot_no, repair, than, tp, two_part, finish,
            short_than, carried_over, import_batch_id, source_row, source_values, created_at, updated_at)
        SELECT id, register_month, inward_no, entry_date, party, design_no, lot_no, repair, than, tp, two_part, finish,
            short_than, carried_over, import_batch_id, source_row, source_values, created_at, updated_at
        FROM deleted_entries WHERE id = @id;
        INSERT INTO dispatches(entry_id, seq, qty, gate_pass, dispatch_date, date_text)
        SELECT x.id, json_extract(j.value, '$.seq'), json_extract(j.value, '$.qty'), COALESCE(json_extract(j.value, '$.gatePass'), ''),
            json_extract(j.value, '$.dispatchDate'), json_extract(j.value, '$.dateText')
        FROM deleted_entries x, json_each(x.dispatches) j WHERE x.id = @id ORDER BY CAST(j.key AS INTEGER);
        INSERT INTO carryover_sources(entry_id, register_month, source_values)
        SELECT x.id, json_extract(j.value, '$.registerMonth'), json_extract(j.value, '$.sourceValues')
        FROM deleted_entries x, json_each(x.carryover_sources) j WHERE x.id = @id;
        DELETE FROM deleted_entries WHERE id = @id;
        """,
        new { id });

    public IReadOnlyList<DeletedEntryEntity> Deleted() =>
        Query<DeletedEntryEntity>($"SELECT {DeletedColumns} FROM deleted_entries ORDER BY deleted_at DESC, id DESC;");

    public DeletedEntryEntity? GetDeleted(long id) =>
        First<DeletedEntryEntity>($"SELECT {DeletedColumns} FROM deleted_entries WHERE id = @id;", new { id });

    public IReadOnlyList<DeletedEntryEntity> DeletedUpTo(string month) =>
        Query<DeletedEntryEntity>($"SELECT {DeletedColumns} FROM deleted_entries WHERE register_month <= @month ORDER BY id;", new { month });

    public IReadOnlyList<EntryEntity> SameSlip(string month, int inwardNo, string entryDate, string party, bool numberIsTaken) => Query<EntryEntity>(
        $"""
        {Select}
        WHERE (@numberIsTaken AND e.register_month = @month AND e.inward_no = @inwardNo AND e.carried_over = 0)
           OR (@inwardNo > 0 AND e.inward_no = @inwardNo AND e.entry_date = @entryDate AND e.party = @party COLLATE NOCASE)
        ORDER BY e.register_month, e.inward_no, e.id;
        """,
        new { month, inwardNo, entryDate, party, numberIsTaken });

    public IReadOnlyList<EntryEntity> SameContent(string month, string entryDate, string party, string designNo, string lotNo, int than) => Query<EntryEntity>(
        $"""
        {Select}
        WHERE e.register_month = @month AND e.entry_date = @entryDate AND e.party = @party COLLATE NOCASE AND e.than = @than
          AND e.design_no = @designNo COLLATE NOCASE AND e.lot_no = @lotNo COLLATE NOCASE
        ORDER BY e.inward_no, e.id;
        """,
        new { month, entryDate, party, designNo, lotNo, than });

    public IReadOnlyList<string> CancelledBillsWith(long id) => Query<string>(
        """
        SELECT i.invoice_no FROM invoices i
        WHERE i.status = 'cancelled'
          AND EXISTS (SELECT 1 FROM invoice_lines l, json_each(l.entry_ids) j WHERE l.invoice_id = i.id AND j.value = @id)
        ORDER BY i.fy, i.serial;
        """,
        new { id });

    public IReadOnlyDictionary<long, List<DispatchEntity>> Dispatches(IReadOnlyCollection<long> entryIds)
    {
        var result = new Dictionary<long, List<DispatchEntity>>();
        if (entryIds.Count == 0) return result;
        const string Columns = "SELECT entry_id, seq, qty, gate_pass, dispatch_date, date_text FROM dispatches";
        var rows = entryIds.Count <= InListLimit
            ? Query<DispatchEntity>($"{Columns} WHERE entry_id IN @entryIds ORDER BY entry_id, seq;", new { entryIds })
            : Query<DispatchEntity>($"{Columns} ORDER BY entry_id, seq;");
        var wanted = entryIds as IReadOnlySet<long> ?? entryIds.ToHashSet();
        foreach (var row in rows)
        {
            if (!wanted.Contains(row.EntryId)) continue;
            if (!result.TryGetValue(row.EntryId, out var list)) result[row.EntryId] = list = [];
            list.Add(row);
        }
        return result;
    }

    public long Insert(EntryEntity entry) => Scalar<long>(
        """
        INSERT INTO entries(register_month, inward_no, entry_date, party, design_no, lot_no, repair, than, tp, two_part,
            finish, short_than, carried_over, import_batch_id, source_row, source_values, created_at, updated_at)
        VALUES (@RegisterMonth, @InwardNo, @EntryDate, @Party, @DesignNo, @LotNo, @Repair, @Than, @Tp, @TwoPart,
            @Finish, @ShortThan, @CarriedOver, @ImportBatchId, @SourceRow, @SourceValues, @CreatedAt, @UpdatedAt)
        RETURNING id;
        """,
        entry);

    public bool Update(EntryEntity entry) => Execute(
        """
        UPDATE entries SET register_month = @RegisterMonth, inward_no = @InwardNo, entry_date = @EntryDate, party = @Party,
            design_no = @DesignNo, lot_no = @LotNo, repair = @Repair, than = @Than, tp = @Tp, two_part = @TwoPart,
            finish = @Finish, short_than = @ShortThan, updated_at = @UpdatedAt
        WHERE id = @Id;
        """,
        entry) > 0;

    public void ReplaceDispatches(long entryId, IReadOnlyList<DispatchEntity> dispatches)
    {
        ArgumentNullException.ThrowIfNull(dispatches);
        Execute("DELETE FROM dispatches WHERE entry_id = @entryId;", new { entryId });
        var seq = 0;
        foreach (var d in dispatches)
        {
            Execute(
                """
                INSERT INTO dispatches(entry_id, seq, qty, gate_pass, dispatch_date, date_text)
                VALUES (@entryId, @seq, @Qty, @GatePass, @DispatchDate, @DateText);
                """,
                new { entryId, seq = ++seq, d.Qty, d.GatePass, d.DispatchDate, d.DateText });
        }
    }

    public IReadOnlySet<(string Month, int InwardNo)> DuplicateInwardNumbers() => Query<InwardKey>(
        """
        SELECT register_month, inward_no FROM entries WHERE carried_over = 0 AND inward_no > 0
        GROUP BY register_month, inward_no HAVING COUNT(*) > 1;
        """).Select(k => (k.RegisterMonth, k.InwardNo)).ToHashSet();

    public string? InwardNumberOwner(string month, int inwardNo, long? excludingId) => First<string>(
        """
        SELECT party FROM entries
        WHERE register_month = @month AND inward_no = @inwardNo AND carried_over = 0 AND id <> @id LIMIT 1;
        """,
        new { month, inwardNo, id = excludingId ?? -1 });

    public bool IsCarriedOver(long id) => Scalar<long?>("SELECT carried_over FROM entries WHERE id = @id;", new { id }) == 1;

    public int NextInwardNumber(string month) => Scalar<int>(
        "SELECT COALESCE(MAX(inward_no), 0) + 1 FROM entries WHERE register_month = @month AND carried_over = 0;",
        new { month });

    public IReadOnlyList<MonthCount> Months() => Query<MonthCount>(
        "SELECT register_month, COUNT(*) AS entries FROM entries GROUP BY register_month ORDER BY register_month DESC;");

    public long Count() => Scalar<long>("SELECT COUNT(*) FROM entries;");

    public IReadOnlyList<PartyToBillRow> PartiesToBill(string from, string to) => Query<PartyToBillRow>(
        $"""
        SELECT e.party AS party, COUNT(*) AS entries, SUM(e.than) AS nett_than,
            SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM dispatches d WHERE d.entry_id = e.id) THEN 1 ELSE 0 END) AS not_dispatched
        FROM entries e
        WHERE e.repair = 0 AND e.than > 0 AND e.entry_date BETWEEN @from AND @to AND {NotBilled}
        GROUP BY e.party COLLATE NOCASE ORDER BY e.party;
        """,
        new { from, to });

    public IReadOnlyList<string> DistinctParties() => Query<string>("SELECT DISTINCT party FROM entries ORDER BY party;");
}
