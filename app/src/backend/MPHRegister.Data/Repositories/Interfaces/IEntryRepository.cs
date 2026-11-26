using MPHRegister.Data.Entities;

namespace MPHRegister.Data.Repositories.Interfaces;

public interface IEntryRepository
{
    IReadOnlyList<EntryEntity> List(string? month);

    /// <summary>Entries of the register months from <paramref name="from"/> to <paramref name="to"/> (yyyy-MM, both included).</summary>
    IReadOnlyList<EntryEntity> InMonths(string from, string to);

    /// <summary>Entries of register months before <paramref name="month"/> (yyyy-MM) still in stock when it began: less was dispatched before its 1st than came in.</summary>
    IReadOnlyList<EntryEntity> InStockBefore(string month);

    IReadOnlyList<EntryEntity> Recent(int limit);

    EntryEntity? Get(long id);

    IReadOnlyList<EntryEntity> ByIds(IReadOnlyCollection<long> ids);

    IReadOnlyList<EntryEntity> Unbilled(IReadOnlyList<string> parties, string? uptoMonth);

    /// <summary>The entries among <paramref name="ids"/> that are of one of the parties and still to be billed (what <see cref="Unbilled"/> lists).</summary>
    IReadOnlyList<EntryEntity> UnbilledByIds(IReadOnlyCollection<long> ids, IReadOnlyList<string> parties);

    /// <summary>
    /// Unbilled entries with an inward date from <paramref name="from"/> to <paramref name="to"/> (ISO dates, both included), and
    /// earlier ones still in stock when <paramref name="from"/> began (less was dispatched before it than came in).
    /// </summary>
    IReadOnlyList<EntryEntity> UnbilledBetween(IReadOnlyList<string> parties, string from, string to);

    /// <summary>Unbilled entries of every party with an inward date from <paramref name="from"/> to <paramref name="to"/> (ISO dates, both included).</summary>
    IReadOnlyList<EntryEntity> UnbilledAnyParty(string from, string to);

    /// <summary>Ids of the entries on saved bills made in the app.</summary>
    IReadOnlySet<long> OnAppBills();

    /// <summary>Entries on saved bills (made in the app or imported from Excel) or marked as billed outside the app.</summary>
    IReadOnlyList<EntryEntity> Billed(IReadOnlyList<string> parties, string? uptoMonth);

    /// <summary>The same inward slip stored for an earlier register month; carryover rows update it.</summary>
    EntryEntity? FindEarlier(string party, string entryDate, int inwardNo, string beforeMonth);

    /// <summary>Slips of an earlier register month with this party and INW. NO. and an inward date in the range (ISO dates).</summary>
    IReadOnlyList<EntryEntity> FindEarlierNear(string party, int inwardNo, string beforeMonth, string from, string to);

    /// <summary>A carryover stored for a later month (imported out of order) that this month's row is the original of.</summary>
    EntryEntity? FindLaterCarryover(string party, string entryDate, int inwardNo, string afterMonth);

    /// <summary>
    /// Moves a later month's carryover to this month as its original. Its row in the later month's workbook, if kept, stays
    /// on as that month's carryover row.
    /// </summary>
    void MoveToMonth(long id, string month, long importBatchId, int sourceRow, string sourceValues);

    /// <summary>The entries of the month that have their workbook row stored (entries imported before rows were kept have none).</summary>
    IReadOnlyList<EntrySource> SourceValues(string month);

    /// <summary>The entry is row <paramref name="sourceRow"/> of the workbook imported as <paramref name="importBatchId"/>, with these values.</summary>
    void MarkImported(long id, long importBatchId, int sourceRow, string sourceValues);

    /// <summary>The carryover rows of earlier entries in the <paramref name="month"/> register, as that workbook was last imported.</summary>
    IReadOnlyList<EntrySource> CarryoverSources(string month);

    /// <summary>
    /// Entries of months before <paramref name="beforeMonth"/> that a workbook row with this slip was imported as (their own
    /// row, or a carryover row of any month), so one still found after its INW. NO., DATE or PARTY was corrected.
    /// </summary>
    IReadOnlyList<long> EarlierByImportedSlip(string party, string entryDate, int inwardNo, string beforeMonth);

    void SaveCarryoverSource(long entryId, string month, string sourceValues);

    /// <summary>Deletes an entry and its dispatches. Entries on a bill or marked as billed elsewhere cannot be deleted.</summary>
    void Delete(long id);

    /// <summary>Deletes an entry made in the app's register, keeping it whole in deleted_entries so it can be restored.</summary>
    void MoveToDeleted(long id, string at);

    /// <summary>Puts a deleted entry back under its own id, with its dispatches and carryover rows.</summary>
    void RestoreDeleted(long id);

    /// <summary>Entries deleted in the app, newest first.</summary>
    IReadOnlyList<DeletedEntryEntity> Deleted();

    DeletedEntryEntity? GetDeleted(long id);

    /// <summary>Removes every deleted entry for good; they can no longer be restored. Returns how many were removed.</summary>
    int PurgeDeleted();

    /// <summary>Deleted entries of <paramref name="month"/> and earlier: a newer workbook may still have their rows.</summary>
    IReadOnlyList<DeletedEntryEntity> DeletedUpTo(string month);

    /// <summary>
    /// Entries holding this inward slip (INW. NO., DATE and PARTY) in any month, and, when <paramref name="numberIsTaken"/>,
    /// the entry using the INW. NO. in the <paramref name="month"/> register.
    /// </summary>
    IReadOnlyList<EntryEntity> SameSlip(string month, int inwardNo, string entryDate, string party, bool numberIsTaken);

    /// <summary>Entries of the month with the same DATE, PARTY, D.N., LOT N. and THAN, whatever their INW. NO.</summary>
    IReadOnlyList<EntryEntity> SameContent(string month, string entryDate, string party, string designNo, string lotNo, int than);

    /// <summary>Numbers of the cancelled bills that list the entry (they cannot be restored while it is deleted).</summary>
    IReadOnlyList<string> CancelledBillsWith(long id);

    /// <summary>The dispatches of these entries; <paramref name="readWhole"/> reads the table whole (quicker when they are most entries).</summary>
    IReadOnlyDictionary<long, List<DispatchEntity>> Dispatches(IReadOnlyCollection<long> entryIds, bool readWhole = false);

    long Insert(EntryEntity entry);

    bool Update(EntryEntity entry);

    void ReplaceDispatches(long entryId, IReadOnlyList<DispatchEntity> dispatches);

    /// <summary>Inward numbers used by more than one entry (not carryovers) of the same register month, in these months.</summary>
    IReadOnlySet<(string Month, int InwardNo)> DuplicateInwardNumbers(IReadOnlyCollection<string> months);

    string? InwardNumberOwner(string month, int inwardNo, long? excludingId);

    bool IsCarriedOver(long id);

    int NextInwardNumber(string month);

    /// <summary>All-zero slips (no THAN, TP, TWO PART or dispatch) whose D.N. mentions INW, in every month.</summary>
    IReadOnlyList<LinkSlipEntity> ZeroSlipsNamingInward();

    /// <summary>Entries with THAN, TP or TWO PART that carry one of these INW. NO., in every month.</summary>
    IReadOnlyList<LinkSlipEntity> SlipsWithNumbers(IReadOnlyCollection<int> numbers);

    IReadOnlyList<MonthCount> Months();

    long Count();

    /// <summary>Unbilled entries with an inward date in the period (ISO dates, both included) or still in stock when it began, per inward party.</summary>
    IReadOnlyList<PartyToBillRow> PartiesToBill(string from, string to);

    IReadOnlyList<string> DistinctParties();
}
