using MPHRegister.Contracts.Updates;

namespace MPHRegister.Services.Interfaces;

public interface IRollbackService
{
    RollbackStatusDto Status();

    /// <summary>The version gone back from, which is then not offered again by itself.</summary>
    string? SkippedVersion();

    /// <summary>Checks that going back is possible (and confirmed when it undoes changes) and makes the copy of the app that does it.</summary>
    RollbackPlan Prepare(bool undoChanges);
}

/// <summary>Helper is a copy of this app that waits for it to close, then puts the older version (and, with Restore, the data) back.</summary>
public sealed record RollbackPlan(string Helper, string App, string DataDirectory, bool Restore);
