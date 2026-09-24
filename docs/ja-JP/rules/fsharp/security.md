---
paths:
  - "**/*.fs"
  - "**/*.fsx"
  - "**/*.fsproj"
  - "**/appsettings*.json"
---
# F# セキュリティ

> このファイルは [common/security.md](../common/security.md) を F# 固有のコンテンツで拡張します。

## シークレット管理

- ソースコードに API キー、トークン、接続文字列をハードコードしない
- ローカル開発には環境変数とユーザーシークレットを使用し、本番環境ではシークレットマネージャーを使用する
- `appsettings.*.json` に実際の認証情報を含めない

```fsharp
// BAD
let apiKey = "sk-live-123"

// GOOD
let apiKey =
    configuration["OpenAI:ApiKey"]
    |> Option.ofObj
    |> Option.defaultWith (fun () -> failwith "OpenAI:ApiKey is not configured.")
```

## SQL インジェクション対策

- ADO.NET、Dapper、または EF Core でパラメータ化クエリを常に使用する
- ユーザー入力を SQL 文字列に連結しない
- 動的クエリ合成を使用する前に、並び替えフィールドとフィルター演算子を検証する

```fsharp
let findByCustomer (connection: IDbConnection) customerId =
    task {
        let sql = "SELECT * FROM Orders WHERE CustomerId = @customerId"
        return! connection.QueryAsync<Order>(sql, {| customerId = customerId |})
    }
```

## 入力バリデーション

- 型を使用してアプリケーション境界で入力を検証する
- 検証済みの値には単一ケース判別共用体を使用する
- 無効な入力がドメインロジックに入る前に拒否する

```fsharp
type ValidatedEmail = private ValidatedEmail of string

module ValidatedEmail =
    let create (input: string) =
        if System.Text.RegularExpressions.Regex.IsMatch(input, @"^[^@]+@[^@]+\.[^@]+$") then
            Ok(ValidatedEmail input)
        else
            Error "Invalid email address"

    let value (ValidatedEmail v) = v
```

## 認証と認可

- カスタムトークン解析ではなくフレームワークの認証ハンドラーを優先する
- エンドポイントまたはハンドラー境界で認可ポリシーを強制する
- 生のトークン、パスワード、PII をログに記録しない

## エラーハンドリング

- クライアントに返す安全なメッセージを返す
- 詳細な例外はサーバーサイドで構造化コンテキストと共にログに記録する
- API レスポンスにスタックトレース、SQL テキスト、ファイルシステムパスを公開しない

## 参考資料

より広範なアプリケーションセキュリティレビューチェックリストはスキル `security-review` を参照。
