using MPHRegister.Api.Hosting;

namespace MPHRegister.UnitTests.Api;

public sealed class LocalHostTests
{
    [Fact]
    public void EdgeOpensTheAppWindowMaximised()
    {
        var arguments = LocalHost.EdgeArguments(new Uri("http://127.0.0.1:5151"));

        Assert.Equal("--app=http://127.0.0.1:5151/ --start-maximized", arguments);
    }
}
