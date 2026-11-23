using System.Reflection;
using MPHRegister.Contracts.Settings;
using MPHRegister.Data.Config;
using MPHRegister.Data.Database;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Services.Interfaces;

namespace MPHRegister.Services.Settings;

public sealed class InfoService(DataOptions options, IConfigStore config, IEntryRepository entries) : IInfoService
{
    public static string Version { get; } =
        (Assembly.GetEntryAssembly() ?? typeof(InfoService).Assembly).GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0]
        ?? "0.0.0";

    public InfoDto Get()
    {
        var current = config.Current;
        var status = config.Status;
        return new InfoDto(Version, options.DatabasePath, options.BackupDirectory, options.ConfigPath, options.DataDirectory, options.Source,
            entries.Count(), current.Display.Theme, current.Display.ShowExcelImport, current.Firm.Name,
            status.Notices, status.Problem, current.Display.Language,
            current.Display.ShowBillingStyles, current.Display.ShowPartywise, current.Display.ShowBills, current.Display.ShowColors, current.Display.ShowDashboard, current.Display.ShowAawak);
    }
}
