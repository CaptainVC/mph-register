using MPHRegister.Data.Entities;
using MPHRegister.Services.Arrivals;
using MPHRegister.Shared.Configuration;

namespace MPHRegister.UnitTests.Arrivals;

public sealed class ArrivalTotalsTests
{
    private static readonly ConfigIndex Index = ConfigIndex.For(new AppConfig
    {
        Parties =
        [
            new PartyConfig { Name = "TOTAL FIRM A", SisterGroup = "TOTAL GROUP" },
            new PartyConfig { Name = "TOTAL FIRM B", SisterGroup = "TOTAL GROUP" },
            new PartyConfig { Name = "TOTAL ALONE" },
        ],
        Transporters = [new TransporterConfig { Name = "LORRY ONE", OtherSpellings = ["LORY ONE"] }, new TransporterConfig { Name = "LORRY TWO" }],
    });

    private static ArrivalEntity Row(int no, string date, string party, int nag, string lorry) =>
        new() { AawakNo = no, ArrivalDate = date, Party = party, Nag = nag, Transporter = lorry, AawakMonth = date[..7] };

    private static readonly IReadOnlyList<ArrivalEntity> Rows =
    [
        Row(1, "2026-10-01", "TOTAL ALONE", 30, "LORRY TWO"),
        Row(2, "2026-10-01", "TOTAL FIRM A", 50, "LORRY ONE"),
        Row(3, "2026-10-02", "TOTAL FIRM B", 70, "LORY ONE"),
        Row(4, "2026-10-03", "TOTAL ALONE", 5, "LORRY ONE"),
    ];

    [Fact]
    public void Adds_up_like_the_workbook_macro_in_order_of_first_arrival()
    {
        var totals = ArrivalTotals.Compute(Rows, Index, groupSisters: true, ArrivalTotals.FirstArrival, "2026-10-01", "2026-10-31");

        Assert.Equal((4, 155), (totals.Arrivals, totals.Nag));
        Assert.Equal([("TOTAL ALONE", 35), ("TOTAL GROUP", 120)], totals.Parties.Select(p => (p.Name, p.Nag)));
        Assert.True(totals.Parties[1].IsGroup);
        Assert.Equal(["TOTAL FIRM A", "TOTAL FIRM B"], totals.Parties[1].Members);
        Assert.Equal([("LORRY TWO", 30), ("LORRY ONE", 125)], totals.Transporters.Select(t => (t.Name, t.Nag)));
        Assert.Equal(totals.Nag, totals.Parties.Sum(p => p.Nag));
        Assert.Equal(totals.Nag, totals.Transporters.Sum(t => t.Nag));
    }

    [Fact]
    public void Without_grouping_each_firm_has_its_line_and_most_NAG_comes_first()
    {
        var totals = ArrivalTotals.Compute(Rows, Index, groupSisters: false, ArrivalTotals.ByNag, "2026-10-01", "2026-10-31");

        Assert.Equal([("TOTAL FIRM B", 70), ("TOTAL FIRM A", 50), ("TOTAL ALONE", 35)], totals.Parties.Select(p => (p.Name, p.Nag)));
        Assert.All(totals.Parties, p => Assert.False(p.IsGroup));
        Assert.Equal(3, totals.Days.Count);
        Assert.Equal(70, totals.Matrix.Single(c => c.Transporter == "LORRY ONE" && c.Party == "TOTAL FIRM B").Nag);
    }
}
