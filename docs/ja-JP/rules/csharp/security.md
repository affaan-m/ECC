---
paths:
  - "**/*.cs"
  - "**/*.csx"
  - "**/*.csproj"
  - "**/appsettings*.json"
---
# C# セキュリティ

> このファイルは [common/security.md](../common/security.md) を C# 固有のコンテンツで拡張します。

## シークレット管理

- API キー、トークン、接続文字列をソースコードに絶対にハードコードしない
- ローカル開発には環境変数とユーザーシークレットを使用し、本番環境ではシークレットマネージャーを使用する
- `appsettings.*.json` に実際の認証情報を含めない

```csharp
// BAD
const string ApiKey = "sk-live-123";

// GOOD
var apiKey = builder.Configuration["OpenAI:ApiKey"]
    ?? throw new InvalidOperationException("OpenAI:ApiKey is not configured.");
```

## SQL インジェクション対策

- ADO.NET、Dapper、EF Core でのパラメータ化クエリを常に使用する
- ユーザー入力を SQL 文字列に絶対に連結しない
- 動的クエリ構成を使用する前に並べ替えフィールドとフィルタ演算子を検証する

```csharp
const string sql = "SELECT * FROM Orders WHERE CustomerId = @customerId";
await connection.QueryAsync<Order>(sql, new { customerId });
```

## 入力バリデーション

- アプリケーション境界で DTO を検証する
- データアノテーション、FluentValidation、または明示的なガード句を使用する
- ビジネスロジックを実行する前に無効なモデル状態を拒否する

## 認証と認可

- カスタムトークン解析の代わりにフレームワークの認証ハンドラーを優先する
- エンドポイントまたはハンドラー境界で認可ポリシーを適用する
- 生のトークン、パスワード、PII を絶対にログに記録しない

## エラーハンドリング

- クライアント向けの安全なメッセージを返す
- 詳細な例外はサーバー側で構造化されたコンテキストと共にログに記録する
- API レスポンスにスタックトレース、SQL テキスト、ファイルシステムパスを露出しない

## 参考

より広範なアプリケーションセキュリティレビューチェックリストについてはスキル: `security-review` を参照。
