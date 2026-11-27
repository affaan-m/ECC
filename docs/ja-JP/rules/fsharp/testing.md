---
paths:
  - "**/*.fs"
  - "**/*.fsx"
  - "**/*.fsproj"
---
# F# テスト

> このファイルは [common/testing.md](../common/testing.md) を F# 固有のコンテンツで拡張します。

## テストフレームワーク

- F# フレンドリーなアサーションのために **xUnit** と **FsUnit.xUnit** を優先する
- 明確な失敗メッセージを持つクォーテーションベースのアサーションには **Unquote** を使用する
- プロパティベーステストには **FsCheck.xUnit** を使用する
- 依存関係のモックには **NSubstitute** または関数スタブを使用する
- インテグレーションテストで実際のインフラが必要な場合は **Testcontainers** を使用する

## テストの構成

- `tests/` 配下に `src/` の構造を反映させる
- ユニット、インテグレーション、エンドツーエンドのカバレッジを明確に分離する
- 実装の詳細ではなく、振る舞いでテストに名前を付ける

```fsharp
open Xunit
open Swensen.Unquote

[<Fact>]
let ``リクエストが有効な場合、PlaceOrder は成功を返す`` () =
    let request = { CustomerId = "cust-123"; Items = [ validItem ] }
    let result = OrderService.placeOrder request
    test <@ Result.isOk result @>

[<Fact>]
let ``アイテムが空の場合、PlaceOrder はエラーを返す`` () =
    let request = { CustomerId = "cust-123"; Items = [] }
    let result = OrderService.placeOrder request
    test <@ Result.isError result @>
```

## FsCheck を使ったプロパティベーステスト

```fsharp
open FsCheck.Xunit

[<Property>]
let ``注文合計が負になることはない`` (items: OrderItem list) =
    let total = Order.calculateTotal items
    total >= 0m
```

## ASP.NET Core インテグレーションテスト

- API インテグレーションカバレッジには `WebApplicationFactory<TEntryPoint>` を使用する
- ミドルウェアをバイパスするのではなく、HTTP を通じて認証、バリデーション、シリアライゼーションをテストする

## カバレッジ

- 80%以上の行カバレッジを目標とする
- ドメインロジック、バリデーション、認証、失敗パスのカバレッジに重点を置く
- 利用可能な場合はカバレッジ収集を有効にして CI で `dotnet test` を実行する
