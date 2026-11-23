using FluentValidation;
using MPHRegister.Services.Arrivals;
using MPHRegister.Services.Billing;
using MPHRegister.Services.Dashboard;
using MPHRegister.Services.Entries;
using MPHRegister.Services.Imports.Aawak;
using MPHRegister.Services.Imports.Bills;
using MPHRegister.Services.Imports.Inward;
using MPHRegister.Services.Interfaces;
using MPHRegister.Services.Masters;
using MPHRegister.Services.Pdf;
using MPHRegister.Services.Settings;
using MPHRegister.Services.Validators;

namespace MPHRegister.Api.Modules;

public static class ServiceModule
{
    public static IServiceCollection AddMphServices(this IServiceCollection services)
    {
        services.AddSingleton(TimeProvider.System);
        services.AddValidatorsFromAssemblyContaining<EntryInputValidator>(ServiceLifetime.Singleton);
        services.AddSingleton<IInvoicePdfService, BrowserPdfService>();
        services.AddSingleton<BillLineSizer>();
        services.AddSingleton<ZeroSlipCache>();
        services.AddScoped<IEntryLinker, EntryLinker>();
        services.AddScoped<IEntryReader, EntryReader>();
        services.AddScoped<IMasterReader, MasterReader>();
        services.AddScoped<IEntryService, EntryService>();
        services.AddScoped<IMasterService, MasterService>();
        services.AddScoped<ISettingsService, SettingsService>();
        services.AddScoped<IInfoService, InfoService>();
        services.AddScoped<IBillingService, BillingService>();
        services.AddScoped<IInvoiceService, InvoiceService>();
        services.AddScoped<IInwardImportService, InwardImportService>();
        services.AddScoped<IBillImportService, BillImportService>();
        services.AddScoped<IBillExportService, BillExportService>();
        services.AddScoped<IDashboardService, DashboardService>();
        services.AddScoped<ArrivalReader>();
        services.AddScoped<ArrivalLinker>();
        services.AddScoped<IArrivalService, ArrivalService>();
        services.AddScoped<IAawakImportService, AawakImportService>();
        return services;
    }
}
