using MPHRegister.Data.Database;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;

namespace MPHRegister.Data.Repositories;

public sealed class ArrivalRepository(IDbSession session) : RepositoryBase(session), IArrivalRepository
{
    private const string Columns = """
        a.id, a.aawak_month, a.aawak_no, a.aawak_suffix, a.arrival_date, a.party, a.nag, a.transporter, a.inward_text, a.note,
        a.import_batch_id, a.source_row, a.source_values, a.created_at, a.updated_at
        """;

    private const string Order = "ORDER BY a.aawak_month, a.aawak_no, a.aawak_suffix, a.id";

    private const string SlipColumns = "e.id, e.register_month, e.inward_no, e.entry_date, e.party, e.than, e.tp, e.two_part, e.carried_over";

    private const string DeletedColumns = """
        id, aawak_month, aawak_no, aawak_suffix, arrival_date, party, nag, transporter, inward_text, note, import_batch_id,
        source_row, source_values, refs, links, created_at, updated_at, deleted_at
        """;

    public IReadOnlyList<ArrivalEntity> List(string? month) => month is null
        ? Query<ArrivalEntity>($"SELECT {Columns} FROM arrivals a {Order};")
        : Query<ArrivalEntity>($"SELECT {Columns} FROM arrivals a WHERE a.aawak_month = @month {Order};", new { month });

    public IReadOnlyList<ArrivalEntity> InMonths(string from, string to) =>
        Query<ArrivalEntity>($"SELECT {Columns} FROM arrivals a WHERE a.aawak_month BETWEEN @from AND @to {Order};", new { from, to });

    public IReadOnlyList<ArrivalEntity> Between(string from, string to) =>
        Query<ArrivalEntity>($"SELECT {Columns} FROM arrivals a WHERE a.arrival_date BETWEEN @from AND @to ORDER BY a.arrival_date, a.aawak_month, a.aawak_no, a.aawak_suffix, a.id;", new { from, to });

    public IReadOnlyList<ArrivalEntity> Recent(int limit) =>
        Query<ArrivalEntity>($"SELECT {Columns} FROM arrivals a WHERE a.import_batch_id IS NULL ORDER BY a.id DESC LIMIT @limit;", new { limit });

    public ArrivalEntity? Get(long id) => First<ArrivalEntity>($"SELECT {Columns} FROM arrivals a WHERE a.id = @id;", new { id });

    public IReadOnlyList<ArrivalEntity> ByIds(IReadOnlyCollection<long> ids) => ids.Count == 0
        ? []
        : Query<ArrivalEntity>($"SELECT {Columns} FROM arrivals a WHERE a.id IN (SELECT value FROM json_each(@ids)) {Order};", new { ids = Json(ids) });

    public ArrivalEntity? ByNumber(string month, int number, string suffix) => First<ArrivalEntity>(
        $"SELECT {Columns} FROM arrivals a WHERE a.aawak_month = @month AND a.aawak_no = @number AND a.aawak_suffix = @suffix COLLATE NOCASE;",
        new { month, number, suffix });

    public IReadOnlyList<AawakMonthCount> Months() =>
        Query<AawakMonthCount>("SELECT aawak_month, COUNT(*) AS arrivals FROM arrivals GROUP BY aawak_month ORDER BY aawak_month DESC;");

    public int NextNumber(string month) =>
        Scalar<int>("SELECT COALESCE(MAX(aawak_no), 0) + 1 FROM arrivals WHERE aawak_month = @month;", new { month });

    public string? EarliestDate() => Scalar<string?>("SELECT MIN(arrival_date) FROM arrivals;");

    public long Insert(ArrivalEntity arrival) => Scalar<long>(
        """
        INSERT INTO arrivals(aawak_month, aawak_no, aawak_suffix, arrival_date, party, nag, transporter, inward_text, note,
            import_batch_id, source_row, source_values, created_at, updated_at)
        VALUES (@AawakMonth, @AawakNo, @AawakSuffix, @ArrivalDate, @Party, @Nag, @Transporter, @InwardText, @Note,
            @ImportBatchId, @SourceRow, @SourceValues, @CreatedAt, @UpdatedAt)
        RETURNING id;
        """,
        arrival);

    public void Update(ArrivalEntity arrival) => Execute(
        """
        UPDATE arrivals SET aawak_month = @AawakMonth, aawak_no = @AawakNo, aawak_suffix = @AawakSuffix, arrival_date = @ArrivalDate,
            party = @Party, nag = @Nag, transporter = @Transporter, inward_text = @InwardText, note = @Note, updated_at = @UpdatedAt
        WHERE id = @Id;
        """,
        arrival);

    public void MarkImported(long id, long batchId, int sourceRow, string sourceValues) => Execute(
        "UPDATE arrivals SET import_batch_id = @batchId, source_row = @sourceRow, source_values = @sourceValues WHERE id = @id;",
        new { id, batchId, sourceRow, sourceValues });

    public void Remove(long id) => Execute(
        """
        DELETE FROM arrival_entries WHERE arrival_id = @id;
        DELETE FROM arrival_refs WHERE arrival_id = @id;
        DELETE FROM arrivals WHERE id = @id;
        """,
        new { id });

    public void MoveToDeleted(long id, string at) => Execute(
        """
        INSERT INTO deleted_arrivals(id, aawak_month, aawak_no, aawak_suffix, arrival_date, party, nag, transporter, inward_text, note,
            import_batch_id, source_row, source_values, refs, links, created_at, updated_at, deleted_at)
        SELECT a.id, a.aawak_month, a.aawak_no, a.aawak_suffix, a.arrival_date, a.party, a.nag, a.transporter, a.inward_text, a.note,
            a.import_batch_id, a.source_row, a.source_values,
            (SELECT json_group_array(r.inward_no) FROM arrival_refs r WHERE r.arrival_id = a.id),
            (SELECT json_group_array(json_object('entryId', l.entry_id, 'nag', l.nag, 'how', l.how, 'createdAt', l.created_at))
             FROM arrival_entries l WHERE l.arrival_id = a.id),
            a.created_at, a.updated_at, @at
        FROM arrivals a WHERE a.id = @id;
        DELETE FROM arrival_entries WHERE arrival_id = @id;
        DELETE FROM arrival_refs WHERE arrival_id = @id;
        DELETE FROM arrivals WHERE id = @id;
        """,
        new { id, at });

    public IReadOnlyList<DeletedArrivalEntity> Deleted() =>
        Query<DeletedArrivalEntity>($"SELECT {DeletedColumns} FROM deleted_arrivals ORDER BY deleted_at DESC, id DESC;");

    public DeletedArrivalEntity? GetDeleted(long id) =>
        First<DeletedArrivalEntity>($"SELECT {DeletedColumns} FROM deleted_arrivals WHERE id = @id;", new { id });

    public IReadOnlyList<DeletedArrivalEntity> DeletedInMonth(string month) =>
        Query<DeletedArrivalEntity>($"SELECT {DeletedColumns} FROM deleted_arrivals WHERE aawak_month = @month;", new { month });

    public void RestoreDeleted(long id) => Execute(
        """
        INSERT INTO arrivals(id, aawak_month, aawak_no, aawak_suffix, arrival_date, party, nag, transporter, inward_text, note,
            import_batch_id, source_row, source_values, created_at, updated_at)
        SELECT id, aawak_month, aawak_no, aawak_suffix, arrival_date, party, nag, transporter, inward_text, note,
            import_batch_id, source_row, source_values, created_at, updated_at
        FROM deleted_arrivals WHERE id = @id;
        INSERT OR IGNORE INTO arrival_refs(arrival_id, inward_no)
        SELECT x.id, j.value FROM deleted_arrivals x, json_each(x.refs) j WHERE x.id = @id;
        INSERT OR IGNORE INTO arrival_entries(arrival_id, entry_id, nag, how, created_at)
        SELECT x.id, json_extract(j.value, '$.entryId'), json_extract(j.value, '$.nag'), json_extract(j.value, '$.how'),
            json_extract(j.value, '$.createdAt')
        FROM deleted_arrivals x, json_each(x.links) j WHERE x.id = @id;
        DELETE FROM deleted_arrivals WHERE id = @id;
        """,
        new { id });

    public IReadOnlyDictionary<long, IReadOnlyList<int>> Refs(IReadOnlyCollection<long> arrivalIds)
    {
        if (arrivalIds.Count == 0) return new Dictionary<long, IReadOnlyList<int>>();
        return Query<ArrivalRefEntity>("SELECT arrival_id, inward_no FROM arrival_refs WHERE arrival_id IN (SELECT value FROM json_each(@arrivalIds)) ORDER BY arrival_id, inward_no;", new { arrivalIds = Json(arrivalIds) })
            .GroupBy(r => r.ArrivalId)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<int>)g.Select(r => r.InwardNo).ToList());
    }

    public void ReplaceRefs(long arrivalId, IReadOnlyCollection<int> numbers)
    {
        Execute("DELETE FROM arrival_refs WHERE arrival_id = @arrivalId;", new { arrivalId });
        if (numbers.Count == 0) return;
        Execute("INSERT OR IGNORE INTO arrival_refs(arrival_id, inward_no) VALUES (@arrivalId, @inwardNo);",
            numbers.Distinct().Select(n => new { arrivalId, inwardNo = n }).ToList());
    }

    public IReadOnlyList<long> Naming(IReadOnlyCollection<int> numbers, string from, string to) => numbers.Count == 0
        ? []
        : Query<long>(
            """
            SELECT DISTINCT a.id FROM arrivals a JOIN arrival_refs r ON r.arrival_id = a.id
            WHERE r.inward_no IN (SELECT value FROM json_each(@numbers)) AND a.arrival_date BETWEEN @from AND @to ORDER BY a.id;
            """,
            new { numbers = Json(numbers), from, to });

    public IReadOnlyList<ArrivalLinkEntity> Links(IReadOnlyCollection<long> arrivalIds) => arrivalIds.Count == 0
        ? []
        : Query<ArrivalLinkEntity>("SELECT arrival_id, entry_id, nag, how, created_at FROM arrival_entries WHERE arrival_id IN (SELECT value FROM json_each(@arrivalIds));", new { arrivalIds = Json(arrivalIds) });

    public IReadOnlyList<ArrivalLinkEntity> LinksOfEntries(IReadOnlyCollection<long> entryIds) => entryIds.Count == 0
        ? []
        : Query<ArrivalLinkEntity>("SELECT arrival_id, entry_id, nag, how, created_at FROM arrival_entries WHERE entry_id IN (SELECT value FROM json_each(@entryIds));", new { entryIds = Json(entryIds) });

    public IReadOnlyList<ArrivalLinkEntity> AllLinks() =>
        Query<ArrivalLinkEntity>("SELECT arrival_id, entry_id, nag, how, created_at FROM arrival_entries;");

    public IReadOnlyList<EntryArrivalRow> EntryArrivals(IReadOnlyCollection<long>? entryIds)
    {
        if (entryIds is { Count: 0 }) return [];
        var only = entryIds is null ? string.Empty : "WHERE l.entry_id IN (SELECT value FROM json_each(@entryIds))";
        return Query<EntryArrivalRow>(
            $"""
            SELECT l.entry_id, a.id AS arrival_id, a.aawak_month, a.aawak_no, a.aawak_suffix, a.arrival_date, a.transporter, COALESCE(l.nag, a.nag) AS nag
            FROM arrival_entries l JOIN arrivals a ON a.id = l.arrival_id
            {only}
            ORDER BY a.arrival_date, a.aawak_no, a.aawak_suffix;
            """,
            new { entryIds = entryIds is null ? null : Json(entryIds) });
    }

    public void ReplaceAutoLinks(long arrivalId, IReadOnlyCollection<ArrivalLinkEntity> links)
    {
        Execute("DELETE FROM arrival_entries WHERE arrival_id = @arrivalId AND how = 'auto';", new { arrivalId });
        if (links.Count == 0) return;
        Execute(
            "INSERT OR IGNORE INTO arrival_entries(arrival_id, entry_id, nag, how, created_at) VALUES (@ArrivalId, @EntryId, @Nag, @How, @CreatedAt);",
            links.Select(l => l with { ArrivalId = arrivalId, How = ArrivalLinkHow.Auto }).ToList());
    }

    public void SetLink(ArrivalLinkEntity link) => Execute(
        "INSERT OR REPLACE INTO arrival_entries(arrival_id, entry_id, nag, how, created_at) VALUES (@ArrivalId, @EntryId, @Nag, @How, @CreatedAt);",
        link);

    public void SetShare(long arrivalId, long entryId, int? nag) =>
        Execute("UPDATE arrival_entries SET nag = @nag WHERE arrival_id = @arrivalId AND entry_id = @entryId;", new { arrivalId, entryId, nag });

    public void RemoveLink(long arrivalId, long entryId) =>
        Execute("DELETE FROM arrival_entries WHERE arrival_id = @arrivalId AND entry_id = @entryId;", new { arrivalId, entryId });

    public IReadOnlyList<SlipEntity> Slips(IReadOnlyCollection<int> numbers, string from, string to) => numbers.Count == 0
        ? []
        : Query<SlipEntity>(
            $"SELECT {SlipColumns} FROM entries e WHERE e.inward_no IN (SELECT value FROM json_each(@numbers)) AND e.carried_over = 0 AND e.entry_date BETWEEN @from AND @to ORDER BY e.inward_no, e.id;",
            new { numbers = Json(numbers), from, to });

    public IReadOnlyList<SlipEntity> SlipsByIds(IReadOnlyCollection<long> ids) => ids.Count == 0
        ? []
        : Query<SlipEntity>(
            $"""
            SELECT {SlipColumns}, 0 AS deleted FROM entries e WHERE e.id IN (SELECT value FROM json_each(@ids))
            UNION ALL
            SELECT {SlipColumns}, 1 AS deleted FROM deleted_entries e WHERE e.id IN (SELECT value FROM json_each(@ids))
            """,
            new { ids = Json(ids) });

    public IReadOnlyList<SlipEntity> SlipsBetween(string from, string to) => Query<SlipEntity>(
        $"SELECT {SlipColumns} FROM entries e WHERE e.carried_over = 0 AND e.entry_date BETWEEN @from AND @to ORDER BY e.entry_date, e.inward_no, e.id;",
        new { from, to });

    public long AddBatch(ArrivalImportBatchEntity batch) => Scalar<long>(
        """
        INSERT INTO arrival_import_batches(file_name, sha256, aawak_month, imported_at, arrival_count)
        VALUES (@FileName, @Sha256, @AawakMonth, @ImportedAt, @ArrivalCount) RETURNING id;
        """,
        batch);

    public void AddMarks(IReadOnlyCollection<ArrivalImportMarkEntity> marks)
    {
        if (marks.Count == 0) return;
        Execute(
            "INSERT OR REPLACE INTO arrival_import_marks(batch_id, arrival_id, action, source_row, changes) VALUES (@BatchId, @ArrivalId, @Action, @SourceRow, @Changes);",
            marks);
    }

    public IReadOnlyDictionary<long, ArrivalImportMarkEntity> LatestMarks(IReadOnlyCollection<long> arrivalIds)
    {
        var marks = new Dictionary<long, ArrivalImportMarkEntity>();
        if (arrivalIds.Count == 0) return marks;
        foreach (var mark in Query<ArrivalImportMarkEntity>(
            """
            SELECT m.batch_id, m.arrival_id, m.action, m.source_row, m.changes, b.file_name, b.imported_at
            FROM arrival_import_marks m JOIN arrival_import_batches b ON b.id = m.batch_id
            WHERE b.id IN (SELECT MAX(id) FROM arrival_import_batches GROUP BY aawak_month)
              AND m.arrival_id IN (SELECT value FROM json_each(@arrivalIds))
            ORDER BY b.id;
            """,
            new { arrivalIds = Json(arrivalIds) }))
        {
            marks[mark.ArrivalId] = mark;
        }
        return marks;
    }

    public string? FileByHash(string sha256) =>
        First<string>("SELECT file_name FROM arrival_import_batches WHERE sha256 = @sha256 LIMIT 1;", new { sha256 });

    public IReadOnlyDictionary<long, NoArrivalEntity> NoArrival() =>
        Query<NoArrivalEntity>("SELECT entry_id, note, created_at FROM entry_no_arrival;").ToDictionary(n => n.EntryId);

    public IReadOnlyDictionary<long, NoArrivalEntity> NoArrival(IReadOnlyCollection<long> entryIds) => entryIds.Count == 0
        ? new Dictionary<long, NoArrivalEntity>()
        : Query<NoArrivalEntity>("SELECT entry_id, note, created_at FROM entry_no_arrival WHERE entry_id IN (SELECT value FROM json_each(@entryIds));",
            new { entryIds = Json(entryIds) }).ToDictionary(n => n.EntryId);

    public void SetNoArrival(long entryId, string note, string at) =>
        Execute("INSERT OR REPLACE INTO entry_no_arrival(entry_id, note, created_at) VALUES (@entryId, @note, @at);", new { entryId, note, at });

    public void ClearNoArrival(long entryId) => Execute("DELETE FROM entry_no_arrival WHERE entry_id = @entryId;", new { entryId });

    public IReadOnlyList<TransporterUsage> TransporterUsage() => Query<TransporterUsage>(
        "SELECT transporter AS name, COUNT(*) AS arrivals, MAX(arrival_date) AS last_arrival FROM arrivals GROUP BY transporter COLLATE NOCASE;");

    public void RenameTransporter(string from, string to) => Execute(
        """
        UPDATE arrivals SET transporter = @to WHERE transporter = @from COLLATE NOCASE;
        UPDATE deleted_arrivals SET transporter = @to WHERE transporter = @from COLLATE NOCASE;
        """,
        new { from, to });
}
