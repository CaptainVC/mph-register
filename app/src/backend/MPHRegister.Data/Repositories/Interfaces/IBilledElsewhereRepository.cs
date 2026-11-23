namespace MPHRegister.Data.Repositories.Interfaces;

public interface IBilledElsewhereRepository
{
    int Mark(long entryId, string note, string at);

    int Unmark(long entryId);
}
