namespace MPHRegister.Contracts.Dashboard;

/// <summary>
/// The financial dashboard, worked out from the register, the saved bills and the config file each time it is asked for.
/// Money is in whole rupees. Billed value means job charges after discount and before GST, not collections or profit.
/// </summary>
public sealed record DashboardDto(
    string Today,
    string Fy,
    IReadOnlyList<string> Years,
    string Month,
    IReadOnlyList<string> Months,
    YearFigures Year,
    YearComparison? Compared,
    IReadOnlyList<MonthFigures> Monthly,
    UnbilledFigures Unbilled,
    IReadOnlyList<UnbilledParty> UnbilledParties,
    IReadOnlyList<PartyIncome> Parties,
    IReadOnlyList<FinishIncome> Finishes,
    IReadOnlyList<QuietParty> QuietParties,
    RepairFigures Repairs,
    InwardNow ThisMonth,
    DashboardCoverage Coverage,
    StockFigures Stock,
    BillingReview Review);

/// <summary>Latest dates recorded in the app, across all years, not confirmation that the source data is complete.</summary>
public sealed record DashboardCoverage(string? LastInward, string? LastDispatch, string? LastBill);

/// <summary>Positive register balances, irrespective of billing. Pieces = THAN + TP + TWO PART minus dispatched quantity.</summary>
public sealed record StockFigures(StockBalance Total, StockBalance Unbilled, StockBalance BeforeDispatch, StockBalance Billed, StockBalance Repairs, StockBalance NoBill);

/// <param name="UndispatchedThan">Original THAN on slips with no dispatch. Partial balances are only measured in pieces.</param>
public sealed record StockBalance(int Entries, int Pieces, int UndispatchedThan, int PartialEntries);

/// <summary>Overlapping review flags within the estimated billing queue; these are not additional amounts to bill.</summary>
public sealed record BillingReview(WorkEstimate EarlierInward, WorkEstimate MissingRate, WorkEstimate DispatchIssue, WorkEstimate BeforeDispatch);

public sealed record WorkEstimate(int Entries, int Than, long Value);

/// <summary>Bills of a financial year.</summary>
/// <param name="Projected">Annualized completed-month billed value, or zero when a completed month has no bills. For past years, actual billed value.</param>
public sealed record YearFigures(
    int Bills,
    int Parties,
    int Than,
    long Gross,
    long Discount,
    long Taxable,
    long Gst,
    long Total,
    int MonthsWithBills,
    long Projected);

/// <summary>
/// Income of the same whole bill months this year and the year before: the finished months of the current year (bills are
/// made at the end of the month), or the whole year for a past year. Null when there is nothing to compare with.
/// </summary>
public sealed record YearComparison(string FromMonth, string ToMonth, long ThisYear, long LastYear);

/// <param name="Month">yyyy-MM.</param>
/// <param name="InwardEntries">All inward entries dated in the month, including repairs.</param>
/// <param name="InwardThan">THAN of those entries, to set against the THAN billed.</param>
/// <param name="LastYearTaxable">Income of the same month a year before (0 when there were no bills).</param>
public sealed record MonthFigures(
    string Month,
    int Bills,
    int Than,
    long Gross,
    long Discount,
    long Taxable,
    long Cgst,
    long Sgst,
    long Igst,
    long Total,
    int InwardEntries,
    int InwardThan,
    long LastYearTaxable);

/// <summary>
/// Inward work that has no bill yet, valued at each party's own rate less its discount (before GST); work without a finish
/// or rate yet is valued at what the party earned per THAN on its bills of the last 12 months.
/// </summary>
/// <param name="ReadyValue">Estimated value of entries eligible for billing that have no recorded bill link.</param>
/// <param name="FactoryValue">Estimated value of unbilled work with no dispatch that is not eligible for pre-dispatch billing.</param>
/// <param name="NoRateEntries">Entries without a finish or without a rate for it: valued at the party's usual income per THAN instead.</param>
/// <param name="OldEntries">Ready entries waiting more than <paramref name="OldAfterDays"/> days.</param>
/// <param name="Ageing">Ready-to-bill work by days waiting: 0–30, 31–60, 61–90, over 90.</param>
public sealed record UnbilledFigures(
    int ReadyEntries,
    int ReadyThan,
    long ReadyValue,
    int FactoryEntries,
    int FactoryThan,
    long FactoryValue,
    int NoRateEntries,
    int NoRateThan,
    int OldEntries,
    long OldValue,
    string? Oldest,
    IReadOnlyList<AgeBucket> Ageing,
    int OldAfterDays);

/// <param name="Key">"0-30", "31-60", "61-90" or "90+".</param>
public sealed record AgeBucket(string Key, int Entries, int Than, long Value);

/// <param name="Party">The party the bill goes to (after "bill to").</param>
/// <param name="Oldest">Earliest inward date among its ready entries.</param>
/// <param name="DaysWaiting">Days the oldest ready entry has waited since it was sent back.</param>
public sealed record UnbilledParty(
    string Party,
    int Entries,
    int Than,
    long Value,
    int NoRateEntries,
    string Oldest,
    int DaysWaiting,
    int FactoryThan,
    long FactoryValue)
{
    public int EarlierInwardEntries { get; init; }

    public int DispatchIssueEntries { get; init; }

    public int ReadyNoRateEntries { get; init; }
}

/// <param name="Share">Percent of the year's income.</param>
/// <param name="PerThan">Income per billed THAN, after discount.</param>
public sealed record PartyIncome(
    string Party,
    int Bills,
    int Than,
    long Gross,
    long Discount,
    long Taxable,
    decimal Share,
    decimal DiscountPercent,
    decimal PerThan,
    string LastBill);

/// <param name="Share">Percent of the year's job charges (before discount).</param>
public sealed record FinishIncome(string Finish, int Than, long Amount, decimal Share, decimal AverageRate);

/// <summary>A party that usually sends cloth but sent much less in the last 30 days.</summary>
/// <param name="UsualThan">THAN it sent in an average 30 days over the 90 days before that.</param>
public sealed record QuietParty(string Party, int UsualThan, int RecentThan, string LastInward, int DaysSinceLast);

public sealed record RepairFigures(int Entries, int Than, IReadOnlyList<RepairParty> TopParties);

public sealed record RepairParty(string Party, int Entries, int Than);

/// <summary>Cloth received in the current calendar month up to the last inward date entered (UpTo), and in the same days of the month before.</summary>
/// <param name="EstimatedValue">What that cloth is worth at the parties' rates less discount.</param>
public sealed record InwardNow(string Month, string? UpTo, int Entries, int Than, int? LastMonthSameDaysThan, long EstimatedValue, int RepairThan);
