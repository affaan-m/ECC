---
paths:
  - "**/*.cs"
  - "**/*.csx"
  - "**/*.csproj"
---
# C# テスト

> このファイルは [common/testing.md](../common/testing.md) を C# 固有のコンテンツで拡張します。

## テストフレームワーク

- ユニットテストと統合テストには **xUnit** を優先する
- 読みやすいアサーションには **FluentAssertions** を使用する
- 依存関係のモックには **Moq** または **NSubstitute** を使用する
- 統合テストで実際のインフラが必要な場合は **Testcontainers** を使用する

## テスト構成

- `tests/` 以下で `src/` 構造を反映させる
- ユニット、統合、エンドツーエンドのカバレッジを明確に分離する
- 実装の詳細ではなく動作でテストに名前を付ける

```csharp
public sealed class OrderServiceTests
{
    [Fact]
    public async Task FindByIdAsync_ReturnsOrder_WhenOrderExists()
    {
        // Arrange
        // Act
        // Assert
    }
}
```

## ASP.NET Core 統合テスト

- API 統合カバレッジには `WebApplicationFactory<TEntryPoint>` を使用する
- ミドルウェアをバイパスするのではなく、HTTP を通じて認証、バリデーション、シリアライゼーションをテストする

## カバレッジ

- 行カバレッジ 80% 以上を目標とする
- ドメインロジック、バリデーション、認証、失敗パスにカバレッジを集中させる
- 利用可能な場合はカバレッジ収集を有効にして CI で `dotnet test` を実行する
