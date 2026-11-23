namespace MPHRegister.Contracts.Entries;

/// <summary>One field an import changed in an entry: <c>Field</c> is its column title, <c>Was</c> and <c>Now</c> the values ("" is blank).</summary>
public sealed record ImportFieldChange(string Field, string Was, string Now);

/// <summary>One dispatch (number 1, 2, ...) an import added (no <c>Was</c>), changed or replaced.</summary>
public sealed record ImportDispatchChange(int Number, DispatchDto? Was, DispatchDto? Now);

/// <summary>
/// What an import changed in an entry, worked out by comparing the entry before and after: the fields and dispatches it
/// changed, and what follows from them (NAG, NETT THAN, BALANCE).
/// </summary>
public sealed record ImportChangeDetails(
    IReadOnlyList<ImportFieldChange> Fields,
    IReadOnlyList<ImportDispatchChange> Dispatches,
    IReadOnlyList<ImportFieldChange> Effects);

/// <summary>An import that touched an entry: <c>Details</c> is null when what it changed was not recorded (older imports).</summary>
public sealed record ImportEventDto(
    string Action, string FileName, string ImportedAt, string RegisterMonth, int? SourceRow, string Changes, ImportChangeDetails? Details);

/// <summary>
/// The imports that matter for an entry, newest first: the latest one that updated it, and the one that added it. Earlier
/// updates are not kept.
/// </summary>
public sealed record ImportHistoryDto(long EntryId, IReadOnlyList<ImportEventDto> Events);
