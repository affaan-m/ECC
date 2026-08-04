---
paths:
  - "**/*.cs"
  - "**/*.csx"
---
# C# パターン

> このファイルは [common/patterns.md](../common/patterns.md) を C# 固有のコンテンツで拡張します。

## API レスポンスパターン

```csharp
public sealed record ApiResponse<T>(
    bool Success,
    T? Data = default,
    string? Error = null,
    object? Meta = null);
```

## リポジトリパターン

```csharp
public interface IRepository<T>
{
    Task<IReadOnlyList<T>> FindAllAsync(CancellationToken cancellationToken);
    Task<T?> FindByIdAsync(Guid id, CancellationToken cancellationToken);
    Task<T> CreateAsync(T entity, CancellationToken cancellationToken);
    Task<T> UpdateAsync(T entity, CancellationToken cancellationToken);
    Task DeleteAsync(Guid id, CancellationToken cancellationToken);
}
```

## オプションパターン

コードベース全体で生の文字列を読み取る代わりに、設定に強く型付けされたオプションを使用する。

```csharp
public sealed class PaymentsOptions
{
    public const string SectionName = "Payments";
    public required string BaseUrl { get; init; }
    public required string ApiKeySecretName { get; init; }
}
```

## 依存性注入

- サービス境界でインターフェースに依存する
- コンストラクタを集中させる。サービスに依存関係が多すぎる場合は責任を分割する
- ライフタイムを意図的に登録する: ステートレス/共有サービスにはシングルトン、リクエストデータにはスコープ、軽量な純粋ワーカーにはトランジエント
