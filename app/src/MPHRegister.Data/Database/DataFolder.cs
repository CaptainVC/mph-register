using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Enums;

namespace MPHRegister.Data.Database;

/// <summary>Finds the folder holding the data file and the config file.</summary>
public static class DataFolder
{
    /// <summary>
    /// MPH_DATA_DIR when set; else a "MPH Register Data" folder next to the app if one exists (app and data can then
    /// travel together on a pendrive or live on D:\); else Documents\MPH Register Data.
    /// </summary>
    public static (string Path, DataFolderSource Source) Resolve(string? environmentValue, string appDirectory, string documentsDirectory)
    {
        if (!string.IsNullOrWhiteSpace(environmentValue)) return (System.IO.Path.GetFullPath(environmentValue.Trim()), DataFolderSource.Environment);
        var nextToApp = System.IO.Path.Combine(appDirectory ?? string.Empty, Formats.DataFolderName);
        if (!string.IsNullOrEmpty(appDirectory) && Directory.Exists(nextToApp)) return (System.IO.Path.GetFullPath(nextToApp), DataFolderSource.NextToApp);
        if (string.IsNullOrWhiteSpace(documentsDirectory)) return (System.IO.Path.GetFullPath(nextToApp), DataFolderSource.NextToApp);
        return (System.IO.Path.Combine(documentsDirectory, Formats.DataFolderName), DataFolderSource.Documents);
    }
}
