---
name: csharp-testing
description: xUnit、FluentAssertions、モッキング、統合テスト、テスト組織のベストプラクティスを使用したC#と.NETのテストパターン。
origin: ECC
---

# C#テストパターン

xUnit、FluentAssertions、最新のテストプラクティスを使用した.NETアプリケーションの包括的なテストパターン。

## 起動条件

- C#コードの新しいテストを書く場合
- テスト品質とカバレッジのレビュー
- .NETプロジェクトのテストインフラストラクチャの設定
- フレーキーまたは遅いテストのデバッグ

## テストフレームワークスタック

| ツール | 目的 |
|---|---|
| **xUnit** | テストフレームワーク（.NETに推奨） |
| **FluentAssertions** | 読みやすいアサーション構文 |
| **NSubstitute**または**Moq** | 依存関係のモッキング |
| **Testcontainers** | 統合テストでの実際のインフラ |
| **WebApplicationFactory** | ASP.NET Core統合テスト |
| **Bogus** | 現実的なテストデータ生成 |

## ユニットテスト構造

### Arrange-Act-Assert

```csharp
public sealed class OrderServiceTests
{
    private readonly IOrderRepository _repository = Substitute.For<IOrderRepository>();
    private readonly ILogger<OrderService> _logger = Substitute.For<ILogger<OrderService>>();
    private readonly OrderService _sut;

    public OrderServiceTests()
    {
        _sut = new OrderService(_repository, _logger);
    }

    [Fact]
    public async Task PlaceOrderAsync_ReturnsSuccess_WhenRequestIsValid()
    {
        // Arrange
        var request = new CreateOrderRequest
        {
            CustomerId = "cust-123",
            Items = [new OrderItem("SKU-001", 2, 29.99m)]
        };

        // Act
        var result = await _sut.PlaceOrderAsync(request, CancellationToken.None);

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Value.Should().NotBeNull();
        result.Value!.CustomerId.Should().Be("cust-123");
    }

    [Fact]
    public async Task PlaceOrderAsync_ReturnsFailure_WhenNoItems()
    {
        // Arrange
        var request = new CreateOrderRequest
        {
            CustomerId = "cust-123",
            Items = []
        };

        // Act
        var result = await _sut.PlaceOrderAsync(request, CancellationToken.None);

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Contain("at least one item");
    }
}
```

### Theoryによるパラメータ化テスト

```csharp
[Theory]
[InlineData("", false)]
[InlineData("a", false)]
[InlineData("ab@c.d", false)]
[InlineData("user@example.com", true)]
[InlineData("user+tag@example.co.uk", true)]
public void IsValidEmail_ReturnsExpected(string email, bool expected)
{
    EmailValidator.IsValid(email).Should().Be(expected);
}

[Theory]
[MemberData(nameof(InvalidOrderCases))]
public async Task PlaceOrderAsync_RejectsInvalidOrders(CreateOrderRequest request, string expectedError)
{
    var result = await _sut.PlaceOrderAsync(request, CancellationToken.None);

    result.IsSuccess.Should().BeFalse();
    result.Error.Should().Contain(expectedError);
}

public static TheoryData<CreateOrderRequest, string> InvalidOrderCases => new()
{
    { new() { CustomerId = "", Items = [ValidItem()] }, "CustomerId" },
    { new() { CustomerId = "c1", Items = [] }, "at least one item" },
    { new() { CustomerId = "c1", Items = [new("", 1, 10m)] }, "SKU" },
};
```

## NSubstituteによるモッキング

```csharp
[Fact]
public async Task GetOrderAsync_ReturnsNull_WhenNotFound()
{
    // Arrange
    var orderId = Guid.NewGuid();
    _repository.FindByIdAsync(orderId, Arg.Any<CancellationToken>())
        .Returns((Order?)null);

    // Act
    var result = await _sut.GetOrderAsync(orderId, CancellationToken.None);

    // Assert
    result.Should().BeNull();
}

[Fact]
public async Task PlaceOrderAsync_PersistsOrder()
{
    // Arrange
    var request = ValidOrderRequest();

    // Act
    await _sut.PlaceOrderAsync(request, CancellationToken.None);

    // Assert — リポジトリが呼び出されたことを検証
    await _repository.Received(1).AddAsync(
        Arg.Is<Order>(o => o.CustomerId == request.CustomerId),
        Arg.Any<CancellationToken>());
}
```

## ASP.NET Core統合テスト

### WebApplicationFactoryのセットアップ

```csharp
public sealed class OrderApiTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client;

    public OrderApiTests(WebApplicationFactory<Program> factory)
    {
        _client = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureServices(services =>
            {
                // テスト用にインメモリDBで実際のDBを置き換え
                services.RemoveAll<DbContextOptions<AppDbContext>>();
                services.AddDbContext<AppDbContext>(options =>
                    options.UseInMemoryDatabase("TestDb"));
            });
        }).CreateClient();
    }

    [Fact]
    public async Task GetOrder_Returns404_WhenNotFound()
    {
        var response = await _client.GetAsync($"/api/orders/{Guid.NewGuid()}");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task CreateOrder_Returns201_WithValidRequest()
    {
        var request = new CreateOrderRequest
        {
            CustomerId = "cust-1",
            Items = [new("SKU-001", 1, 19.99m)]
        };

        var response = await _client.PostAsJsonAsync("/api/orders", request);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        response.Headers.Location.Should().NotBeNull();
    }
}
```

### Testcontainersによるテスト

```csharp
public sealed class PostgresOrderRepositoryTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .Build();

    private AppDbContext _db = null!;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(_postgres.GetConnectionString())
            .Options;
        _db = new AppDbContext(options);
        await _db.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        await _db.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task AddAsync_PersistsOrder()
    {
        var repo = new SqlOrderRepository(_db);
        var order = Order.Create("cust-1", [new OrderItem("SKU-001", 2, 10m)]);

        await repo.AddAsync(order, CancellationToken.None);

        var found = await repo.FindByIdAsync(order.Id, CancellationToken.None);
        found.Should().NotBeNull();
        found!.Items.Should().HaveCount(1);
    }
}
```

## テスト組織

```
tests/
  MyApp.UnitTests/
    Services/
      OrderServiceTests.cs
      PaymentServiceTests.cs
    Validators/
      EmailValidatorTests.cs
  MyApp.IntegrationTests/
    Api/
      OrderApiTests.cs
    Repositories/
      OrderRepositoryTests.cs
  MyApp.TestHelpers/
    Builders/
      OrderBuilder.cs
    Fixtures/
      DatabaseFixture.cs
```

## テストデータビルダー

```csharp
public sealed class OrderBuilder
{
    private string _customerId = "cust-default";
    private readonly List<OrderItem> _items = [new("SKU-001", 1, 10m)];

    public OrderBuilder WithCustomer(string customerId)
    {
        _customerId = customerId;
        return this;
    }

    public OrderBuilder WithItem(string sku, int quantity, decimal price)
    {
        _items.Add(new OrderItem(sku, quantity, price));
        return this;
    }

    public Order Build() => Order.Create(_customerId, _items);
}

// テストでの使用
var order = new OrderBuilder()
    .WithCustomer("cust-vip")
    .WithItem("SKU-PREMIUM", 3, 99.99m)
    .Build();
```

## よくあるアンチパターン

| アンチパターン | 修正方法 |
|---|---|
| 実装の詳細をテストする | 動作と結果をテストする |
| 共有の可変テスト状態 | テストごとに新しいインスタンス（xUnitはコンストラクタでこれを行う） |
| 非同期テストでの`Thread.Sleep` | タイムアウトまたはポーリングヘルパーを使用した`Task.Delay` |
| `ToString()`出力のアサーション | 型付きプロパティのアサーション |
| テストごとに1つの巨大なアサーション | テストごとに1つの論理的なアサーション |
| 実装を記述するテスト名 | 動作で命名: `Method_ExpectedResult_WhenCondition` |
| `CancellationToken`を無視する | 常に渡してキャンセルを確認する |

## テストの実行

```bash
# すべてのテストを実行
dotnet test

# カバレッジを付けて実行
dotnet test --collect:"XPlat Code Coverage"

# 特定のプロジェクトを実行
dotnet test tests/MyApp.UnitTests/

# テスト名でフィルタリング
dotnet test --filter "FullyQualifiedName~OrderService"

# 開発中のウォッチモード
dotnet watch test --project tests/MyApp.UnitTests/
```
