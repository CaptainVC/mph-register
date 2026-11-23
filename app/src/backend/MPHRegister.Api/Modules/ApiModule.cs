using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.Extensions.FileProviders;
using MPHRegister.Api.Configuration;
using MPHRegister.Api.Hosting;
using MPHRegister.Api.Middleware;
using MPHRegister.Services.Billing;
using MPHRegister.Shared.Constants;
using MPHRegister.Shared.Json;

namespace MPHRegister.Api.Modules;

public static class ApiModule
{
    public static IServiceCollection AddMphApi(this IServiceCollection services)
    {
        services
            .AddControllers(options => options.SuppressImplicitRequiredAttributeForNonNullableReferenceTypes = true)
            .AddJsonOptions(options => JsonDefaults.Apply(options.JsonSerializerOptions))
            .ConfigureApiBehaviorOptions(options => options.InvalidModelStateResponseFactory = context =>
            {
                var errors = context.ModelState
                    .SelectMany(entry => entry.Value!.Errors.Select(e => Describe(entry.Key, e)))
                    .Distinct()
                    .ToList();
                return new BadRequestObjectResult(new { errors });
            });
        services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(options => options.MultipartBodyLengthLimit = Limits.MaxUploadBytes);
        services.AddSingleton(_ =>
        {
            using var template = WebFiles().GetFileInfo(BillTemplateFile).CreateReadStream();
            return BillGeometry.FromTemplate(template);
        });
        return services;
    }

    public const string BillTemplateFile = "assets/templates/bill-template.json";

    /// <summary>The screens (app/src/frontend), embedded in the exe under wwwroot, with each page put together from its parts.</summary>
    public static IFileProvider WebFiles() => new PageFileProvider(new ManifestEmbeddedFileProvider(typeof(AppOptions).Assembly, "wwwroot"));

    public static WebApplication UseMphApi(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        app.UseMiddleware<LocalRequestGuardMiddleware>();
        app.UseMiddleware<ErrorHandlingMiddleware>();
        return app;
    }

    private static string Describe(string field, ModelError error)
    {
        var name = field.TrimStart('$', '.');
        var message = error.ErrorMessage.Length > 0 ? error.ErrorMessage : error.Exception?.Message ?? "is not valid";
        if (message.Contains("JSON value could not be converted", StringComparison.Ordinal) || error.Exception is not null)
            return name.Length > 0 ? $"\"{name}\" has a value the app does not understand." : "The request could not be read.";
        return message;
    }
}
