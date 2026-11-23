using MPHRegister.Contracts.Settings;
using MPHRegister.Shared.Enums;

namespace MPHRegister.Services.Billing;

public static class TaxModes
{
    /// <summary>GSTIN state code decides; without a GSTIN the state name does.</summary>
    public static TaxMode Resolve(FirmSettings firm, string gstin, string state)
    {
        ArgumentNullException.ThrowIfNull(firm);
        if (gstin.Length >= 2) return gstin[..2] == firm.HomeStateCode ? TaxMode.Intra : TaxMode.Inter;
        return state.Length == 0 || state.Contains(firm.HomeStateName, StringComparison.OrdinalIgnoreCase) ? TaxMode.Intra : TaxMode.Inter;
    }
}
