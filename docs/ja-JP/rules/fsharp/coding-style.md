---
paths:
  - "**/*.fs"
  - "**/*.fsx"
---
# F# コーディングスタイル

> このファイルは [common/coding-style.md](../common/coding-style.md) を F# 固有のコンテンツで拡張します。

## 標準

- 標準的な F# の規約に従い、正確性のために型システムを活用する
- デフォルトでイミュータビリティを優先する。パフォーマンス上の理由がある場合のみ `mutable` を使用する
- モジュールを焦点を絞り、凝集性を保つ

## 型とモデル

- ドメインモデリングにはクラス階層よりも判別共用体を優先する
- 名前付きフィールドを持つデータにはレコードを使用する
- プリミティブ型に対する型安全なラッパーには単一ケース共用体を使用する
- 相互運用またはミュータブルなステートが必要でない限り、クラスの使用を避ける

```fsharp
type EmailAddress = EmailAddress of string

type OrderStatus =
    | Pending
    | Confirmed of confirmedAt: DateTimeOffset
    | Shipped of trackingNumber: string
    | Cancelled of reason: string

type Order =
    { Id: Guid
      CustomerId: string
      Status: OrderStatus
      Items: OrderItem list }
```

## イミュータビリティ

- レコードはデフォルトでイミュータブル。更新には `with` 式を使用する
- ミュータブルなコレクションよりも `list`、`map`、`set` を優先する
- ドメインロジックで `ref` セルとミュータブルフィールドを避ける

```fsharp
let rename (profile: UserProfile) newName =
    { profile with Name = newName }
```

## 関数スタイル

- 大きなメソッドよりも小さく合成可能な関数を優先する
- パイプ演算子 `|>` を使用して読みやすいデータパイプラインを構築する
- if/else チェーンよりもパターンマッチングを優先する
- null の代わりに `Option` を使用する。失敗する可能性のある操作には `Result` を使用する

```fsharp
let processOrder order =
    order
    |> validateItems
    |> Result.bind calculateTotal
    |> Result.map applyDiscount
    |> Result.mapError OrderError
```

## 非同期とエラーハンドリング

- .NET の非同期 API との相互運用には `task { }` を使用する
- F# ネイティブの非同期ワークフローには `async { }` を使用する
- パブリック非同期 API を通じて `CancellationToken` を伝播する
- 予期されるエラーには例外ではなく `Result` とRailway指向プログラミングを優先する

```fsharp
let loadOrderAsync (orderId: Guid) (ct: CancellationToken) =
    task {
        let! order = repository.FindAsync(orderId, ct)
        return
            order
            |> Option.defaultWith (fun () ->
                failwith $"Order {orderId} was not found.")
    }
```

## フォーマット

- 自動フォーマットには `fantomas` を使用する
- 意味のある空白を優先する。不要な括弧を避ける
- 未使用の `open` 宣言を削除する

### open 宣言の順序

`open` 文を4つのセクションに空行で区切ってグループ化し、各セクション内は辞書順で並べる:

1. `System.*`
2. `Microsoft.*`
3. サードパーティの名前空間
4. ファーストパーティ / プロジェクトの名前空間

```fsharp
open System
open System.Collections.Generic
open System.Threading.Tasks

open Microsoft.AspNetCore.Http
open Microsoft.Extensions.Logging

open FsCheck.Xunit
open Swensen.Unquote

open MyApp.Domain
open MyApp.Infrastructure
```
