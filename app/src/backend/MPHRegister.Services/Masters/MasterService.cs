using FluentValidation;
using MPHRegister.Contracts.Masters;
using MPHRegister.Data.Config;
using MPHRegister.Data.Database;
using MPHRegister.Data.Repositories.Interfaces;
using MPHRegister.Services.Interfaces;
using MPHRegister.Services.Mapping;
using MPHRegister.Services.Validators;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Exceptions;
using MPHRegister.Shared.Extensions;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Services.Masters;

public sealed class MasterService(
    IDbSession session,
    IConfigStore config,
    IMasterUsageRepository usage,
    IMasterReader reader,
    IValidator<PartyInput> partyValidator,
    IValidator<SisterGroupInput> sisterGroupValidator,
    IValidator<RateInput> rateValidator,
    IValidator<FinishInput> finishValidator,
    IValidator<GroupInput> groupValidator,
    IValidator<StyleInput> styleValidator,
    IValidator<ColorInput> colorValidator,
    IValidator<TransporterInput> transporterValidator,
    IArrivalRepository arrivals) : IMasterService
{
    private const int NamesInMessage = 8;

    public MastersDto GetMasters()
    {
        var current = config.Current;
        return new MastersDto(
            current.Parties.OrderByDescending(p => p.Active).ThenBy(p => p.Name, StringComparer.OrdinalIgnoreCase).Select(p => new MasterItem(p.Name, p.Active, p.SisterGroup)).ToList(),
            current.Finishes.OrderByDescending(f => f.Active).ThenBy(f => f.Name, StringComparer.OrdinalIgnoreCase).Select(f => new MasterItem(f.Name, f.Active)).ToList(),
            current.Transporters.OrderByDescending(t => t.Active).ThenBy(t => t.Name, StringComparer.OrdinalIgnoreCase).Select(t => new MasterItem(t.Name, t.Active)).ToList());
    }

    public FullMastersDto GetFull() => new(reader.Parties(), reader.Finishes(), reader.Groups(), reader.Styles(), reader.Colors());

    public PartyDto SaveParty(PartyInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var errors = partyValidator.ErrorsFor(input);
        var index = ConfigIndex.For(config.Current);
        var name = input.Name.NormalizeName();
        var existing = Existing(input.OriginalName, index.Party, "Party", errors);
        var clash = name.Length > 0 ? index.Party(name) : null;
        if (clash is not null && !ReferenceEquals(clash, existing)) errors.Add($"A party named \"{clash.Name}\" already exists.");

        var styleName = input.BillingStyle.NormalizeName();
        var style = styleName.Length == 0 ? index.FallbackStyle : index.Style(styleName);
        if (style is null) errors.Add($"Billing style \"{styleName}\" is not in the list of billing styles.");
        var color = ConfigNormalizer.ColorReference(input.Color);
        if (!index.IsKnownColor(color)) errors.Add($"Colour \"{color}\" is not in the colour list.");

        var billAs = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (from, to) in input.BillAs ?? new Dictionary<string, string>())
        {
            var fromFinish = index.Finish(from);
            var toFinish = index.Finish(to);
            if (fromFinish is null || toFinish is null) errors.Add($"Bill-as finish \"{from}\" → \"{to}\" uses a finish that is not in the finish list.");
            else if (!Same(fromFinish.Name, toFinish.Name)) billAs[fromFinish.Name] = toFinish.Name;
        }
        Dictionary<string, decimal>? rates = null;
        if (input.Rates is not null)
        {
            rates = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
            foreach (var (finish, rate) in input.Rates)
            {
                if (rate is null) continue;
                var known = index.Finish(finish);
                if (known is null) errors.Add($"Rate given for unknown finish \"{finish}\".");
                else if (RateProblem(known.Name, rate.Value) is { } problem) errors.Add(problem);
                else rates[known.Name] = rate.Value;
            }
        }
        if (errors.Count > 0) throw new AppValidationException(errors);

        var party = (existing ?? new PartyConfig()) with
        {
            Name = name,
            Active = input.Active,
            Address = input.Address.NormalizeName(),
            State = input.State.NormalizeName(),
            Gstin = Gstin.Clean(input.Gstin),
            DiscountPercent = input.Discount,
            Color = color,
            SisterGroup = input.SisterGroup is null ? existing?.SisterGroup ?? string.Empty : input.SisterGroup.NormalizeName(),
            BillingStyle = style!.Name,
            BillBeforeDispatch = input.BillBeforeDispatch,
            NoBillNeeded = input.NoBillNeeded ?? existing?.NoBillNeeded ?? false,
            BillAs = billAs,
            Rates = rates ?? existing?.Rates ?? new Dictionary<string, decimal>(),
        };
        var renamedFrom = existing is not null && !string.Equals(existing.Name, name, StringComparison.Ordinal) ? existing.Name : null;
        Change(
            c =>
            {
                var parties = existing is null ? [.. c.Parties, party] : c.Parties.Select(p => Same(p.Name, existing.Name) ? party : p).ToList();
                return c with { Parties = parties };
            },
            renamedFrom is null ? null : () => usage.RenameParty(renamedFrom, name));
        return reader.Party(name)!;
    }

    public SisterGroupDto SaveSisterGroup(SisterGroupInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var errors = sisterGroupValidator.ErrorsFor(input);
        var current = config.Current;
        var index = ConfigIndex.For(current);
        var name = input.Name.NormalizeName();
        var original = input.OriginalName.NormalizeName();
        if (original.Length > 0 && !current.Parties.Any(p => Same(p.SisterGroup, original)))
            errors.Add($"Sister-firm group \"{original}\" no longer exists. Refresh the page.");
        var clash = name.Length > 0 && !Same(name, original) ? current.Parties.FirstOrDefault(p => Same(p.SisterGroup, name)) : null;
        if (clash is not null) errors.Add($"A sister-firm group named \"{clash.SisterGroup}\" already exists.");

        var members = new List<PartyConfig>();
        foreach (var partyName in (input.Parties ?? []).Where(n => n.NormalizeName().Length > 0))
        {
            var party = index.Party(partyName);
            if (party is null) errors.Add($"Party \"{partyName.NormalizeName()}\" is not in the party list.");
            else if (!members.Contains(party)) members.Add(party);
        }
        if (errors.Count > 0) throw new AppValidationException(errors);

        var inGroup = members.Select(m => m.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        PartyConfig Regroup(PartyConfig p)
        {
            if (inGroup.Contains(p.Name)) return p with { SisterGroup = name };
            return original.Length > 0 && Same(p.SisterGroup, original) ? p with { SisterGroup = string.Empty } : p;
        }

        Change(c => c with { Parties = c.Parties.Select(Regroup).ToList() });
        return new SisterGroupDto(name, members.Select(m => m.Name).Order(StringComparer.OrdinalIgnoreCase).ToList());
    }

    public void DeleteSisterGroup(string? name)
    {
        var group = name.NormalizeName();
        if (!config.Current.Parties.Any(p => group.Length > 0 && Same(p.SisterGroup, group)))
            throw new NotFoundException($"Sister-firm group \"{group}\" is not in the list.");
        Change(c => c with { Parties = c.Parties.Select(p => Same(p.SisterGroup, group) ? p with { SisterGroup = string.Empty } : p).ToList() });
    }

    public PartyDto SaveRate(RateInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var errors = rateValidator.ErrorsFor(input);
        var index = ConfigIndex.For(config.Current);
        var party = index.Party(input.Party);
        if (party is null && !string.IsNullOrWhiteSpace(input.Party)) errors.Add($"Party \"{input.Party.NormalizeName()}\" is not in the party list.");
        var finish = index.Finish(input.Finish);
        if (finish is null && !string.IsNullOrWhiteSpace(input.Finish)) errors.Add($"Finish \"{input.Finish.NormalizeName()}\" is not in the finish list.");
        string? original = null;
        if (party is not null && !string.IsNullOrWhiteSpace(input.OriginalFinish))
        {
            original = party.Rates.Keys.FirstOrDefault(k => Same(k, input.OriginalFinish.NormalizeName()));
            if (original is null) errors.Add($"{party.Name} has no rate for {input.OriginalFinish.NormalizeName()} any more. Refresh the page.");
        }
        if (party is not null && finish is not null && party.Rates.Keys.Any(k => Same(k, finish.Name)) && !Same(original, finish.Name))
            errors.Add(original is null
                ? $"{party.Name} already has a rate for {finish.Name}; edit that row instead."
                : $"{party.Name} already has a rate for {finish.Name}.");
        if (errors.Count > 0) throw new AppValidationException(errors);

        var rates = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        var placed = false;
        foreach (var (key, value) in party!.Rates)
        {
            if (Same(key, original) || Same(key, finish!.Name))
            {
                if (!placed) rates[finish!.Name] = input.Rate!.Value;
                placed = true;
                continue;
            }
            rates[key] = value;
        }
        if (!placed) rates[finish!.Name] = input.Rate!.Value;
        Change(c => c with { Parties = c.Parties.Select(p => Same(p.Name, party.Name) ? p with { Rates = rates } : p).ToList() });
        return reader.Party(party.Name)!;
    }

    public PartyDto DeleteRate(string? party, string? finish)
    {
        var index = ConfigIndex.For(config.Current);
        var found = index.Party(party) ?? throw new NotFoundException($"Party \"{party.NormalizeName()}\" is not in the party list.");
        var key = found.Rates.Keys.FirstOrDefault(k => Same(k, finish.NormalizeName()))
            ?? throw new NotFoundException($"{found.Name} has no rate for {finish.NormalizeName()}.");
        var rates = found.Rates.Where(kv => kv.Key != key).ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.OrdinalIgnoreCase);
        Change(c => c with { Parties = c.Parties.Select(p => Same(p.Name, found.Name) ? p with { Rates = rates } : p).ToList() });
        return reader.Party(found.Name)!;
    }

    public FinishDto SaveFinish(FinishInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var errors = finishValidator.ErrorsFor(input);
        var index = ConfigIndex.For(config.Current);
        var name = input.Name.NormalizeName();
        var existing = Existing(input.OriginalName, index.Finish, "Finish", errors);
        var clash = name.Length > 0 ? index.Finish(name) : null;
        if (clash is not null && !ReferenceEquals(clash, existing)) errors.Add($"A finish named \"{clash.Name}\" already exists.");
        var group = input.Group.NormalizeName();
        if (group.Length > 0)
        {
            var known = index.Group(group);
            if (known is null) errors.Add($"Finish group \"{group}\" is not in the group list.");
            else group = known.Name;
        }
        var color = ConfigNormalizer.ColorReference(input.Color);
        if (!index.IsKnownColor(color)) errors.Add($"Colour \"{color}\" is not in the colour list.");
        var fallback = new List<string>();
        foreach (var option in input.Fallback ?? [])
        {
            var known = index.Finish(option);
            if (known is null) errors.Add($"Fallback finish \"{option.NormalizeName()}\" is not in the finish list.");
            else if (!fallback.Contains(known.Name, StringComparer.OrdinalIgnoreCase)) fallback.Add(known.Name);
        }
        if (errors.Count > 0) throw new AppValidationException(errors);

        var finish = (existing ?? new FinishConfig()) with { Name = name, Active = input.Active, Group = group, Color = color, BillAsIfNoRate = fallback };
        var renamedFrom = existing is not null && !string.Equals(existing.Name, name, StringComparison.Ordinal) ? existing.Name : null;
        Change(
            c =>
            {
                var finishes = existing is null ? [.. c.Finishes, finish] : c.Finishes.Select(f => Same(f.Name, existing.Name) ? finish : f).ToList();
                if (renamedFrom is null) return c with { Finishes = finishes };
                string Swap(string value) => Same(value, renamedFrom) ? name : value;
                return c with
                {
                    Finishes = finishes.Select(f => f with { BillAsIfNoRate = f.BillAsIfNoRate.Select(Swap).ToList() }).ToList(),
                    Parties = c.Parties.Select(p => p with
                    {
                        Rates = p.Rates.ToDictionary(kv => Swap(kv.Key), kv => kv.Value, StringComparer.OrdinalIgnoreCase),
                        BillAs = p.BillAs.ToDictionary(kv => Swap(kv.Key), kv => Swap(kv.Value), StringComparer.OrdinalIgnoreCase),
                    }).ToList(),
                };
            },
            renamedFrom is null ? null : () => usage.RenameFinish(renamedFrom, name));
        return reader.Finishes().First(f => Same(f.Name, name));
    }

    public GroupDto SaveGroup(GroupInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var errors = groupValidator.ErrorsFor(input);
        var index = ConfigIndex.For(config.Current);
        var name = input.Name.NormalizeName();
        var existing = Existing(input.OriginalName, index.Group, "Finish group", errors);
        var clash = name.Length > 0 ? index.Group(name) : null;
        if (clash is not null && !ReferenceEquals(clash, existing)) errors.Add($"A finish group named \"{clash.Name}\" already exists.");
        if (errors.Count > 0) throw new AppValidationException(errors);

        var group = new FinishGroupConfig { Name = name, Active = input.Active };
        Change(c => c with
        {
            FinishGroups = existing is null ? [.. c.FinishGroups, group] : c.FinishGroups.Select(g => Same(g.Name, existing.Name) ? group : g).ToList(),
            Finishes = existing is null ? c.Finishes : c.Finishes.Select(f => Same(f.Group, existing.Name) ? f with { Group = name } : f).ToList(),
        });
        return reader.Groups().First(g => Same(g.Name, name));
    }

    public StyleDto SaveStyle(StyleInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var errors = styleValidator.ErrorsFor(input);
        var index = ConfigIndex.For(config.Current);
        var name = input.Name.NormalizeName();
        var existing = Existing(input.OriginalName, index.Style, "Billing style", errors);
        var clash = name.Length > 0 ? index.Style(name) : null;
        if (clash is not null && !ReferenceEquals(clash, existing)) errors.Add($"A billing style named \"{clash.Name}\" already exists.");
        if (errors.Count > 0) throw new AppValidationException(errors);

        var style = new BillingStyle
        {
            Name = name,
            Description = (input.Description ?? string.Empty).Trim(),
            GpnColumn = input.GpnColumn,
            DnColumn = input.DnColumn,
            LotColumn = input.LotColumn,
            Lines = input.Lines,
            Order = input.Order,
            ShowQuantityBreakdown = input.ShowQuantityBreakdown,
            CombineSmallEntries = input.CombineSmallEntries,
        };
        Change(c => c with
        {
            BillingStyles = existing is null ? [.. c.BillingStyles, style] : c.BillingStyles.Select(s => Same(s.Name, existing.Name) ? style : s).ToList(),
            Parties = existing is null ? c.Parties : c.Parties.Select(p => Same(p.BillingStyle, existing.Name) ? p with { BillingStyle = name } : p).ToList(),
        });
        return reader.Styles().First(s => Same(s.Name, name));
    }

    public void DeleteStyle(string? name)
    {
        var current = config.Current;
        var index = ConfigIndex.For(current);
        var style = index.Style(name) ?? throw new NotFoundException($"Billing style \"{name.NormalizeName()}\" is not in the list.");
        var users = current.Parties.Where(p => ReferenceEquals(index.Style(p.BillingStyle), style)).Select(p => p.Name).ToList();
        if (users.Count > 0) throw new AppValidationException($"\"{style.Name}\" is used by {Names(users)}. Give them another style first.");
        if (current.BillingStyles.Count == 1) throw new AppValidationException("Keep at least one billing style.");
        Change(c => c with { BillingStyles = c.BillingStyles.Where(s => !Same(s.Name, style.Name)).ToList() });
    }

    public ColorDto SaveColor(ColorInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var errors = colorValidator.ErrorsFor(input);
        var index = ConfigIndex.For(config.Current);
        var name = (input.Name ?? string.Empty).ToLowerInvariant().NormalizeName();
        var existing = Existing(input.OriginalName, index.Color, "Colour", errors);
        var clash = name.Length > 0 ? index.Color(name) : null;
        if (clash is not null && !ReferenceEquals(clash, existing)) errors.Add($"A colour named \"{clash.Name}\" already exists.");
        if (errors.Count > 0) throw new AppValidationException(errors);

        var color = new NamedColor { Name = name, Hex = input.Hex!.Trim().ToLowerInvariant() };
        var renamedFrom = existing is not null && !Same(existing.Name, name) ? existing.Name : null;
        Change(c => c with
        {
            Colors = existing is null ? [.. c.Colors, color] : c.Colors.Select(x => Same(x.Name, existing.Name) ? color : x).ToList(),
            Parties = renamedFrom is null ? c.Parties : c.Parties.Select(p => Same(p.Color, renamedFrom) ? p with { Color = name } : p).ToList(),
            Finishes = renamedFrom is null ? c.Finishes : c.Finishes.Select(f => Same(f.Color, renamedFrom) ? f with { Color = name } : f).ToList(),
        });
        return reader.Colors().First(c => Same(c.Name, name));
    }

    public void DeleteColor(string? name)
    {
        var current = config.Current;
        var color = ConfigIndex.For(current).Color(name) ?? throw new NotFoundException($"Colour \"{name.NormalizeName()}\" is not in the list.");
        var users = current.Parties.Where(p => Same(p.Color, color.Name)).Select(p => p.Name)
            .Concat(current.Finishes.Where(f => Same(f.Color, color.Name)).Select(f => $"finish {f.Name}"))
            .ToList();
        if (users.Count > 0) throw new AppValidationException($"\"{color.Name}\" is used by {Names(users)}. Give them another colour first.");
        Change(c => c with { Colors = c.Colors.Where(x => !Same(x.Name, color.Name)).ToList() });
    }

    public IReadOnlyList<TransporterDto> Transporters()
    {
        var used = arrivals.TransporterUsage().ToDictionary(u => u.Name, StringComparer.OrdinalIgnoreCase);
        return config.Current.Transporters
            .OrderByDescending(t => t.Active).ThenBy(t => t.Name, StringComparer.OrdinalIgnoreCase)
            .Select(t => new TransporterDto(t.Name, t.Active, t.OtherSpellings, t.OwnVehicle, used.GetValueOrDefault(t.Name)?.Arrivals ?? 0, used.GetValueOrDefault(t.Name)?.LastArrival))
            .ToList();
    }

    public TransporterDto SaveTransporter(TransporterInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var errors = transporterValidator.ErrorsFor(input);
        var index = ConfigIndex.For(config.Current);
        var name = input.Name.NormalizeName();
        var original = input.OriginalName.NormalizeName();
        var existing = original.Length == 0 ? null : config.Current.Transporters.FirstOrDefault(t => Same(t.Name, original));
        if (original.Length > 0 && existing is null) errors.Add($"Lorry wala \"{original}\" no longer exists. Refresh the page.");
        var target = name.Length > 0 ? config.Current.Transporters.FirstOrDefault(t => Same(t.Name, name)) : null;
        var merge = existing is not null && target is not null && !ReferenceEquals(existing, target);
        if (target is not null && !ReferenceEquals(target, existing) && !(merge && input.Merge))
            errors.Add(existing is null
                ? $"A lorry wala named \"{target.Name}\" already exists."
                : $"A lorry wala named \"{target.Name}\" already exists. Tick \"Merge\" to move {existing.Name}'s Aawak rows to {target.Name}.");
        var spellings = (input.OtherSpellings ?? []).Select(x => x.NormalizeName()).Where(x => x.Length > 0 && !Same(x, name)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        foreach (var spelling in spellings)
        {
            var owner = index.Transporter(spelling);
            if (owner is not null && !ReferenceEquals(owner, existing) && !ReferenceEquals(owner, target))
                errors.Add($"\"{spelling}\" is already {(Same(owner.Name, spelling) ? "a lorry wala" : $"another spelling of {owner.Name}")}.");
        }
        if (errors.Count > 0) throw new AppValidationException(errors);

        if (merge)
        {
            var joined = target!.OtherSpellings.Concat(spellings).Append(existing!.Name).Concat(existing.OtherSpellings)
                .Where(x => !Same(x, target.Name)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            var merged = target with { OtherSpellings = joined, Active = target.Active || existing.Active };
            Change(c => c with { Transporters = c.Transporters.Where(t => !Same(t.Name, existing.Name)).Select(t => Same(t.Name, target.Name) ? merged : t).ToList() },
                () => arrivals.RenameTransporter(existing.Name, target.Name));
            return Transporters().First(t => Same(t.Name, target.Name));
        }

        var saved = (existing ?? new TransporterConfig()) with { Name = name, Active = input.Active, OtherSpellings = spellings, OwnVehicle = input.OwnVehicle };
        var renamedFrom = existing is not null && !string.Equals(existing.Name, name, StringComparison.Ordinal) ? existing.Name : null;
        Change(
            c => c with { Transporters = existing is null ? [.. c.Transporters, saved] : c.Transporters.Select(t => Same(t.Name, existing.Name) ? saved : t).ToList() },
            renamedFrom is null ? null : () => arrivals.RenameTransporter(renamedFrom, name));
        return Transporters().First(t => Same(t.Name, name));
    }

    public void DeleteTransporter(string? name)
    {
        var current = config.Current;
        var transporter = current.Transporters.FirstOrDefault(t => Same(t.Name, name)) ?? throw new NotFoundException($"Lorry wala \"{name.NormalizeName()}\" is not in the list.");
        var used = arrivals.TransporterUsage().FirstOrDefault(u => Same(u.Name, transporter.Name))?.Arrivals ?? 0;
        if (used > 0) throw new AppValidationException($"\"{transporter.Name}\" is on {used} Aawak row{(used == 1 ? string.Empty : "s")}. Mark it inactive instead, or rename it to another lorry wala to merge the two.");
        Change(c => c with { Transporters = c.Transporters.Where(t => !Same(t.Name, transporter.Name)).ToList() });
    }

    internal static string? RateProblem(string finish, decimal rate)
    {
        if (rate <= 0 || rate > Limits.MaxRate) return $"Rate for {finish} must be more than 0 and at most {IndianNumbers.Format(Limits.MaxRate)}.";
        return decimal.Round(rate, 2) != rate ? $"Rate for {finish} can have at most 2 decimals." : null;
    }

    /// <summary>Saves a config change; when entries or bills in the data file change too, both are saved or neither is.</summary>
    private void Change(Func<AppConfig, AppConfig> change, Action? dataChange = null)
    {
        if (dataChange is null)
        {
            config.Update(change);
            return;
        }
        var before = config.Current;
        using var unit = session.Begin();
        dataChange();
        config.Update(change);
        try
        {
            unit.Commit();
        }
        catch
        {
            config.Save(before);
            throw;
        }
    }

    private static T? Existing<T>(string? originalName, Func<string?, T?> find, string what, List<string> errors)
        where T : class
    {
        var original = originalName.NormalizeName();
        if (original.Length == 0) return null;
        var found = find(original);
        if (found is null) errors.Add($"{what} \"{original}\" no longer exists. Refresh the page.");
        return found;
    }

    private static bool Same(string? a, string? b) => string.Equals(a.NormalizeName(), b.NormalizeName(), StringComparison.OrdinalIgnoreCase);

    private static string Names(List<string> names) =>
        names.Count <= NamesInMessage ? string.Join(", ", names) : $"{string.Join(", ", names.Take(NamesInMessage))} and {names.Count - NamesInMessage} more";
}
