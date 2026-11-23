using MPHRegister.Data.Entities;

namespace MPHRegister.Data.Repositories.Interfaces;

/// <summary>The Aawak register: arrivals, the slip numbers they name, their links to inward entries and their imports.</summary>
public interface IArrivalRepository
{
    IReadOnlyList<ArrivalEntity> List(string? month);

    /// <summary>Arrivals dated from <paramref name="from"/> to <paramref name="to"/> (ISO dates, both included).</summary>
    IReadOnlyList<ArrivalEntity> Between(string from, string to);

    /// <summary>The newest arrivals typed in the app.</summary>
    IReadOnlyList<ArrivalEntity> Recent(int limit);

    ArrivalEntity? Get(long id);

    IReadOnlyList<ArrivalEntity> ByIds(IReadOnlyCollection<long> ids);

    ArrivalEntity? ByNumber(string month, int number, string suffix);

    IReadOnlyList<AawakMonthCount> Months();

    int NextNumber(string month);

    string? EarliestDate();

    long Insert(ArrivalEntity arrival);

    void Update(ArrivalEntity arrival);

    void MarkImported(long id, long batchId, int sourceRow, string sourceValues);

    /// <summary>Deletes for good (an import removing a row the workbook no longer has).</summary>
    void Remove(long id);

    void MoveToDeleted(long id, string at);

    IReadOnlyList<DeletedArrivalEntity> Deleted();

    DeletedArrivalEntity? GetDeleted(long id);

    IReadOnlyList<DeletedArrivalEntity> DeletedInMonth(string month);

    void RestoreDeleted(long id);

    IReadOnlyDictionary<long, IReadOnlyList<int>> Refs(IReadOnlyCollection<long> arrivalIds);

    void ReplaceRefs(long arrivalId, IReadOnlyCollection<int> numbers);

    /// <summary>Arrivals dated within the range that name any of the slip numbers.</summary>
    IReadOnlyList<long> Naming(IReadOnlyCollection<int> numbers, string from, string to);

    IReadOnlyList<ArrivalLinkEntity> Links(IReadOnlyCollection<long> arrivalIds);

    IReadOnlyList<ArrivalLinkEntity> LinksOfEntries(IReadOnlyCollection<long> entryIds);

    IReadOnlyList<ArrivalLinkEntity> AllLinks();

    /// <summary>Every link with its arrival's number, for the inward register's Aawak column.</summary>
    IReadOnlyList<EntryArrivalRow> EntryArrivals();

    /// <summary>Replaces the arrival's automatic links; manual ones stay.</summary>
    void ReplaceAutoLinks(long arrivalId, IReadOnlyCollection<ArrivalLinkEntity> links);

    void SetLink(ArrivalLinkEntity link);

    void SetShare(long arrivalId, long entryId, int? nag);

    void RemoveLink(long arrivalId, long entryId);

    /// <summary>Inward entries (not carryovers) with one of the numbers, dated within the range.</summary>
    IReadOnlyList<SlipEntity> Slips(IReadOnlyCollection<int> numbers, string from, string to);

    /// <summary>Inward entries by id, including entries deleted in the app (marked <c>Deleted</c>).</summary>
    IReadOnlyList<SlipEntity> SlipsByIds(IReadOnlyCollection<long> ids);

    /// <summary>Inward entries (not carryovers) dated within the range.</summary>
    IReadOnlyList<SlipEntity> SlipsBetween(string from, string to);

    long AddBatch(ArrivalImportBatchEntity batch);

    void AddMarks(IReadOnlyCollection<ArrivalImportMarkEntity> marks);

    IReadOnlyDictionary<long, ArrivalImportMarkEntity> LatestMarks();

    string? FileByHash(string sha256);

    IReadOnlyDictionary<long, NoArrivalEntity> NoArrival();

    void SetNoArrival(long entryId, string note, string at);

    void ClearNoArrival(long entryId);

    IReadOnlyList<TransporterUsage> TransporterUsage();

    void RenameTransporter(string from, string to);
}
