---
name: tinystruct-patterns
description: tinystructフレームワークでアプリケーションモジュールまたはマイクロサービスを開発する際に使用。ルーティング、コンテキスト管理、BuilderによるJSON処理、CLI/HTTPデュアルモードのパターンをカバー。
origin: ECC
---

# tinystruct 開発パターン

**tinystruct** Java フレームワークを使用してモジュールをビルドするためのアーキテクチャと実装パターン。CLIとHTTPが等しく扱われる軽量なシステムです。

## 使用するタイミング

- `AbstractApplication` を拡張して新しい `Application` モジュールを作成するとき。
- `@Action` を使用してルートとコマンドラインアクションを定義するとき。
- `Context` を通じてリクエストごとの状態を処理するとき。
- ネイティブの `Builder` コンポーネントを使用してJSONシリアライゼーションを行うとき。
- `application.properties` でデータベース接続またはシステム設定を構成するとき。
- `ApplicationManager.init()` を通じて標準的な `bin/dispatcher` エントリポイントを生成または再生成するとき。
- ルーティング競合（Action）またはCLI引数解析のデバッグを行うとき。

## 動作の仕組み

tinystruct フレームワークは、`@Action` でアノテーションされたメソッドをターミナルとWeb環境の両方でルーティング可能なエンドポイントとして扱います。アプリケーションは `AbstractApplication` を拡張することで作成され、`init()` などのコアライフサイクルフックとリクエスト `Context` へのアクセスが提供されます。

ルーティングは `ActionRegistry` によって処理され、パスセグメントをメソッド引数に自動的にマッピングして依存関係を注入します。データのみのサービスでは、ゼロ依存のフットプリントを維持するために、JSONシリアライゼーションにネイティブの `Builder` コンポーネントを使用すべきです。フレームワークには `ApplicationManager` のユーティリティも含まれており、`bin/dispatcher` スクリプトを生成することでプロジェクトの実行環境をブートストラップします。

## 例

### 基本アプリケーション（MyService）
```java
public class MyService extends AbstractApplication {
    @Override
    public void init() {
        this.setTemplateRequired(false); // データ/APIアプリの .view 参照を無効化
    }

    @Override public String version() { return "1.0.0"; }

    @Action("greet")
    public String greet() {
        return "Hello from tinystruct!";
    }
}
```

### パラメータ付きルーティング（getUser）
```java
// Web: /api/user/123 または CLI: "bin/dispatcher api/user/123" を処理
@Action("api/user/(\\d+)")
public String getUser(int userId) {
    return "User ID: " + userId;
}
```

### HTTPモード分岐（login）
```java
@Action(value = "login", mode = Mode.HTTP_POST)
public boolean doLogin() {
    // ログイン処理
    return true;
}
```

### ネイティブJSONデータ処理（getData）
```java
@Action("api/data")
public Builder getData() throws ApplicationException {
    Builder builder = new Builder();
    builder.put("status", "success");
    Builder nested = new Builder();
    nested.put("id", 1);
    nested.put("name", "James");
    builder.put("data", nested);
    return builder;
}
```

## 設定

設定は `src/main/resources/application.properties` で管理されます。

## テストパターン

JUnit 5 を使用して、アクションが `ActionRegistry` に登録されていることを検証することでアクションをテストします。

## レッドフラグとアンチパターン

| 症状 | 正しいパターン |
|---|---|
| `com.google.gson` または `com.fasterxml.jackson` のインポート | `org.tinystruct.data.component.Builder` を使用する。 |
| `.view` ファイルの `FileNotFoundException` | APIのみのアプリでは `init()` 内で `setTemplateRequired(false)` を呼び出す。 |
| `private` メソッドへの `@Action` アノテーション | アクションはフレームワークに登録されるために `public` である必要がある。 |
| アプリ内での `main(String[] args)` のハードコーディング | すべてのモジュールのエントリポイントとして `bin/dispatcher` を使用する。 |
| 手動での `ActionRegistry` 登録 | 自動検出のために `@Action` アノテーションを優先する。 |

## テクニカルリファレンス

詳細なガイドは `references/` ディレクトリにあります：

- [アーキテクチャと設定](references/architecture.md) — 抽象化、パッケージマップ、プロパティ
- [ルーティングと@Action](references/routing.md) — アノテーションの詳細、モード、パラメータ
- [データ処理](references/data-handling.md) — JSONのためのネイティブ `Builder` の使用
- [システムと使用方法](references/system-usage.md) — Context、セッション、イベント、CLI使用方法
- [テストパターン](references/testing.md) — JUnit 5 統合と ActionRegistry テスト
