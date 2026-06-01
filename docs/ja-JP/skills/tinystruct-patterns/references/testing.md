# tinystruct のテストパターン

## 使用タイミング

**JUnit 5** を使用してアプリケーションのユニットテストを書く際に、以下のパターンを使用します。アクションロジック・ルーティングの登録・HTTP モードの動作を検証するために不可欠です。

## 仕組み

### アプリケーションのユニットテスト
ActionRegistry はシングルトンです。アプリケーションをテストするには：
1. アプリケーションをインスタンス化する。
2. `Settings` オブジェクトを提供する（`init()` とアノテーション処理をトリガーする）。
3. `app.invoke(path, args)` を使ってロジックを直接テストする。

### HTTP 統合テスト
組み込み HTTP サーバーを使ったテストでは：
1. バックグラウンドスレッドで `HttpServer` を起動する。
2. `ApplicationManager.call("start", context, Action.Mode.CLI)` で起動する。
3. `Socket` を使ってポートが開放されるまで待機する。
4. `URLRequest` と `HTTPHandler` を使って実際のリクエストを実行する。

## 例

### ユニットテスト
```java
import org.junit.jupiter.api.*;
import org.tinystruct.system.Settings;

class MyAppTest {
    private MyApp app;

    @BeforeEach
    void setUp() {
        app = new MyApp();
        app.setConfiguration(new Settings());
        app.init(); // @Action アノテーション処理をトリガーし、すべてのアクションを登録する
    }

    @Test
    void testHello() throws Exception {
        Object result = app.invoke("hello");
        Assertions.assertEquals("Hello!", result);
    }

    @Test
    void testGreet() throws Exception {
        Object result = app.invoke("greet", new Object[]{"James"});
        Assertions.assertEquals("Hello, James!", result);
    }
}
```

### ActionRegistry のマッチングテスト
```java
@Test
void testRouting() {
    ActionRegistry registry = ActionRegistry.getInstance();
    Action action = registry.getAction("greet/James");
    Assertions.assertNotNull(action);
}
```

### HTTP 統合パターン
参考：`src/test/java/org/tinystruct/system/HttpServerHttpModeTest.java`

```java
// パターン：
// 1. スレッド内でサーバーを起動する
// 2. ポートが開放されるまでポーリングする
// 3. HTTPHandler 経由で HTTP リクエストを送信する
// 4. レスポンスのボディ／ステータスをアサートする
```
