using MPHRegister.Api.Configuration;
using MPHRegister.Api.Hosting;
using MPHRegister.Api.Modules;
using MPHRegister.Data.Config;
using MPHRegister.Data.Database;
using MPHRegister.Services.Settings;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Exceptions;

if (SelfUpdate.TryFinish(args)) return;

var options = AppOptions.FromEnvironment();
var started = SelfUpdate.TakeStartReason();
if (LocalHost.IsPortInUse(options.Port))
{
    Console.WriteLine($"MPH Register is already running at {options.BaseUri}.");
    if (options.OpenBrowser) LocalHost.OpenWindow(options.BaseUri);
    return;
}

var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = args, ContentRootPath = AppContext.BaseDirectory });
builder.WebHost.UseUrls(options.BaseUri.AbsoluteUri.TrimEnd('/'));
builder.WebHost.ConfigureKestrel(kestrel => kestrel.Limits.MaxRequestBodySize = Limits.MaxUploadBytes);
builder.Logging.SetMinimumLevel(LogLevel.Warning);
builder.Services.AddSingleton(options);
builder.Services.AddMphData(options.DataDirectory, options.DataFolderSource).AddMphServices().AddMphApi().AddMphUpdates(options.UpdateUrl);
var app = builder.Build();

try
{
    SelfUpdate.SaveRollbackPoint(started, options.DataDirectory);
    app.Services.GetRequiredService<IDatabaseInitializer>().Initialize();
}
catch (Exception ex) when (ex is DataFileException or Microsoft.Data.Sqlite.SqliteException or IOException or UnauthorizedAccessException)
{
    // Pooled connections keep the file open; the user may now replace it from a backup while this window waits.
    Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
    await Console.Error.WriteLineAsync(ex.Message);
    await Console.Error.WriteLineAsync("Press Enter to close.");
    Console.ReadLine();
    return;
}

app.Use((context, next) =>
{
    SelfUpdate.NotePageRequest();
    return next(context);
});
app.UseMphApi();
var webFiles = ApiModule.WebFiles();
app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = webFiles });
app.UseStaticFiles(new StaticFileOptions { FileProvider = webFiles });
app.MapControllers();

app.Lifetime.ApplicationStarted.Register(() =>
{
    SelfUpdate.RemoveLeftovers(SelfUpdate.InstalledAppPath());
    if (!options.OpenBrowser) return;
    if (started.AfterUpdate) SelfUpdate.OpenWindowUnlessPageReturns(options.BaseUri, TimeSpan.FromSeconds(8));
    else LocalHost.OpenWindow(options.BaseUri);
});

app.Lifetime.ApplicationStopping.Register(Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools);
app.Lifetime.ApplicationStopped.Register(() => DatabaseShutdown.Close(app.Services.GetRequiredService<IConnectionFactory>()));

var data = app.Services.GetRequiredService<DataOptions>();
Console.WriteLine($"MPH Register {InfoService.Version} running at {options.BaseUri.AbsoluteUri.TrimEnd('/')}");
Console.WriteLine($"Data folder ({DataFolderText(data.Source)}): {data.DataDirectory}");
Console.WriteLine($"Data file:   {data.DatabasePath}");
Console.WriteLine($"Config file: {data.ConfigPath}");
foreach (var notice in app.Services.GetRequiredService<IConfigStore>().Status.Notices) Console.WriteLine($"Note: {notice}");
Console.WriteLine("Keep this window open while working. Close it to stop.");
await app.RunAsync();

static string DataFolderText(DataFolderSource source) => source switch
{
    DataFolderSource.NextToApp => "next to the app",
    DataFolderSource.Documents => "in Documents",
    _ => "from MPH_DATA_DIR",
};

public partial class Program
{
    protected Program()
    {
    }
}
