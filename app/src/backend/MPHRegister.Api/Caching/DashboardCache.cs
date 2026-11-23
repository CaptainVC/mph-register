using System.Globalization;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using MPHRegister.Data.Config;
using MPHRegister.Data.Database;
using MPHRegister.Shared.Configuration;
using MPHRegister.Shared.Helpers;

namespace MPHRegister.Api.Caching;

/// <summary>
/// The last dashboard answers, each tagged with what it was worked out from: the data stamp (any commit, in the app or not,
/// changes it), the config file version in use, today's date and the query. A request whose tag is unchanged is answered
/// from here, or with 304 Not Modified, without reading the data at all.
/// </summary>
public sealed class DashboardCache(DataRevision revision, IConfigStore config, TimeProvider clock)
{
    private const int MaxAnswers = 32;

    private readonly ConditionalWeakTable<AppConfig, object> configIds = new();
    private readonly Lock gate = new();
    private readonly Dictionary<string, (string Tag, byte[] Body)> answers = new(StringComparer.Ordinal);
    private long configs;

    /// <summary>The ETag (quoted) an answer to <paramref name="query"/> would have now; read it before reading the data.</summary>
    public string Tag(string query)
    {
        var configId = configIds.GetValue(config.Current, _ => Interlocked.Increment(ref configs));
        var basis = string.Create(CultureInfo.InvariantCulture, $"{revision.Stamp()}|{configId}|{Dates.Iso(Dates.Today(clock))}|{query}");
        return $"\"{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(basis)), 0, 16)}\"";
    }

    public byte[]? Body(string query, string tag)
    {
        lock (gate)
        {
            return answers.TryGetValue(query, out var kept) && kept.Tag == tag ? kept.Body : null;
        }
    }

    public byte[] Keep(string query, string tag, byte[] body)
    {
        lock (gate)
        {
            if (answers.Count >= MaxAnswers && !answers.ContainsKey(query)) answers.Clear();
            answers[query] = (tag, body);
        }
        return body;
    }
}
