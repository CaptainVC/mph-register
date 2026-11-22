namespace MPHRegister.Contracts.Dashboard;

/// <summary>
/// The dashboard's figures in one compact answer, so the screen can add up any months, any parties and any comparison by
/// itself without asking again. Rows are arrays of whole numbers whose first values index <see cref="Parties"/>,
/// <see cref="Months"/> and <see cref="Finishes"/>, so years of data stay small. Money is in whole rupees; billed value is
/// job charges after discount and before GST. Bills follow the party on the saved invoice; inward and stock follow the
/// party in the register.
/// </summary>
/// <param name="Months">yyyy-MM from the April of the first financial year with data up to the current month.</param>
/// <param name="Bills">Saved bills dated up to today, per bill-to party and bill month:
/// [party, month, bills, than, gross, discount, taxable, cgst, sgst, igst, total]. THAN is the priced quantity.</param>
/// <param name="FinishLines">Priced lines of those bills per party, month and finish: [party, month, finish, than, amount]
/// (amount before discount).</param>
/// <param name="Inward">Register entries dated up to today per party and inward month, with the pieces sent back per dispatch
/// month: [party, month, entries, than, pieces, repairEntries, repairThan, value, sentPieces]. Pieces = THAN + TP + TWO PART;
/// value is the work at today's rates less discount (repairs excluded), an estimate.</param>
/// <param name="Unbilled">Work with no bill link, as of today, per bill-to party (only parties with such work).</param>
/// <param name="Stock">Positive dispatch balances, as of today, per register party (only parties with a balance).</param>
/// <param name="Quiet">Parties that sent much less cloth in the 30 days up to the last inward date than usual.</param>
public sealed record DashboardFactsDto(
    string Today,
    IReadOnlyList<string> Months,
    IReadOnlyList<FactsParty> Parties,
    IReadOnlyList<string> Finishes,
    IReadOnlyList<long[]> Bills,
    IReadOnlyList<long[]> FinishLines,
    IReadOnlyList<long[]> Inward,
    IReadOnlyList<FactsUnbilled> Unbilled,
    IReadOnlyList<FactsStock> Stock,
    IReadOnlyList<FactsQuiet> Quiet,
    FactsThisMonth ThisMonth,
    DashboardCoverage Coverage,
    int OldAfterDays);

/// <param name="Group">Sister-firm group, empty for a party on its own.</param>
/// <param name="LastInward">Latest inward date of the party's register entries.</param>
/// <param name="LastDispatch">Latest valid dispatch date of those entries.</param>
/// <param name="LastBill">Latest saved bill to the party.</param>
public sealed record FactsParty(string Name, string Group, bool Active, bool NoBill, string? LastInward, string? LastDispatch, string? LastBill);

/// <summary>
/// One bill-to party's work with no recorded bill link, valued at its rate less discount (or its usual income per THAN when the
/// finish or rate is missing). Ready work is dispatched, or may be billed before dispatch; the rest is still in the factory.
/// </summary>
/// <param name="NoRate">Open work (ready or not) without a finish or a rate for it.</param>
/// <param name="Old">Ready work waiting more than <see cref="DashboardFactsDto.OldAfterDays"/> days.</param>
/// <param name="Oldest">Earliest inward date of the ready work.</param>
/// <param name="DaysWaiting">Days the longest-waiting ready entry has waited since it was sent back.</param>
/// <param name="Ageing">Ready work by days waiting: 0–30, 31–60, 61–90, over 90.</param>
/// <param name="EarlierInward">Ready work that came in on or before the latest saved bill of all parties (the last billing run).</param>
public sealed record FactsUnbilled(
    int Party,
    WorkEstimate Ready,
    WorkEstimate Factory,
    WorkEstimate NoRate,
    WorkEstimate Old,
    string? Oldest,
    int DaysWaiting,
    IReadOnlyList<WorkEstimate> Ageing,
    WorkEstimate EarlierInward,
    WorkEstimate MissingRate,
    WorkEstimate DispatchIssue,
    WorkEstimate BeforeDispatch);

public sealed record FactsStock(int Party, StockBalance Total, StockBalance Unbilled, StockBalance BeforeDispatch, StockBalance Billed, StockBalance Repairs, StockBalance NoBill);

/// <param name="UsualThan">THAN it sent in an average 30 days over the 90 days before the last 30.</param>
public sealed record FactsQuiet(int Party, int UsualThan, int RecentThan, string LastInward, int DaysSinceLast);

/// <summary>The current calendar month up to the last inward date entered, against the same days of the month before.</summary>
/// <param name="UpTo">Last inward date entered, when it falls in this month.</param>
/// <param name="Comparable">The month before has entries after those same days, so its first days are complete enough to compare.</param>
/// <param name="SameDaysLastMonth">Entries of the month before up to the same day, per register party.</param>
public sealed record FactsThisMonth(string Month, string? UpTo, bool Comparable, IReadOnlyList<FactsPartyCount> SameDaysLastMonth);

public sealed record FactsPartyCount(int Party, int Entries, int Than);
