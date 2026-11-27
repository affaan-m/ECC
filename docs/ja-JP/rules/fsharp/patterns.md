---
paths:
  - "**/*.fs"
  - "**/*.fsx"
---
# F# パターン

> このファイルは [common/patterns.md](../common/patterns.md) を F# 固有のコンテンツで拡張します。

## エラーハンドリングのための Result 型

予期されるエラーには例外の代わりに Railway指向プログラミングで `Result<'T, 'TError>` を使用する。

```fsharp
type OrderError =
    | InvalidCustomer of string
    | EmptyItems
    | ItemOutOfStock of sku: string

let validateOrder (request: CreateOrderRequest) : Result<ValidatedOrder, OrderError> =
    if String.IsNullOrWhiteSpace request.CustomerId then
        Error(InvalidCustomer "CustomerId is required")
    elif request.Items |> List.isEmpty then
        Error EmptyItems
    else
        Ok { CustomerId = request.CustomerId; Items = request.Items }
```

## 欠損値のための Option

null の代わりに `Option<'T>` を優先する。変換には `Option.map`、`Option.bind`、`Option.defaultValue` を使用する。

```fsharp
let findUser (id: Guid) : User option =
    users |> Map.tryFind id

let getUserEmail userId =
    findUser userId
    |> Option.map (fun u -> u.Email)
    |> Option.defaultValue "unknown@example.com"
```

## ドメインモデリングのための判別共用体

ビジネスの状態を明示的にモデル化する。コンパイラが網羅的なハンドリングを強制する。

```fsharp
type PaymentState =
    | AwaitingPayment of amount: decimal
    | Paid of paidAt: DateTimeOffset * transactionId: string
    | Refunded of refundedAt: DateTimeOffset * reason: string
    | Failed of error: string

let describePayment = function
    | AwaitingPayment amount -> $"Awaiting payment of {amount:C}"
    | Paid (at, txn) -> $"Paid at {at} (txn: {txn})"
    | Refunded (at, reason) -> $"Refunded at {at}: {reason}"
    | Failed error -> $"Payment failed: {error}"
```

## コンピュテーション式

コンピュテーション式を使用して、失敗する可能性のある順次操作を簡略化する。

```fsharp
let placeOrder request =
    result {
        let! validated = validateOrder request
        let! inventory = checkInventory validated.Items
        let! order = createOrder validated inventory
        return order
    }
```

## モジュールの構成

- 関連する関数をクラスではなくモジュールにグループ化する
- 名前の衝突を防ぐために `[<RequireQualifiedAccess>]` を使用する
- モジュールは小さく、単一の責任に集中させる

```fsharp
[<RequireQualifiedAccess>]
module Order =
    let create customerId items = { Id = Guid.NewGuid(); CustomerId = customerId; Items = items; Status = Pending }
    let confirm order = { order with Status = Confirmed(DateTimeOffset.UtcNow) }
    let cancel reason order = { order with Status = Cancelled reason }
```

## 依存性注入

- 依存関係を関数パラメータまたはレコード of 関数として定義する
- 主に .NET ライブラリとの境界でのみインターフェースを使用する
- パイプラインへの依存関係注入には部分適用を優先する

```fsharp
type OrderDeps =
    { FindOrder: Guid -> Task<Order option>
      SaveOrder: Order -> Task<unit>
      SendNotification: Order -> Task<unit> }

let processOrder (deps: OrderDeps) orderId =
    task {
        match! deps.FindOrder orderId with
        | None -> return Error "Order not found"
        | Some order ->
            let confirmed = Order.confirm order
            do! deps.SaveOrder confirmed
            do! deps.SendNotification confirmed
            return Ok confirmed
    }
```
