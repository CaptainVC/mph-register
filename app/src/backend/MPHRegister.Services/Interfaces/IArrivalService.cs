using MPHRegister.Contracts.Arrivals;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Interfaces;

/// <summary>The Aawak register: arrivals at the gate and the inward slips they carry.</summary>
public interface IArrivalService
{
    /// <summary>The Aawak month's rows; with no valid month, those of <paramref name="months"/> (or all when it is null).</summary>
    IReadOnlyList<ArrivalDto> List(string? month, MonthRange? months = null);

    IReadOnlyList<ArrivalDto> Recent(int? limit);

    ArrivalDto Get(long id);

    ArrivalDto Create(ArrivalInput input);

    ArrivalDto Update(long id, ArrivalInput input);

    DeleteArrivalResult Delete(long id);

    IReadOnlyList<DeletedArrivalDto> Deleted();

    ArrivalDto Restore(long id);

    IReadOnlyList<AawakMonthDto> Months();

    NextAawakDto Next(string? month);

    SlipPreviewDto Preview(string? date, string? party, int? nag, string? inward, long? arrivalId);

    ArrivalDto AddLink(long arrivalId, ArrivalLinkInput input);

    ArrivalDto RemoveLink(long arrivalId, long entryId);

    IReadOnlyList<ArrivalDto> ForEntry(long entryId);

    IReadOnlyList<ArrivalCandidateDto> Candidates(string? date, string? party);

    void MarkNoArrival(long entryId, NoArrivalInput input);

    void ClearNoArrival(long entryId);

    RelinkResult Relink(string? month);

    ArrivalTotalsDto Totals(string? from, string? to, bool groupSisters, string? order);

    ArrivalStatementDto Statement(string? from, string? to, string? transporter);

    ArrivalCheckDto Check(string? from, string? to);
}
