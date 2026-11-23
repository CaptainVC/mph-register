namespace MPHRegister.Data.Entities;

public sealed record InvoiceUndoEntity(
    long InvoiceId,
    string InvoiceNo,
    string Fy,
    int Serial,
    string Snapshot,
    string UndoneAt);
