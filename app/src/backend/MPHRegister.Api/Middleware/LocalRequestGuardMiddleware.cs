using MPHRegister.Shared.Constants;

namespace MPHRegister.Api.Middleware;

/// <summary>
/// Only this computer may use the app: requests must be addressed to 127.0.0.1/localhost (blocks DNS rebinding) and
/// every change must carry the X-MPH-Request header, which other websites cannot add without a CORS preflight.
/// </summary>
public sealed class LocalRequestGuardMiddleware(RequestDelegate next)
{
    public Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (context.Request.Host.Host is not ("127.0.0.1" or "localhost"))
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return Task.CompletedTask;
        }
        if (context.Request.Path.StartsWithSegments("/api") && !HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method)
            && context.Request.Headers[HeaderNames.AppRequest] != "1")
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        }
        var headers = context.Response.Headers;
        headers.XContentTypeOptions = "nosniff";
        headers.XFrameOptions = "DENY";
        // Answers are never kept; the screens' files may be, but are checked with the app on every use (ETag / Last-Modified
        // answer 304 while unchanged), so an updated app's files are always picked up.
        headers.CacheControl = context.Request.Path.StartsWithSegments("/api") ? "no-store" : "no-cache";
        headers["Referrer-Policy"] = "no-referrer";
        return next(context);
    }
}
