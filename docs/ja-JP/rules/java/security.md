---
paths:
  - "**/*.java"
---
# Java セキュリティ

> このファイルは [common/security.md](../common/security.md) を Java 固有のコンテンツで拡張します。

## シークレット管理

- API キー、トークン、認証情報をソースコードにハードコードしない
- 環境変数を使用する: `System.getenv("API_KEY")`
- 本番環境のシークレットにはシークレットマネージャ（Vault、AWS Secrets Manager）を使用する
- シークレットを含むローカル設定ファイルは `.gitignore` に追加する

```java
// BAD
private static final String API_KEY = "sk-abc123...";

// GOOD — 環境変数
String apiKey = System.getenv("PAYMENT_API_KEY");
Objects.requireNonNull(apiKey, "PAYMENT_API_KEY must be set");
```

## SQL インジェクション防止

- 常にパラメータ化クエリを使用する — ユーザー入力を SQL に連結しない
- `PreparedStatement` またはフレームワークのパラメータ化クエリ API を使用する
- ネイティブクエリで使用される入力はすべて検証・サニタイズする

```java
// BAD — 文字列連結による SQL インジェクション
Statement stmt = conn.createStatement();
String sql = "SELECT * FROM orders WHERE name = '" + name + "'";
stmt.executeQuery(sql);

// GOOD — パラメータ化クエリの PreparedStatement
PreparedStatement ps = conn.prepareStatement("SELECT * FROM orders WHERE name = ?");
ps.setString(1, name);

// GOOD — JDBC テンプレート
jdbcTemplate.query("SELECT * FROM orders WHERE name = ?", mapper, name);
```

## 入力検証

- 処理前にシステム境界ですべてのユーザー入力を検証する
- バリデーションフレームワーク使用時は DTO に Bean Validation（`@NotNull`、`@NotBlank`、`@Size`）を使用する
- ファイルパスとユーザー提供文字列は使用前にサニタイズする
- 検証に失敗した入力は明確なエラーメッセージで拒否する

```java
// プレーン Java での手動検証
public Order createOrder(String customerName, BigDecimal amount) {
    if (customerName == null || customerName.isBlank()) {
        throw new IllegalArgumentException("Customer name is required");
    }
    if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) {
        throw new IllegalArgumentException("Amount must be positive");
    }
    return new Order(customerName, amount);
}
```

## 認証と認可

- 独自の暗号化を実装しない — 確立されたライブラリを使用する
- パスワードは bcrypt または Argon2 で保存する、MD5/SHA1 は使用しない
- サービス境界で認可チェックを強制する
- ログから機密データを消去する — パスワード、トークン、PII をログに記録しない

## 依存関係のセキュリティ

- `mvn dependency:tree` または `./gradlew dependencies` で推移的依存関係を監査する
- OWASP Dependency-Check または Snyk を使用して既知の CVE をスキャンする
- 依存関係を最新に保つ — Dependabot または Renovate を設定する

## エラーメッセージ

- API レスポンスにスタックトレース、内部パス、SQL エラーを公開しない
- ハンドラ境界で例外を安全な汎用クライアントメッセージにマッピングする
- 詳細なエラーはサーバー側でログに記録する; クライアントには汎用メッセージを返す

```java
// 詳細をログに記録し、汎用メッセージを返す
try {
    return orderService.findById(id);
} catch (OrderNotFoundException ex) {
    log.warn("Order not found: id={}", id);
    return ApiResponse.error("Resource not found");  // 汎用、内部情報なし
} catch (Exception ex) {
    log.error("Unexpected error processing order id={}", id, ex);
    return ApiResponse.error("Internal server error");  // ex.getMessage() を公開しない
}
```

## リファレンス

スキル: `springboot-security` で Spring Security の認証・認可パターンを参照してください。
スキル: `quarkus-security` で JWT/OIDC、RBAC、CDI を含む Quarkus セキュリティを参照してください。
スキル: `security-review` で一般的なセキュリティチェックリストを参照してください。
