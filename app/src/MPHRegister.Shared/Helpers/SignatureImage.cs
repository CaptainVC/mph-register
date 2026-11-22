namespace MPHRegister.Shared.Helpers;

/// <summary>The bill signature picture, kept in the config file as a data URL.</summary>
public static class SignatureImage
{
    public const string Png = "image/png";
    public const string Jpeg = "image/jpeg";

    private static readonly byte[] PngMagic = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static readonly byte[] JpegMagic = [0xFF, 0xD8, 0xFF];

    /// <summary>"image/png", "image/jpeg", or null when the bytes are neither.</summary>
    public static string? ContentType(ReadOnlySpan<byte> image)
    {
        if (image.StartsWith(PngMagic)) return Png;
        return image.StartsWith(JpegMagic) ? Jpeg : null;
    }

    public static string Encode(byte[] image)
    {
        ArgumentNullException.ThrowIfNull(image);
        var type = ContentType(image) ?? throw new ArgumentException("Not a PNG or JPG picture.", nameof(image));
        return $"data:{type};base64,{Convert.ToBase64String(image)}";
    }

    public static bool TryDecode(string? dataUrl, out byte[] image, out string contentType)
    {
        image = [];
        contentType = string.Empty;
        var text = (dataUrl ?? string.Empty).Trim();
        var comma = text.IndexOf(',', StringComparison.Ordinal);
        if (!text.StartsWith("data:", StringComparison.OrdinalIgnoreCase) || comma < 0
            || !text[..comma].EndsWith(";base64", StringComparison.OrdinalIgnoreCase)) return false;
        try
        {
            image = Convert.FromBase64String(text[(comma + 1)..]);
        }
        catch (FormatException)
        {
            return false;
        }
        var type = ContentType(image);
        if (type is null) return false;
        contentType = type;
        return true;
    }
}
