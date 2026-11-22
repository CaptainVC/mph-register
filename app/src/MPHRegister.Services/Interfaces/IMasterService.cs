using MPHRegister.Contracts.Masters;

namespace MPHRegister.Services.Interfaces;

/// <summary>Changes to the lists in the config file. Renames carry through to entries, bills and every reference.</summary>
public interface IMasterService
{
    MastersDto GetMasters();

    FullMastersDto GetFull();

    PartyDto SaveParty(PartyInput input);

    SisterGroupDto SaveSisterGroup(SisterGroupInput input);

    void DeleteSisterGroup(string? name);

    PartyDto SaveRate(RateInput input);

    PartyDto DeleteRate(string? party, string? finish);

    FinishDto SaveFinish(FinishInput input);

    GroupDto SaveGroup(GroupInput input);

    StyleDto SaveStyle(StyleInput input);

    void DeleteStyle(string? name);

    ColorDto SaveColor(ColorInput input);

    void DeleteColor(string? name);
}
