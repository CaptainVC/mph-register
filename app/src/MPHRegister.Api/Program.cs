using MPHRegister.Api.Configuration;
using MPHRegister.Api.Hosting;
using MPHRegister.Api.Modules;
using MPHRegister.Data.Config;
using MPHRegister.Data.Database;
using MPHRegister.Services.Settings;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Enums;
using MPHRegister.Shared.Exceptions;

var options = AppOptions.FromEnvironment();
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
builder.Services.AddMphData(options.DataDirectory, options.DataFolderSource).AddMphServices().AddMphApi();
var app = builder.Build();

try
{
    app.Services.GetRequiredService<IDatabaseInitializer>().Initialize();
}
catch (Exception ex) when (ex is DataFileException or Microsoft.Data.Sqlite.SqliteException or IOException or UnauthorizedAccessException)
{
    await Console.Error.WriteLineAsync(ex.Message);
    await Console.Error.WriteLineAsync("Press Enter to close.");
    Console.ReadLine();
    return;
}

app.UseMphApi();
var webFiles = ApiModule.WebFiles();
app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = webFiles });
app.UseStaticFiles(new StaticFileOptions { FileProvider = webFiles });
app.MapControllers();

app.Lifetime.ApplicationStarted.Register(() =>
{
    if (options.OpenBrowser) LocalHost.OpenWindow(options.BaseUri);
});

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
