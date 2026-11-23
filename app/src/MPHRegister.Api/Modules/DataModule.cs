using MPHRegister.Data.Config;
using MPHRegister.Data.Database;
using MPHRegister.Data.Repositories;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Shared.Enums;

namespace MPHRegister.Api.Modules;

public static class DataModule
{
    public static IServiceCollection AddMphData(this IServiceCollection services, string dataDirectory, DataFolderSource source)
    {
        DapperSetup.Configure();
        services.AddSingleton(new DataOptions { DataDirectory = dataDirectory, Source = source });
        services.AddSingleton<IConnectionFactory, SqliteConnectionFactory>();
        services.AddSingleton<IBackupService, BackupService>();
        services.AddSingleton<IConfigStore, ConfigStore>();
        services.AddSingleton<IDatabaseInitializer, DatabaseInitializer>();
        services.AddScoped<IDbSession, DbSession>();
        services.AddScoped<ISettingsRepository, SettingsRepository>();
        services.AddScoped<IMasterUsageRepository, MasterUsageRepository>();
        services.AddScoped<IEntryRepository, EntryRepository>();
        services.AddScoped<IInvoiceRepository, InvoiceRepository>();
        services.AddScoped<IBilledElsewhereRepository, BilledElsewhereRepository>();
        services.AddScoped<IImportLogRepository, ImportLogRepository>();
        services.AddScoped<IDashboardRepository, DashboardRepository>();
        services.AddScoped<IBillExportRepository, BillExportRepository>();
        services.AddScoped<IArrivalRepository, ArrivalRepository>();
        return services;
    }
}
