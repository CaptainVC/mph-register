namespace MPHRegister.Shared.Constants;

/// <summary>What an inward import did to an entry, as kept in import_batch_entries.action.</summary>
public static class ImportMarks
{
    /// <summary>A workbook row the month did not have yet: the import added it as a new entry.</summary>
    public const string Added = "added";

    /// <summary>A saved entry the workbook changed (or a later month's carryover moved into its own month).</summary>
    public const string Updated = "updated";
}
