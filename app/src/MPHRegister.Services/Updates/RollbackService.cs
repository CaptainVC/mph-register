using MPHRegister.Contracts.Updates;
using MPHRegister.Data.Database;
using MPHRegister.Services.Interfaces;
using MPHRegister.Shared.Exceptions;

namespace MPHRegister.Services.Updates;

/// <summary>Going back to the version this app was updated from (see <see cref="RollbackFiles"/>).</summary>
public sealed class RollbackService(DataOptions data, UpdateOptions options) : IRollbackService
{
    private static readonly RollbackStatusDto None = new(false, null, false, null);

    public RollbackStatusDto Status()
    {
        var point = Point();
        if (point is null) return None;
        var version = ReleaseVersion.TryParse(point.FromVersion, out var from) ? from.ToString(3) : null;
        return new RollbackStatusDto(true, version, RollbackFiles.NeedsRestore(data.DataDirectory, point), point.UpdatedAt);
    }

    public string? SkippedVersion() => RollbackFiles.SkippedVersion(data.DataDirectory);

    public RollbackPlan Prepare(bool undoChanges)
    {
        var point = Point() ?? throw new AppValidationException("There is no earlier version to go back to.");
        var restore = RollbackFiles.NeedsRestore(data.DataDirectory, point);
        if (restore && !undoChanges)
            throw new AppValidationException("Going back now undoes the changes made since the update. Confirm that first.");
        var app = options.AppPath!;
        var helper = UpdatePaths.RollbackHelper(app);
        try
        {
            File.Copy(app, helper, overwrite: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new AppValidationException($"Could not get the older version ready: {ex.Message}");
        }
        return new RollbackPlan(helper, app, data.DataDirectory, restore);
    }

    // Only for this app: it was put in place by an update (from the version in the point) and the older version is still there.
    private RollbackPoint? Point()
    {
        var app = options.AppPath;
        if (app is null || !File.Exists(UpdatePaths.Previous(app))) return null;
        var point = RollbackFiles.ReadPoint(data.DataDirectory);
        if (point is null || !ReleaseVersion.TryParse(point.ToVersion, out var to) || !ReleaseVersion.TryParse(options.CurrentVersion, out var current)) return null;
        return to == current ? point : null;
    }
}
