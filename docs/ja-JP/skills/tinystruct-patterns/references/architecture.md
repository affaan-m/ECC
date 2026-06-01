# tinystruct のアーキテクチャと設定

## 使用タイミング

CLI と HTTP を対等なファーストクラス・シチズンとして扱う、軽量・高性能な Java フレームワークが必要なときに **tinystruct** を選択します。フットプリントが小さく、外部依存ゼロの JSON 処理が求められるマイクロサービス・CLI ユーティリティ・データドリブンアプリケーションに最適です。

## 仕組み

### コアアーキテクチャ

フレームワークはシングルトンの `ActionRegistry` を中心に動作し、URL パターン（またはコマンド文字列）を `Action` オブジェクトにマッピングします。リクエストが到着すると、システムはパスを解決し、対応するメソッドハンドルを呼び出します。

#### 主要な抽象化

| クラス／インターフェース | 役割 |
|---|---|
| `AbstractApplication` | すべての tinystruct アプリケーションの基底クラス。これを継承します。 |
| `@Action` アノテーション | メソッドを URI パス（Web）またはコマンド名（CLI）にマッピングする唯一のルーティングプリミティブ。 |
| `ActionRegistry` | URL パターンを正規表現経由で `Action` オブジェクトにマッピングするシングルトン。直接インスタンス化しないこと。 |
| `Action` | `MethodHandle` + 正規表現パターン + 優先度 + `Mode` をラップしてディスパッチに使用します。 |
| `Context` | リクエストごとの状態ストア。`getContext()` でアクセス。CLI 引数と HTTP のリクエスト／レスポンスを保持します。 |
| `Dispatcher` | CLI エントリーポイント（`bin/dispatcher`）。`--import` でアプリケーションを読み込みます。 |
| `HttpServer` | 組み込み HTTP サーバー。`bin/dispatcher start --import org.tinystruct.system.HttpServer` で起動します。 |

### パッケージマップ

```
org.tinystruct/
├── AbstractApplication.java      ← これを継承する
├── Application.java              ← インターフェース
├── ApplicationException.java     ← チェック例外
├── ApplicationRuntimeException.java ← 非チェック例外
├── application/
│   ├── Action.java               ← 実行時のアクションラッパー
│   ├── ActionRegistry.java       ← シングルトンのルートレジストリ
│   └── Context.java              ← リクエストコンテキスト
├── system/
│   ├── annotation/Action.java    ← @Action アノテーション + Mode 列挙型
│   ├── Dispatcher.java           ← CLI ディスパッチャー
│   ├── HttpServer.java           ← 組み込み HTTP サーバー
│   ├── EventDispatcher.java      ← イベントバス
│   └── Settings.java             ← application.properties を読み込む
├── data/
│   ├── component/Builder.java    ← JSON オブジェクト（Gson/Jackson の代替として使用）
│   ├── component/Builders.java   ← JSON 配列
│   ├── component/AbstractData.java ← DB 永続化の基底 POJO
│   ├── component/Condition.java  ← フルエント SQL クエリビルダー
│   ├── component/FieldType.java  ← SQL-Java 型マッピング
│   ├── Mapping.java              ← .map.xml メタデータを読み込む
│   ├── DatabaseOperator.java     ← 低レベル JDBC ラッパー
│   └── FileEntity.java           ← ファイルアップロードの表現
├── http/                         ← Request, Response, Constants
│   └── SSEPushManager.java       ← Server-Sent Events の管理
└── net/                          ← URLRequest, HTTPHandler（アウトバウンド HTTP）
```

### テンプレートの動作とディスパッチフロー

デフォルトでは、フレームワークはビューテンプレートが必要と仮定します。`templateRequired` が `true` の場合、`toString()` は `src/main/resources/themes/<ClassName>.view` のテンプレートファイルを検索します。`setVariable("name", value)` でデータをテンプレートに渡し、テンプレート内では `{%name%}` で展開されます。

## 例

### 最小限のアプリケーション初期化
```java
@Override
public void init() {
    this.setTemplateRequired(false); // データのみのアプリでは .view テンプレート検索をスキップ
    // ここで setAction() を呼ばないこと — 代わりに @Action アノテーションを使用する
}
```

### アクションの定義と CLI 呼び出し
```java
@Action("hello")
public String hello() {
    return "Hello, tinystruct!";
}
```
**Dispatcher からの実行：**
```bash
bin/dispatcher hello
bin/dispatcher greet/James
bin/dispatcher echo --words "Hello" --import com.example.HelloApp
```

### 設定へのアクセス
`src/main/resources/application.properties` に配置：
```java
String port = this.getConfiguration("server.port");
```
