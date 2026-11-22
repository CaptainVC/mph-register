using MPHRegister.Shared.Exceptions;

namespace MPHRegister.Api.Middleware;

/// <summary>Turns service exceptions into the { errors: [...] } replies the screens show.</summary>
public sealed partial class ErrorHandlingMiddleware(RequestDelegate next, ILogger<ErrorHandlingMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        try
        {
            await next(context);
        }
        catch (AppValidationException ex)
        {
            await Write(context, StatusCodes.Status400BadRequest, ex.Errors);
        }
        catch (NotFoundException ex)
        {
            await Write(context, StatusCodes.Status404NotFound, [ex.Message]);
        }
        catch (BadHttpRequestException ex)
        {
            await Write(context, ex.StatusCode, [ex.StatusCode == StatusCodes.Status413PayloadTooLarge ? "The file is too large." : ex.Message]);
        }
        catch (DataFileException ex)
        {
            LogFailure(logger, ex);
            await Write(context, StatusCodes.Status500InternalServerError, [ex.Message]);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            LogFailure(logger, ex);
            await Write(context, StatusCodes.Status500InternalServerError, [$"Something went wrong: {ex.Message}"]);
        }
    }

    private static Task Write(HttpContext context, int status, IReadOnlyList<string> errors)
    {
        if (context.Response.HasStarted) return Task.CompletedTask;
        context.Response.Clear();
        context.Response.StatusCode = status;
        context.Response.Headers.CacheControl = "no-store";
        return context.Response.WriteAsJsonAsync(new { errors }, context.RequestAborted);
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "Request failed")]
    private static partial void LogFailure(ILogger logger, Exception exception);
}
