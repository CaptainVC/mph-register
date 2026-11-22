using MPHRegister.Contracts.Masters;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Mapping;

public static class PartyMapper
{
    public static PartyDto ToDto(PartyConfig party, ConfigIndex index, int entries)
    {
        ArgumentNullException.ThrowIfNull(party);
        ArgumentNullException.ThrowIfNull(index);
        var style = index.Style(party.BillingStyle);
        var problems = new List<string>();
        // A party that is never billed needs no GSTIN, discount, rates or style.
        if (!party.NoBillNeeded)
        {
            if (party.Gstin.Length == 0) problems.Add("No GSTIN");
            else if (!Gstin.IsValid(party.Gstin)) problems.Add("GSTIN is not valid");
            if (party.DiscountPercent is null) problems.Add("No discount set");
            if (party.Rates.Count == 0) problems.Add("No rates");
            if (style is null) problems.Add(party.BillingStyle.Length == 0 ? "No billing style" : $"Billing style \"{party.BillingStyle}\" not found");
        }
        if (!index.IsKnownColor(party.Color)) problems.Add($"Colour \"{party.Color}\" not in the colour list");
        return new PartyDto(party.Name, party.Active, party.Address, party.State, party.Gstin, party.DiscountPercent, party.Color,
            style?.Name ?? party.BillingStyle, style ?? index.FallbackStyle, party.BillBeforeDispatch, party.BillAs, party.Rates, entries, problems, party.SisterGroup, party.NoBillNeeded);
    }

    public static FinishDto ToDto(FinishConfig finish, int entries, int ratedBy)
    {
        ArgumentNullException.ThrowIfNull(finish);
        return new FinishDto(finish.Name, finish.Active, finish.Group, finish.Color, finish.BillAsIfNoRate, entries, ratedBy);
    }

    public static StyleDto ToDto(BillingStyle style, int parties)
    {
        ArgumentNullException.ThrowIfNull(style);
        return new StyleDto(style.Name, style.Description, style.GpnColumn, style.DnColumn, style.LotColumn, style.Lines, style.Order,
            style.ShowQuantityBreakdown, style.CombineSmallEntries, parties);
    }
}
