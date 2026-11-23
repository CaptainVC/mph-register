using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace MPHRegister.Services.Pdf;

/// <summary>Minimal Chrome DevTools Protocol client (flat sessions) for one headless browser.</summary>
internal sealed class DevToolsClient : IAsyncDisposable
{
    private readonly ClientWebSocket socket = new();
    private int nextId;

    public static async Task<DevToolsClient> ConnectAsync(Uri endpoint, CancellationToken cancellationToken)
    {
        var client = new DevToolsClient();
        client.socket.Options.KeepAliveInterval = TimeSpan.Zero;
        await client.socket.ConnectAsync(endpoint, cancellationToken);
        return client;
    }

    public async Task<JsonElement> SendAsync(string method, object? parameters, string? sessionId, CancellationToken cancellationToken)
    {
        var id = Interlocked.Increment(ref nextId);
        var message = new JsonObject { ["id"] = id, ["method"] = method, ["params"] = JsonSerializer.SerializeToNode(parameters ?? new { }) };
        if (sessionId is not null) message["sessionId"] = sessionId;
        await socket.SendAsync(Encoding.UTF8.GetBytes(message.ToJsonString()), WebSocketMessageType.Text, true, cancellationToken);
        while (true)
        {
            using var reply = await ReceiveAsync(cancellationToken);
            var root = reply.RootElement;
            if (!root.TryGetProperty("id", out var replyId) || replyId.GetInt32() != id) continue;
            if (root.TryGetProperty("error", out var error))
                throw new InvalidOperationException($"{method}: {error.GetProperty("message").GetString()}");
            return root.GetProperty("result").Clone();
        }
    }

    private async Task<JsonDocument> ReceiveAsync(CancellationToken cancellationToken)
    {
        var buffer = new byte[64 * 1024];
        using var message = new MemoryStream();
        while (true)
        {
            var result = await socket.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close) throw new InvalidOperationException("The browser closed the connection.");
            await message.WriteAsync(buffer.AsMemory(0, result.Count), cancellationToken);
            if (result.EndOfMessage) break;
        }
        message.Position = 0;
        return await JsonDocument.ParseAsync(message, cancellationToken: cancellationToken);
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (socket.State == WebSocketState.Open)
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, null, timeout.Token);
            }
        }
        catch (Exception ex) when (ex is WebSocketException or OperationCanceledException)
        {
            // Ignore close errors during disposal.
        }
        socket.Dispose();
    }
}
