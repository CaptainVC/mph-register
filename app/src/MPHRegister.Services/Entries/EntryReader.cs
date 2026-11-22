using MPHRegister.Contracts.Entries;
using MPHRegister.Data.Entities;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Services.Interfaces;
using MPHRegister.Services.Mapping;
using MPHRegister.Shared.Configuration;

namespace MPHRegister.Services.Entries;

public sealed class EntryReader(IEntryRepository entries, IImportLogRepository imports, IMasterReader masters) : IEntryReader
{
    public IReadOnlyList<EntryDto> Read(IReadOnlyList<EntryEntity> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);
        if (rows.Count == 0) return [];
        var dispatches = entries.Dispatches(rows.Select(r => r.Id).ToHashSet());
        var duplicates = entries.DuplicateInwardNumbers();
        var index = ConfigIndex.For(masters.Config);
        var marks = imports.LatestImportMarks();
        return rows.Select(r => EntryMapper.ToDto(r, dispatches.TryGetValue(r.Id, out var d) ? d : [], duplicates.Contains((r.RegisterMonth, r.InwardNo)),
                index.Party(r.Party)?.NoBillNeeded ?? false, marks.GetValueOrDefault(r.Id)))
            .ToList();
    }
}
