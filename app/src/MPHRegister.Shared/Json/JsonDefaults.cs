using System.Text.Json;
using System.Text.Json.Serialization;

namespace MPHRegister.Shared.Json;

public static class JsonDefaults
{
    public static readonly JsonSerializerOptions Options = Create();

    public static void Apply(JsonSerializerOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        options.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        options.PropertyNameCaseInsensitive = true;
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
    }

    private static JsonSerializerOptions Create()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Apply(options);
        return options;
    }
}
