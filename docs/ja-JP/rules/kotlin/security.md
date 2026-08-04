---
paths:
  - "**/*.kt"
  - "**/*.kts"
---
# Kotlin セキュリティ

> このファイルは [common/security.md](../common/security.md) を Kotlin および Android/KMP 固有のコンテンツで拡張します。

## シークレット管理

- API キー、トークン、認証情報をソースコードにハードコードしない
- ローカル開発のシークレットには `local.properties`（git で無視）を使用する
- リリースビルドには CI シークレットから生成される `BuildConfig` フィールドを使用する
- ランタイムのシークレット保存には `EncryptedSharedPreferences`（Android）または Keychain（iOS）を使用する

```kotlin
// BAD
val apiKey = "sk-abc123..."

// GOOD — BuildConfig から（ビルド時に生成）
val apiKey = BuildConfig.API_KEY

// GOOD — ランタイム時にセキュアストレージから
val token = secureStorage.get("auth_token")
```

## ネットワークセキュリティ

- HTTPS のみを使用する — クリアテキストをブロックするため `network_security_config.xml` を設定する
- 機密性の高いエンドポイントには OkHttp の `CertificatePinner` または Ktor 相当で証明書ピンニングを行う
- すべての HTTP クライアントにタイムアウトを設定する — デフォルト（無限の場合がある）のまま放置しない
- すべてのサーバーレスポンスを使用前に検証・サニタイズする

```xml
<!-- res/xml/network_security_config.xml -->
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>
```

## 入力検証

- 処理や API 送信前にすべてのユーザー入力を検証する
- Room/SQLDelight にはパラメータ化クエリを使用する — ユーザー入力を SQL に連結しない
- パストラバーサルを防ぐためユーザー入力のファイルパスをサニタイズする

```kotlin
// BAD — SQL インジェクション
@Query("SELECT * FROM items WHERE name = '$input'")

// GOOD — パラメータ化
@Query("SELECT * FROM items WHERE name = :input")
fun findByName(input: String): List<ItemEntity>
```

## データ保護

- Android では機密性の高いキーバリューデータに `EncryptedSharedPreferences` を使用する
- 明示的なフィールド名で `@Serializable` を使用する — 内部プロパティ名を漏洩させない
- 不要になった機密データはメモリからクリアする
- シリアライズされたクラスの名前マングリングを防ぐため `@Keep` または ProGuard ルールを使用する

## 認証

- トークンはプレーンな SharedPreferences ではなくセキュアストレージに保存する
- 適切な 401/403 ハンドリングでトークンリフレッシュを実装する
- ログアウト時にすべての認証状態をクリアする（トークン、キャッシュされたユーザーデータ、Cookie）
- 機密性の高い操作にはバイオメトリクス認証（`BiometricPrompt`）を使用する

## ProGuard / R8

- すべてのシリアライズされたモデル（`@Serializable`、Gson、Moshi）の Keep ルール
- リフレクションベースのライブラリ（Koin、Retrofit）の Keep ルール
- リリースビルドをテストする — 難読化はシリアライズを無言で壊す可能性がある

## WebView セキュリティ

- 明示的に必要でない限り JavaScript を無効にする: `settings.javaScriptEnabled = false`
- WebView にロードする前に URL を検証する
- 機密データにアクセスする `@JavascriptInterface` メソッドを公開しない
- `WebViewClient.shouldOverrideUrlLoading()` を使用してナビゲーションを制御する
