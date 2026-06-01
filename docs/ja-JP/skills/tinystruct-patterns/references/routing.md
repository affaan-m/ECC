# tinystruct の @Action ルーティングリファレンス

## 使用タイミング

アプリケーション内で `@Action` アノテーションを使用し、CLI コマンドと HTTP エンドポイントの両方に対してルートを定義します。特定のパスにロジックをマッピングしたいとき、パラメータ付きリクエストを処理したいとき、または特定の HTTP メソッドに実行を制限しながら環境をまたいで一貫したコマンド構造を維持したいときに使用します。

## 仕組み

`ActionRegistry` は `@Action` アノテーションをパースしてルーティングテーブルを構築します。パラメータ付きのメソッドでは、フレームワークが Java のパラメータ型に対応する正規表現セグメントを自動的にマッピングします。

### 正規表現生成ルール
- `getUser(int id)` → パターン：`^/?user/(-?\d+)$`
- `search(String query)` → パターン：`^/?search/([^/]+)$`

サポートされるパラメータ型：`String`、`int/Integer`、`long/Long`、`float/Float`、`double/Double`、`boolean/Boolean`、`char/Character`、`short/Short`、`byte/Byte`、`Date`（`yyyy-MM-dd HH:mm:ss` としてパース）。

### Mode の値

| Mode | 起動するタイミング |
|---|---|
| `DEFAULT` | CLI および HTTP（GET、POST 等）の両方 |
| `CLI` | CLI ディスパッチャーのみ |
| `HTTP_GET` | HTTP GET のみ |
| `HTTP_POST` | HTTP POST のみ |
| `HTTP_PUT` | HTTP PUT のみ |
| `HTTP_DELETE` | HTTP DELETE のみ |
| `HTTP_PATCH` | HTTP PATCH のみ |

> **注意：** `Action.Mode.fromName(String methodName)` を使用して HTTP メソッド名を `Mode` にマッピングできます。不明または null の値は `Mode.DEFAULT` を返します。

## 例

### 基本的なアクション宣言
```java
@Action(
    value = "path/subpath",          // 必須：URI セグメントまたは CLI コマンド
    description = "What it does",    // --help 出力に表示
    mode = Mode.DEFAULT,             // デフォルト：Mode.DEFAULT
    example = "bin/dispatcher path/subpath/42"
)
public String myAction(int id) { ... }
```

### パラメータ付きパス
```java
@Action("user/{id}")
public String getUser(int id) { ... }
// → CLI: bin/dispatcher user/42
// → HTTP: /?q=user/42
```

### 依存性の注入
`ActionRegistry` はパラメータに `Request` および／または `Response` が含まれる場合、`Context` からそれらを自動的に注入します：

```java
@Action(value = "upload", mode = Mode.HTTP_POST)
public String upload(Request<?, ?> req, Response<?, ?> res) throws ApplicationException {
    // 必要に応じて生のリクエスト／レスポンスにアクセスする
    return "ok";
}
```

### パスマッチングの優先度
2 つのメソッドが同じパスを持つ場合、フレームワークは `ActionRegistry` の最初のマッチを使用します。明示的な `Mode` 値を使用して曖昧さを解消してください（例：フォーム表示用の GET とフォーム送信用の POST を分離する）。
