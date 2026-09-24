---
paths:
  - "**/*.cs"
  - "**/*.csx"
---
# C# コーディングスタイル

> このファイルは [common/coding-style.md](../common/coding-style.md) を C# 固有のコンテンツで拡張します。

## 標準

- 現在の .NET の規約に従い、nullable 参照型を有効にする
- パブリックおよびインターナル API に明示的なアクセス修飾子を優先する
- ファイルはそこで定義されている主要な型に合わせて構成する

## 型とモデル

- イミュータブルな値のようなモデルには `record` または `record struct` を優先する
- ID とライフサイクルを持つエンティティや型には `class` を使用する
- サービス境界と抽象化には `interface` を使用する
- アプリケーションコードで `dynamic` を避ける; ジェネリクスや明示的なモデルを優先する

```csharp
public sealed record UserDto(Guid Id, string Email);

public interface IUserRepository
{
    Task<UserDto?> FindByIdAsync(Guid id, CancellationToken cancellationToken);
}
```

## イミュータビリティ

- 共有状態には `init` セッター、コンストラクタパラメータ、イミュータブルコレクションを優先する
- 更新された状態を生成する際に入力モデルをインプレースでミューテートしない

```csharp
public sealed record UserProfile(string Name, string Email);

public static UserProfile Rename(UserProfile profile, string name) =>
    profile with { Name = name };
```

## 非同期とエラーハンドリング

- `.Result` や `.Wait()` のようなブロッキング呼び出しよりも `async`/`await` を優先する
- パブリックな非同期 API を通じて `CancellationToken` を渡す
- 特定の例外をスローし、構造化されたプロパティでログを記録する

```csharp
public async Task<Order> LoadOrderAsync(
    Guid orderId,
    CancellationToken cancellationToken)
{
    try
    {
        return await repository.FindAsync(orderId, cancellationToken)
            ?? throw new InvalidOperationException($"Order {orderId} was not found.");
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Failed to load order {OrderId}", orderId);
        throw;
    }
}
```

## フォーマット

- フォーマットとアナライザーの修正には `dotnet format` を使用する
- `using` ディレクティブを整理し、未使用のインポートを削除する
- 読みやすさを保てる場合のみ式本体メンバーを優先する
