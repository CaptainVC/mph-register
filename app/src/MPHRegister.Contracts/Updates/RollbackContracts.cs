namespace MPHRegister.Contracts.Updates;

/// <summary>
/// Whether the app can go back to the version it was updated from. UndoesChanges is true when the newer version changed how
/// the data or config file is stored: going back then puts both back to how they were at the update (UpdatedAt).
/// </summary>
public sealed record RollbackStatusDto(bool Available, string? Version, bool UndoesChanges, DateTimeOffset? UpdatedAt);

/// <summary>UndoChanges confirms that changes since the update may be undone.</summary>
public sealed record RollbackRequest(bool UndoChanges);
