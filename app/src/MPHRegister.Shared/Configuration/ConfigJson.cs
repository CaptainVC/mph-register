using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MPHRegister.Shared.Configuration;

/// <summary>How the config file is written: indented, readable characters (₹, →) kept as they are, enums as words.</summary>
public static class ConfigJson
{
    public static readonly JsonSerializerOptions Options = Create();

    public static string Serialize(AppConfig config) => JsonSerializer.Serialize(config, Options) + Environment.NewLine;

    /// <summary>Reads the file text; comments and trailing commas left by hand edits are allowed.</summary>
    public static AppConfig Deserialize(string json) =>
        JsonSerializer.Deserialize<AppConfig>(json, Options) ?? throw new JsonException("The file is empty.");

    private static JsonSerializerOptions Create()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            WriteIndented = true,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            ReadCommentHandling = JsonCommentHandling.Skip,
            AllowTrailingCommas = true,
        };
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase, allowIntegerValues: false));
        options.MakeReadOnly(populateMissingResolver: true);
        return options;
    }
}
