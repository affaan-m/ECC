---
name: tinystruct-patterns
description: tinystruct Java フレームワークで開発する際の専門ガイダンス。tinystruct コードベース、または tinystruct 上に構築されたあらゆるプロジェクトで作業する際に使用します — プロジェクトに存在しない場合の bin/dispatcher・bin/dispatcher.cmd 起動スクリプトの生成、Application クラスの作成、@Action によるルート定義、ユニットテスト、ActionRegistry、HTTP/CLI デュアルモード対応、組み込み HTTP サーバー、イベントシステム、Builder/Builders による JSON 処理、AbstractData によるデータベース永続化、POJO 生成、Server-Sent Events (SSE)、ファイルアップロード、アウトバウンド HTTP 通信を含みます。
metadata:
  origin: ECC
  upstream: tinystruct==1.7.37
---

# tinystruct 開発パターン

**tinystruct** Java フレームワークを使用してモジュールをビルドするためのアーキテクチャと実装パターン。CLI と HTTP を等しく扱う軽量・高性能なフレームワークで、`main()` メソッドを必要とせず、最小限の設定で動作します。

## コア原則

**CLI と HTTP は等しい市民（equal citizens）です。** トランスポート中立な `@Action` は `Mode.DEFAULT` を使用するか `mode` を省略し、HTTP専用の依存関係を持たないものです。このようなアクションはターミナルとWebブラウザの両方から実行できます。`Mode.DEFAULT` はトランスポートの制限をなくすだけで、HTTPに依存するメソッドをCLI対応にするものではありません。`Request` と `Response` の引数はHTTPコンテキスト属性から供給されるため、通常のCLI呼び出しのようにその属性がなければ null のままです。共有ロジックはHTTPオブジェクト、セッション、アップロードに依存させず、必要に応じてトランスポート固有のエントリポイントから呼び出してください。この「デュアルモード」対応能力が tinystruct のコア設計思想です。トランスポート固有のモード（`Mode.CLI`、`Mode.HTTP_GET`、`Mode.HTTP_POST` など）を持つアクションは意図的にそのトランスポートに限定されており、もう一方から呼び出すとフレームワークは "The action is not allowed to be executed." で拒否します。

## 主要な開発ツール：`bin/dispatcher`

**`bin/dispatcher` は tinystruct アプリケーションを開発・実行・テスト・デバッグするためのデフォルトかつ最優先のツールです — IDE の実行構成、手書きの `main()`、curl、ブラウザよりも先にこれを使ってください。** トランスポート中立な `@Action` メソッドは設計上デュアルモードであるため、`bin/dispatcher` を使うことでサーバーやブラウザを必要とせず、ターミナルから直接ルーティング・引数バインディング・ビジネスロジックを、最速のフィードバックループで検証できます。HTTPメソッドに限定されたアクション（`Mode.HTTP_POST`、`Mode.HTTP_GET` など）は `bin/dispatcher` からは呼び出せないため、起動中のサーバーに対してHTTPクライアントでテストしてください。

```bash
# CLI対応の @Action を直接実行して新しいアクションを検証する
# （クラスをインポートする必要があります。--import または application.properties の default.import.applications を参照してください）
bin/dispatcher greet/James --import com.example.MyService
bin/dispatcher echo --words "Praise the Lord"

# Web向けの対応部分を検証する必要があるときに HTTP サーバーを起動
bin/dispatcher start --import org.tinystruct.system.HttpServer

# 今回の実行のために追加の Application/MCP クラスをインポート
# （クラスごとに --import を1つ。カンマ区切りのリストは ClassNotFoundException になる）
bin/dispatcher start --import org.tinystruct.system.HttpServer --import com.example.MyService

# 利用可能な内容を確認
bin/dispatcher --help
bin/dispatcher --version
```

このワークフローをデフォルトにしてください：トランスポート中立な `@Action` を実装したら、`bin/dispatcher <action>` ですぐに実行して CLI モードで正しく動作することを確認し、Web向けのパス（例：`mode = Mode.HTTP_POST`、セッション、ファイルアップロードなど）を検証する必要があるときだけ HTTP サーバー（これも `bin/dispatcher start ...` で）を起動します。HTTP専用のアクションではCLIの手順を省略してHTTPでテストし、`Mode.CLI` のアクションではサーバーは不要です。アプリのエントリポイントとして `main(String[] args)` を決してハードコードしないでください — `bin/dispatcher`（Windows では `bin/dispatcher.cmd`）がすべてのモジュールの唯一のエントリポイントです。

### `bin/dispatcher` と `bin/dispatcher.cmd` の生成

すべての tinystruct プロジェクトは `bin/` に起動スクリプトを必要とします。**フレームワークがこれを生成します — 手で書いたり、他のプロジェクトからコピーしたり、`main()` で代用したりしないでください。** `ApplicationManager.init()` は、起動スクリプトが存在しない場合、tinystruct jar 内のテンプレートからそのjarのバージョンを埋め込んだ、実行中のOS用のスクリプトを作業ディレクトリ配下の `bin/` に書き出します。改行コードと実行権限はすでに正しく設定されています。

**1. プロジェクトがビルド対象とする tinystruct のバージョンを確認する**：`pom.xml` の `<tinystruct.version>` プロパティ、または `org.tinystruct:tinystruct` 依存関係です。jar は `~/.m2/repository/org/tinystruct/tinystruct/<version>/`（なければ `mvn dependency:resolve` を実行）か、プロジェクトの `lib/` に存在している必要があります。

**2. プロジェクトルートから、フレームワークを一度実行します：**

```bash
java -cp ~/.m2/repository/org/tinystruct/tinystruct/<version>/tinystruct-<version>.jar \
     org.tinystruct.system.Dispatcher --version
```

`<version>` をステップ1で確認したバージョンに置き換えてください。Windows では `%USERPROFILE%\.m2\repository\org\tinystruct\tinystruct\<version>\tinystruct-<version>.jar` と同じクラスを使用します。これにより**実行したOS用のスクリプトだけ**が、まだ存在しない場合にのみ作成されます：

| 実行環境 | 作成されるもの |
|---|---|
| Linux, macOS | `bin/dispatcher`（実行可能、LF） |
| Windows | `bin\dispatcher.cmd`（CRLF） |

**3. 検証する。** プロジェクトルートから `bin/dispatcher --version`（Windows では `bin\dispatcher.cmd --version`）を実行します。`Dispatcher (cli) (built on tinystruct-<version>)` と表示され、スクリプト内の `VERSION` は jar のバージョンと一致します。続けて `bin/dispatcher --help` を実行すると、コマンド一覧とインポートされたすべてのアクションが表示されます。作成したファイルをユーザーに見せてください。

**4. 両方のスクリプトを取得するには**、各OSでステップ2を実行するか、もう一方のOSでチームメイトやCIに実行させてその結果をコミットしてもらいます。どちらのOSでチェックアウトしても動作するよう、両方をコミットしてください。`-Dos.name=…` で別のOSを偽装しようとしないでください：Windows では `setPosixFilePermissions` の `UnsupportedOperationException` で失敗し、空の `bin/dispatcher` が残ります。チェックアウト時に改行コードが壊れないよう、以下の `.gitattributes` を推奨します：

```
bin/dispatcher     text eol=lf
bin/dispatcher.cmd text eol=crlf
```

**tinystruct のアップグレード：** `pom.xml` のバージョンを変更し、古いスクリプトを削除して、新しい jar でステップ2を繰り返します。あるいは `bin/dispatcher update` が Maven Central で最新リリースを確認し、プロジェクトの依存関係をアップグレードしてスクリプトを強制的に再生成します。これにはネットワークが必要で、`pom.xml` を編集し、選択したバージョンではなく*最新*バージョンに移行します。

**これは暗黙的にも発生します。** `ApplicationManager.init()` に到達するコード（dispatcher 自体、またはユニットテスト内の `ApplicationManager.install(app, config)`）は、スクリプトが存在しない場合、*カレントディレクトリ*にそれを作成します。ユニットテストが `bin/dispatcher.cmd` を各モジュールのディレクトリに散らかしてしまう場合は、ビルドディレクトリから実行してください：surefire の設定で `<workingDirectory>${project.build.directory}</workingDirectory>` を設定します。

**スクリプトの動作内容**（ほとんどの問題を説明します）：

- 必ず**プロジェクトルートから**実行してください：シェルスクリプトはカレントディレクトリをルートとみなし、`.cmd` は `bin/` の親ディレクトリをルートとみなします。
- クラスパスは `target/classes`、`lib/*.jar`、`WEB-INF/lib/*`、`WEB-INF/classes`、そして tinystruct の jar（`lib/` になければ `~/.m2`）で構成され、その後 `org.tinystruct.system.Dispatcher` を引数付きで実行します。
- 初回実行時、`mvnw` / `mvnw.cmd` が存在しない場合は、プロジェクトルートに Maven Wrapper を展開します（Unix では `unzip`、Windows では PowerShell）。これが起こることをユーザーに伝えてください。ファイルはコミットしても、無視してもかまいません。
- `-D…` や `-X…` 引数を JVM オプションとして扱うのはシェルスクリプトのみです。

**注意点：**

- **Windows では `bin\dispatcher.cmd` を使ってください。** シェルスクリプトはクラスパスを `:` で結合するため、Git Bash/MSYS 上では `ClassNotFoundException: org.tinystruct.system.Dispatcher` で失敗します。WSL か `.cmd` を使用してください。
- **クラスパスに含まれるのは tinystruct の jar のみです。** フレームワークはデフォルトで fat jar を提供しなくなったため、他のモジュール、JDBCドライバ、ライブラリ（jjwt、lettuce など）は `lib/` に置く必要があります：`mvn dependency:copy-dependencies -DoutputDirectory=lib`（`lib/` は git-ignore してください）。マルチモジュールビルドでは、起動スクリプトを `target/classes` と `lib/` を持つディレクトリに置き、兄弟モジュールの jar をその `lib/` にコピーしてください。兄弟モジュールがクラスパスに含まれないディレクトリから実行すると `NoClassDefFoundError` になります。
- **アプリケーションは `--import` または設定でロードしてください。** クラスごとに `--import` を1つ（`--import a.A,b.B` は失敗します。`--import a.A --import b.B` と書いてください）、または `application.properties` に一度だけ列挙します：`default.import.applications=a.A;b.B`（`;` 区切り）。
- **`.cmd` には `JAVA_HOME` の設定が必要です**。設定されていないとエラーで停止します。
- **`bin/` は `target/classes` と `lib/` を持つディレクトリの直下に置いてください。** `.cmd` は `bin/` の親ディレクトリをルートとみなすため、`bin/` が誤った場所にネストしていると、間違ったクラスパスが `Dispatcher` の前に付与されます。

## 使用するタイミング

### 使用する場面

- `bin/dispatcher` を通じて、トランスポート中立または `Mode.CLI` の `@Action` を実行・テスト・デバッグするとき — これは HTTP や IDE の実行構成に頼る前の、tinystruct アプリを扱うデフォルトの方法です。HTTP専用のアクションは、代わりにHTTPでテストします。
- `bin/dispatcher` / `bin/dispatcher.cmd` が存在しないプロジェクトをセットアップするとき — フレームワークに生成させてください（「`bin/dispatcher` と `bin/dispatcher.cmd` の生成」を参照）。
- `AbstractApplication` を拡張して新しい `Application` モジュールを作成するとき。
- `@Action` を使用してルートとコマンドラインアクションを定義するとき。
- `Context` を通じてリクエストごとの状態を処理するとき。
- ネイティブの `Builder` と `Builders` コンポーネントを使用してJSONシリアライゼーションを行うとき。
- `AbstractData` POJO を使用してデータベース永続化を行うとき。
- `generate` コマンドを使用してデータベーステーブルから POJO を生成するとき（XML マッピングファイルまたはアノテーション `--mapping annotation`）。
- リアルタイムプッシュのために Server-Sent Events (SSE) を実装するとき。
- multipart データによるファイルアップロードを処理するとき。
- `URLRequest` と `HTTPHandler` を使用してアウトバウンドHTTPリクエストを行うとき。
- `application.properties` でデータベース接続やシステム設定を構成するとき。
- ルーティングの競合（Action）や CLI 引数解析をデバッグするとき。

## 動作の仕組み

tinystruct フレームワークは、`@Action` でアノテーションされたメソッドをルーティング可能なエンドポイントとして扱います。`mode` を指定しない場合、ディスパッチは単一のトランスポートに制限されませんが、引数と実装は実行環境に対応している必要があります。通常のCLI呼び出しではHTTPの `Request` や `Response` オブジェクトは供給されません。`mode = Mode.CLI` や `Mode.HTTP_POST` などのHTTPモードを指定した場合、ディスパッチはそのトランスポートに限定されます。アプリケーションは `AbstractApplication` を拡張することで作成され、`init()` などのコアライフサイクルフックとリクエスト `Context` へのアクセスが提供されます。

ルーティングは `ActionRegistry` によって処理され、パスセグメントをメソッド引数に自動的にマッピングして依存関係を注入します。データのみのサービスでは、ゼロ依存のフットプリントを維持するために、JSONシリアライゼーションにネイティブの `Builder` と `Builders` コンポーネントを使用すべきです。データベース層は `@Table`/`@Column` アノテーションまたは XML マッピングファイルでテーブルにマッピングされた `AbstractData` POJO を使用し、外部 ORM ライブラリなしで CRUD 操作を行います。不足しているテーブルは `database.autocreate=true` で自動的に作成できます。

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

    // パスパラメータ： GET /?q=greet/James  または  bin/dispatcher greet/James
    @Action("greet")
    public String greet(String name) {
        return "Hello, " + name + "!";
    }
}
```

### HTTPモード分岐（login）

以下の長さ制限は UTF-16 コード単位で数えるアプリケーション側の設定例であり、tinystruct のデフォルトではありません。認証サービスの方針に合わせてください。空白だけの認証情報は拒否しますが、認証に渡す値をトリミングしたり変更したりしません。

```java
@Action(value = "login", mode = Mode.HTTP_POST)
public String doLogin(Request<?, ?> request) throws ApplicationException {
    String username = request.getParameter("username");
    String password = request.getParameter("password");

    final int maxUsernameLength = 256;
    final int maxPasswordLength = 1024;
    if (username == null || password == null
            || username.length() > maxUsernameLength || password.length() > maxPasswordLength
            || username.isBlank() || password.isBlank()) {
        throw new ApplicationException("Invalid credentials");
    }

    // AuthService はアプリケーション独自のクラスであり、tinystruct の一部ではない
    String userId = AuthService.getInstance().authenticate(username, password); // 失敗時は null
    if (userId == null) {
        throw new ApplicationException("Invalid credentials");
    }

    // 認証に成功した後にのみセッションを操作する
    request.getSession().setAttribute("userId", userId);
    return "Logged in";
}
```

### ネイティブJSONデータ処理（Builder + Builders）
```java
import org.tinystruct.data.component.Builder;
import org.tinystruct.data.component.Builders;

@Action("api/data")
public String getData() throws ApplicationException {
    Builders dataList = new Builders();
    Builder item = new Builder();
    item.put("id", 1);
    item.put("name", "James");
    dataList.add(item);

    Builder response = new Builder();
    response.put("status", "success");
    response.put("data", dataList);
    return response.toString(); // {"status":"success","data":[{"id":1,"name":"James"}]}
}
```

### SSE（Server-Sent Events）
```java
import org.tinystruct.http.SSEPushManager;

@Action("sse/connect")
public String connect() {
    return "{\"type\":\"connect\",\"message\":\"Connected to SSE\"}";
}

// 特定のクライアントへプッシュ
String sessionId = getContext().getId();
Builder msg = new Builder();
msg.put("text", "Hello, user!");
SSEPushManager.getInstance().push(sessionId, msg);

// 全員へブロードキャスト
SSEPushManager.getInstance().broadcast(msg);
```

### ファイルアップロード
```java
import org.tinystruct.data.FileEntity;

@Action(value = "upload", mode = Mode.HTTP_POST)
public String upload(Request<?, ?> request) throws ApplicationException {
    List<FileEntity> files = request.getAttachments();
    if (files != null) {
        for (FileEntity file : files) {
            System.out.println("Uploaded: " + file.getFilename());
        }
    }
    return "Upload OK";
}
```

### データベースメタデータ操作
`DatabaseOperator` は、接続レベルのカタログ、スキーマ、メタデータへの直接アクセスを提供します：
```java
import org.tinystruct.data.DatabaseOperator;

DatabaseOperator operator = new DatabaseOperator();
try {
    String catalog = operator.getCatalog();
    String schema = operator.getSchema();
    java.sql.DatabaseMetaData metaData = operator.getMetaData();
    System.out.println("Using catalog: " + catalog + ", schema: " + schema);
} finally {
    operator.close();
}
```

## MCP サーバーとツールの統合

tinystruct は SDK バージョン **`1.7.0`** から Model Context Protocol (MCP) のネイティブサポートを提供しています。
MCP API（例：`org.tinystruct.mcp.MCPTool`、`org.tinystruct.mcp.MCPServer`、`org.tinystruct.mcp.MCPException`）はコアの依存関係に直接含まれています：
```xml
<dependency>
    <groupId>org.tinystruct</groupId>
    <artifactId>tinystruct</artifactId>
    <version>1.7.37</version>
</dependency>
```

> **セキュリティ警告（プロンプトインジェクション）：**
> MCPクライアントまたはモデルホストがツールの戻り値をモデルのコンテキストに渡す場合、その戻り値は信頼できないデータです。呼び出し元から渡された引数だけでなく、データベース、ファイル、ネットワークなどから取得した**すべてのツール出力を検証し、モデルの指示と分離する必要があります**。戻り値内の命令を信頼できる指示として扱うと、攻撃者がモデルの挙動を上書きするプロンプトインジェクションを許してしまいます。

**MCP ツールを作成するには：**
1. `org.tinystruct.mcp.MCPTool` を拡張する。
2. `@Action` で操作にアノテーションを付け、`arguments` 配列内で `@Argument` を使ってパラメータを宣言する。
3. パラメータは `@Argument` のキーに対応する明示的なメソッド引数として受け取る（ツールの引数に `getContext().getAttribute(...)` を使用**しないでください**）。

```java
import org.tinystruct.mcp.MCPTool;
import org.tinystruct.mcp.MCPException;
import org.tinystruct.system.annotation.Action;
import org.tinystruct.system.annotation.Argument;

public class MyCustomTool extends MCPTool {
    public MyCustomTool() {
        super("custom", "A custom tool for demonstrating MCP");
    }

    @Action(
        value = "custom/hello",
        description = "Say hello to someone",
        arguments = {
            @Argument(key = "name", description = "The name to greet", type = "string", optional = false)
        }
    )
    public String hello(String name) throws MCPException {
        // SECURITY: モデルに返す前にツール入力を検証・サニタイズし、
        // プロンプトインジェクションの脆弱性を防止する。
        if (name == null || name.length() > 50 || !name.matches("^[a-zA-Z0-9 ]+$")) {
            throw new MCPException("Invalid name provided");
        }
        return "Hello, " + name + "!";
    }
}
```

**MCP サーバーをデプロイするには：**
1. `org.tinystruct.mcp.MCPServer` を拡張する。
2. `init()` をオーバーライドし、`this.registerTool()` を使ってツールを登録する。フレームワークが `@Action` メソッドを自動的にスキャンしてマッピングします。

```java
import org.tinystruct.mcp.MCPServer;

public class MyMCPServer extends MCPServer {
    @Override
    public void init() {
        super.init();
        this.registerTool(new MyCustomTool());
    }

    @Override
    public String version() {
        return "1.0.0";
    }
}
```

dispatcher 経由でサーバーを実行します：
```bash
bin/dispatcher start --import org.tinystruct.system.HttpServer --import com.example.MyMCPServer
```

### オーバーロードされたツールメソッド
tinystruct は `MCPTool` 内で同一ツール名に対するオーバーロードメソッド（同じツール名を共有しつつ異なるパラメータシグネチャを受け取る）をサポートしています。
- **スキーママージ**：同じ名前を持つすべてのオーバーロードの入力スキーマは、動的に統合されたひとつの JSON スキーマにマージされます。プロパティは和集合として扱われ、必須プロパティは積集合として扱われます（*すべての*オーバーロードで必須とされているフィールドのみが必須として残ります）。
- **実行ルーティング**：ツールを実行する際、サーバーは利用可能なオーバーロードメソッドを順に試行します。各メソッドのスキーマ検証が最初に行われ、提供された引数に対して最初に検証を通過したオーバーロードが実行されます。どのシグネチャも一致・成功しない場合、フレームワークは適切な例外をスローします。

## 設定

設定は `src/main/resources/application.properties` で管理されます。

```properties
# データベース
driver=org.h2.Driver
database.url=jdbc:h2:~/mydb
database.user=sa
database.password=
# 任意：初回利用時にクラスのマッピングから不足しているテーブルを作成する（デフォルトはオフ）
# database.autocreate=true

# サーバー
default.home.page=hello
server.port=8080
default.server.open_browser=true
# 静的ファイルはこれらのディレクトリ（カンマまたはセミコロン区切り）からのみ配信されます。
# ルートや親パスにシンボリックリンクがない公開用の実ディレクトリを使ってください。
# 作業ディレクトリ自体やその祖先を公開しないでください。デフォルト：static
# server.static.dirs=static,public

# ロケール
default.language=en_US

# セッション（クラスタ環境向けの Redis）
# default.session.repository=org.tinystruct.http.RedisSessionRepository
# redis.host=127.0.0.1
# redis.port=6379

# プログラムによるロギング設定
logging.enabled=true
logging.level=INFO
org.tinystruct.level=FINE
# 作成するハンドラ（カンマまたは空白区切り）。デフォルト：ConsoleHandler のみ
handlers=java.util.logging.ConsoleHandler
# ローテーション付きのログファイルも書き出すには、FileHandler を追加する：
# handlers=java.util.logging.ConsoleHandler, java.util.logging.FileHandler
# java.util.logging.FileHandler.pattern=logs/tinystruct-%g.log
# java.util.logging.FileHandler.limit=10485760
# java.util.logging.FileHandler.count=5
# java.util.logging.FileHandler.level=INFO
# java.util.logging.FileHandler.formatter=org.tinystruct.system.logging.LogFormatter
# java.util.logging.FileHandler.encoding=UTF-8
```

アプリケーション内で設定値にアクセスする：
```java
String port = this.getConfiguration("server.port");
```

## ロギングと診断

フレームワークには `java.util.logging`（JUL）を包む形のプログラム的なラッパーが含まれており、標準で見やすいコンソール出力と高度な呼び出し元トレースを提供します。

- **ANSI コンソールカラー**：コンソール出力はログレベルに応じて色分けされます（SEVERE は赤、WARNING は黄、INFO は緑、CONFIG はシアン、FINE/デバッグログはグレー）。
- **正確な呼び出し元トレース**：Java の `StackWalker` API を使用して実行時のコールスタックをトレースします。ログを発生させた呼び出し元の正確なクラス、メソッド、ファイル名、行番号を特定してログに記録します（内部のユーティリティ層やロギング層は経由しません）。
- **パッケージ/ロガーレベルの上書き**：`application.properties` にパッケージ単位の上書きを直接設定できます（例：`org.tinystruct.level=FINE`）。
- **有効/無効とレベル**：`logging.enabled=false` ですべてのロギングが無効になります。`logging.level` はルートロガーのレベルを設定し、`OFF`、`SEVERE`/`ERROR`、`WARNING`/`WARN`、`INFO`、`CONFIG`、`FINE`/`DEBUG`、`FINER`、`FINEST`/`TRACE`、`ALL` を受け付けます（デフォルトは `INFO`）。
- **設定可能なハンドラ**：`handlers` プロパティで作成するハンドラを列挙します（カンマまたは空白区切り）。デフォルトは `java.util.logging.ConsoleHandler` です。各ハンドラは自身の `<handler>.level`（デフォルト `ALL`）、`<handler>.formatter`、`<handler>.encoding` を読み取ります。パブリックな引数なしコンストラクタを持つ `java.util.logging.Handler` や `Formatter` のクラスを指定できます。不明なフォーマッタは組み込みの `LogFormatter` にフォールバックし、作成できないハンドラは標準エラーに報告されますが、他のハンドラは起動します。
- **FileHandler**：オプトインです。`java.util.logging.FileHandler.pattern` は省略可能で（デフォルトは `%h/java%u.log`、ユーザーのホームディレクトリ）、親ディレクトリが存在しなければ作成されます。`logs/tinystruct-%g.log` のような相対パターンは、アプリケーションを起動したディレクトリ（そこで `bin/dispatcher` を実行する場合はプロジェクトルート）を基準に解決されます。`limit`（デフォルト `0`、無制限。それ以外は1ファイルあたりの最大バイト数）、`count`（デフォルト `1`、保持するファイル数）、`append`（デフォルト `true`）でローテーションを制御します。パターン中の `%g` はローテーション番号で、`count=5` なら `tinystruct-0.log` から `tinystruct-4.log` が作られます。有効にするには、`handlers` に `java.util.logging.FileHandler` を追加し、上記のプロパティを設定して、再起動します。ANSI カラーはコンソール出力にのみ適用され、ログファイルには適用されません。
- **2つのレベルゲート**：ログレコードはロガーのレベルとハンドラのレベルの両方を通過する必要があります。ハンドラを `FINE` に上げても、ロガーが許可しない限り何も表示されません。たとえば `logging.level=FINE` や、`org.tinystruct.level=FINE` のようなパッケージ単位の上書きを設定してください。
- **適用タイミング**：ロギング設定は `ApplicationManager` の初期化時に `application.properties` から一度だけ読み込まれます。変更後はアプリケーションを再起動してください。

## 静的ファイル

組み込みの `HttpServer` は、`server.static.dirs`（カンマまたはセミコロン区切り）、それがなければ `server.static.dir` で指定されたルートから静的ファイルを配信します。デフォルトは `static` です。1.7.37 の作業ディレクトリ・祖先チェックは、シンボリックリンクを解決する前の正規化されたパス名を比較します。通常の実ディレクトリを指定する `.` や `..` は拒否しますが、設定したルートがプロジェクトディレクトリや祖先へのシンボリックリンクの場合、このチェックを通過できます。作業ディレクトリ外の兄弟ディレクトリも許可され、子孫ディレクトリだけに制限する実装ではありません。

公開用アセットには、公開するファイルだけを置いた `static/` のような専用の実ディレクトリを使ってください。設定したルートやその親パスの要素が、より広いディレクトリや非公開ディレクトリへのシンボリックリンクになっていないことを確認してください。`.` や `..` のセグメント、`.git` や `.env` などの隠し名、`.` や空白で終わる名前を含むリクエストは拒否されます。配信候補のファイルは、設定したルートの解決後のパス内に収まる必要があります。ただし、ルート自体の解決先がプロジェクトディレクトリなら、この包含チェックではルート直下のファイルを保護できません。ハンドラは後段の `isProjectRootFile` チェックより先に、一致した静的ファイルを配信します。設定したルートがシンボリックリンクの場合、プロジェクトルートのファイルが常に拒否されるとは考えないでください。[固定した v1.7.37 の実装](https://github.com/tinystruct/tinystruct/blob/089ec19022f3bb5d87f1e83e30b2034b24f7e77f/src/main/java/org/tinystruct/system/HttpServer.java#L569-L720)を参照してください。

## レッドフラグとアンチパターン

| 症状 | 正しいパターン |
|---|---|
| `com.google.gson` や `com.fasterxml.jackson` のインポート | `org.tinystruct.data.component.Builder` / `Builders` を使用する。 |
| JSON配列に `List<Builder>` を使用する | ジェネリックの型消去の問題を避けるため `Builders` を使用する。 |
| `ApplicationRuntimeException: template not found` | API専用アプリでは `init()` 内で `setTemplateRequired(false)` を呼び出す。 |
| `private` メソッドへの `@Action` アノテーション | アクションはフレームワークに登録されるために `public` である必要がある。 |
| アプリ内で `main(String[] args)` をハードコードする、または curl/ブラウザ/IDE の実行構成だけでテストする | すべてのモジュールのエントリポイントとして、またトランスポート中立およびCLIアクションのデフォルトの開発/テストツールとして `bin/dispatcher` を使用する（HTTP専用のアクションは、それが起動するサーバーに対してHTTPでテストする）。 |
| `bin/dispatcher` が存在しない、または手書き・コピーされた起動スクリプトになっている | フレームワークに生成させる：プロジェクトルートから `org.tinystruct.system.Dispatcher --version` を一度実行する（現在のOS用のスクリプトが作成される）。 |
| Windows で `bin/dispatcher` が `ClassNotFoundException: org.tinystruct.system.Dispatcher` で失敗する | シェルスクリプトは Git Bash/MSYS 上では実行できない。`bin\dispatcher.cmd` または WSL を使用する。 |
| `--import a.A,b.B` で `ClassNotFoundException` が発生する | クラスごとに `--import` を1つ：`--import a.A --import b.B`。 |
| シェルスクリプトの起動ファイルが `\r: command not found` で失敗する | ファイルが CRLF 改行になっている。`bin/dispatcher` を LF に変換する。 |
| 手動での `ActionRegistry` 登録 | 自動検出のために `@Action` アノテーションを優先する。 |
| 実行時にアクションが見つからない | クラスが `--import` でインポートされているか、`application.properties` に列挙されているか確認する。 |
| CLI引数が認識されない | `--key value` の形で渡し、`getContext().getAttribute("--key")` でアクセスする。 |
| 同じパスの2つのメソッドで、意図しない方が呼ばれる | 明示的な `mode`（例：`HTTP_GET` と `HTTP_POST`）を設定して区別する。 |
| `bin/dispatcher` が "The action is not allowed to be executed." で失敗する | そのアクションはHTTP固有のモードを持っており、CLIからは呼び出せない。HTTPでテストする。両方に対応するには、まずHTTP専用の依存関係を共有ロジックから分離し、CLI対応のエントリポイントに `Mode.DEFAULT` を使用する。 |
| ファイルが存在するのに静的ファイルが404を返す | `server.static.dirs` / `server.static.dir`（デフォルト `static/`）、禁止されたリクエスト名、解決後のルート内への包含を確認する。公開用の実ディレクトリを使う。設定したルートがシンボリックリンクなら、プロジェクトルートのチェックより先にプロジェクトや祖先のファイルが公開される場合がある。 |
| ログファイルが書き出されない | `FileHandler` はオプトイン：`handlers` に `java.util.logging.FileHandler` を追加する。`java.util.logging.FileHandler.pattern` を設定しない場合、ファイルは `%h/java%u.log`（ホームディレクトリ）に作成される。 |
| `FINE` / デバッグメッセージが表示されない | 両方のゲートが許可する必要がある：`logging.level=FINE`（または `org.tinystruct.level=FINE` のようなパッケージ単位の上書き）を設定し、ハンドラの `.level` がそれより厳しくないことを確認する。 |

## ベストプラクティス

1. **`bin/dispatcher` を最優先に**：トランスポート中立および `Mode.CLI` のアクションでは、何よりもまず `bin/dispatcher` に対して開発・検証を行ってください — CLI からアクションを実行して挙動を確認し、その後 HTTP/モードに関する関心事を積み重ねます。HTTPモード（`Mode.HTTP_POST` など）のアクションはCLIからは拒否されるため、サーバーを起動してHTTPでテストしてください。これが最速のインナーループであり、フレームワークが実際にルーティングと引数バインディングを行う方法と確実に一致する唯一のツールです。
2. **粒度の細かいアプリケーション**：巨大な単一クラスではなく、ロジックを小さく焦点を絞ったアプリケーションに分割する。
3. **`init()` でのセットアップ**：コンストラクタではなく `init()` をセットアップ（設定、DB など）に活用する。`setAction()` を呼び出さず、`@Action` アノテーションを使用する。
4. **モードへの意識**：`@Action` の `Mode` パラメータを使用して、機密性の高い操作を `CLI` のみ、または特定の HTTP メソッドに制限する。
5. **パラメータより Context を優先**：任意の CLI フラグには、メソッドシグネチャにパラメータを追加するのではなく `getContext().getAttribute("--flag")` を使用する。
6. **非同期イベント**：イベントによってトリガーされる重い処理には、イベントハンドラ内で `CompletableFuture.runAsync()` を使用する。

## テクニカルリファレンス

詳細なガイドは `references/` ディレクトリにあります：

- [アーキテクチャと設定](../../../../skills/tinystruct-patterns/references/architecture.md) — 抽象化、パッケージマップ、プロパティ
- [ルーティングと@Action](../../../../skills/tinystruct-patterns/references/routing.md) — アノテーションの詳細、モード、パラメータ
- [データ処理](../../../../skills/tinystruct-patterns/references/data-handling.md) — Builder、Builders、JSONのシリアライズ・パース
- [データベース永続化](references/database.md) — AbstractData POJO、CRUD、アノテーションとXMLマッピング、POJO生成、テーブルの自動作成
- [システムと使用方法](../../../../skills/tinystruct-patterns/references/system-usage.md) — Context、セッション、SSE、ファイルアップロード、イベント、ネットワーキング
- [テストパターン](../../../../skills/tinystruct-patterns/references/testing.md) — JUnit 5 によるユニットテストとHTTP統合テスト

## 参照元ソースファイル（内部用）

- `src/main/java/org/tinystruct/AbstractApplication.java` — ライフサイクルフックを持つコアベースクラス
- `src/main/java/org/tinystruct/system/annotation/Action.java` — アノテーションとモード
- `src/main/java/org/tinystruct/application/ActionRegistry.java` — ルーティングエンジン
- `src/main/java/org/tinystruct/data/component/Builder.java` — JSONオブジェクトのシリアライザ
- `src/main/java/org/tinystruct/data/component/Builders.java` — JSON配列のシリアライザ
- `src/main/java/org/tinystruct/data/component/AbstractData.java` — CRUDを持つ基底POJOクラス
- `src/main/java/org/tinystruct/data/Mapping.java` — マッピングメタデータ（アノテーションまたはXML）、クラスごとにキャッシュ
- `src/main/java/org/tinystruct/data/annotation/Table.java` — `@Table`（`@Id` と `@Column` も同梱）
- `src/main/java/org/tinystruct/data/tools/TableCreator.java` — 不足しているテーブルを作成する（`database.autocreate`）
- `src/main/java/org/tinystruct/data/tools/MySQLGenerator.java` — POJOジェネレータのリファレンス（`MappingMode` でXMLかアノテーションかを選択）
- `src/main/java/org/tinystruct/data/component/FieldType.java` — SQLからJavaへの型マッピング
- `src/main/java/org/tinystruct/data/component/Condition.java` — 流暢なSQLクエリビルダー
- `src/main/java/org/tinystruct/http/SSEPushManager.java` — SSE接続管理
- `src/main/java/org/tinystruct/system/logging/LogFormatter.java` — ANSIコンソールカラーとStackWalkerベースの呼び出し元トレースを備えたカスタムログフォーマッタ
- `src/main/java/org/tinystruct/system/logging/LoggerConfigurer.java` — アプリケーションプロパティからのプログラムによるロギング構成
- `src/test/java/org/tinystruct/application/ActionRegistryTest.java` — レジストリのテスト例
- `src/test/java/org/tinystruct/system/HttpServerHttpModeTest.java` — HTTP統合テストパターン
