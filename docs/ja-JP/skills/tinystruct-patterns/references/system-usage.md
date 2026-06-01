# tinystruct システム使用リファレンス

## 使用タイミング

リクエスト状態の処理、Web セッションの管理、Server-Sent Events（SSE）の実装、ファイルアップロードの処理、またはアウトバウンド HTTP ネットワーキングが必要な場合に、以下のパターンを使用します。

## 仕組み

### Context と CLI 引数
`Context` はリクエスト固有の状態の主要なデータストアです。`--key value` として渡された CLI フラグは `Context` に `"--key"` として格納されます。

### セッション管理
プラガブルなアーキテクチャ。デフォルトは `MemorySessionRepository`。`application.properties` で Redis を設定できます：
```properties
default.session.repository=org.tinystruct.http.RedisSessionRepository
redis.host=127.0.0.1
redis.port=6379
```

### Server-Sent Events（SSE）
リアルタイムプッシュのための組み込みサポート。`HttpServer` は `Accept: text/event-stream` ヘッダーを検出すると、SSE のライフサイクルを自動的に処理します。接続はセッション ID によって `SSEPushManager` で追跡されます。

### アウトバウンドネットワーキング
外部サービスへの HTTP リクエストには `URLRequest` と `HTTPHandler` を使用します。

## 例

### Context と CLI 引数
```java
@Action("echo")
public String echo() {
    // CLI: bin/dispatcher echo --words "Hello World"
    Object words = getContext().getAttribute("--words");
    if (words != null) return words.toString();
    return "No words provided";
}
```

### セッション管理
```java
@Action(value = "login", mode = Mode.HTTP_POST)
public String login(Request<?, ?> request) {
    request.getSession().setAttribute("userId", "42");
    return "Logged in";
}
```

### Server-Sent Events（SSE）
```java
@Action("sse/connect")
public String connect() {
    return "{\"type\":\"connect\",\"message\":\"Connected\"}";
}

// 別のメソッドまたはイベントハンドラー内で：
String sessionId = getContext().getId();
SSEPushManager.getInstance().push(sessionId, new Builder().put("msg", "hello"));
```

### ファイルアップロード
```java
import org.tinystruct.data.FileEntity;

@Action(value = "upload", mode = Mode.HTTP_POST)
public String upload(Request<?, ?> request) throws ApplicationException {
    List<FileEntity> files = request.getAttachments();
    if (files != null) {
        for (FileEntity file : files) {
            // file.getFilename(), file.getContent()
        }
    }
    return "Uploaded";
}
```

### アウトバウンド HTTP
```java
import org.tinystruct.net.URLRequest;
import org.tinystruct.net.handlers.HTTPHandler;

URLRequest request = new URLRequest(new URL("https://api.example.com"));
request.setMethod("POST").setBody("{\"data\":\"val\"}");

HTTPHandler handler = new HTTPHandler();
var response = handler.handleRequest(request);
if (response.getStatusCode() == 200) {
    String body = response.getBody();
}
```

### イベントシステム
非同期タスク実行のために `init()` でハンドラーを登録します。
```java
EventDispatcher.getInstance().registerHandler(MyEvent.class, event -> {
    CompletableFuture.runAsync(() -> doHeavyWork(event.getPayload()));
});
```
