namespace MPHRegister.Services.Billing;

/// <summary>
/// Decides which finish (and so which rate) an inward finish is billed under:
/// the party's own "bill as" list first, then the finish itself if the party has a rate for it,
/// then the finish's fallback list (e.g. Gotka S2G → S2G, SGZ → SGJ/SGB) for the first finish the party has a rate for.
/// </summary>
public sealed class FinishResolver(
    IReadOnlyDictionary<string, string> billAs,
    IReadOnlyDictionary<string, decimal> rates,
    IReadOnlyDictionary<string, IReadOnlyList<string>> fallbacks)
{
    public string Resolve(string? finish)
    {
        finish ??= string.Empty;
        var mapped = billAs.FirstOrDefault(kv => string.Equals(kv.Key, finish, StringComparison.OrdinalIgnoreCase)).Value;
        if (!string.IsNullOrEmpty(mapped)) return mapped;
        if (finish.Length == 0 || HasRate(finish)) return finish;
        if (fallbacks.FirstOrDefault(kv => string.Equals(kv.Key, finish, StringComparison.OrdinalIgnoreCase)).Value is { } options)
        {
            var match = options.FirstOrDefault(HasRate);
            if (match is not null) return Canonical(match);
        }
        return finish;
    }

    public decimal? Rate(string? billFinish)
    {
        if (billFinish is null) return null;
        if (rates.TryGetValue(billFinish, out var rate)) return rate;
        var match = rates.FirstOrDefault(kv => string.Equals(kv.Key, billFinish, StringComparison.OrdinalIgnoreCase));
        return match.Key is null ? null : match.Value;
    }

    private bool HasRate(string finish) => Rate(finish) is not null;

    private string Canonical(string finish) => rates.Keys.FirstOrDefault(k => string.Equals(k, finish, StringComparison.OrdinalIgnoreCase)) ?? finish;
}
