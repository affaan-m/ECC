---
name: tinystruct-patterns
description: tinystruct Java フレームワークで開発する際の専門ガイダンス。tinystruct コードベース、または tinystruct 上に構築されたあらゆるプロジェクトで作業する際に使用します — プロジェクトに存在しない場合の bin/dispatcher・bin/dispatcher.cmd 起動スクリプトの生成、Application クラスの作成、@Action によるルート定義、ユニットテスト、ActionRegistry、HTTP/CLI デュアルモード対応、組み込み HTTP サーバー、イベントシステム、Builder/Builders による JSON 処理、AbstractData によるデータベース永続化、POJO 生成、Server-Sent Events (SSE)、ファイルアップロード、アウトバウンド HTTP 通信を含みます。
origin: ECC
---

# tinystruct 開発パターン

**tinystruct** Java フレームワークを使用してモジュールをビルドするためのアーキテクチャと実装パターン。CLI と HTTP を等しく扱う軽量・高性能なフレームワークで、`main()` メソッドを必要とせず、最小限の設定で動作します。

## コア原則

**CLI と HTTP は等しい市民（equal citizens）です。** `@Action` でアノテーションされたすべてのメソッドは、理想的には変更なしでターミナルとWebブラウザの両方から実行可能であるべきです。この「デュアルモード」対応能力が tinystruct のコア設計思想です。

## 主要な開発ツール：`bin/dispatcher`

**`bin/dispatcher` は tinystruct アプリケーションを開発・実行・テスト・デバッグするためのデフォルトかつ最優先のツールです — IDE の実行構成、手書きの `main()`、curl、ブラウザよりも先にこれを使ってください。** すべての `@Action` は設計上デュアルモードであるため、`bin/dispatcher` を使うことでサーバーやブラウザを必要とせず、ターミナルから直接ルーティング・引数バインディング・ビジネスロジックを、最速のフィードバックループで検証できます。

```bash
# @Action を直接実行 - 新しいアクションが動作するか確認する最速の方法
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

このワークフローをデフォルトにしてください：`@Action` を実装したら、`bin/dispatcher <action>` ですぐに実行して CLI モードで正しく動作することを確認し、Web向けのパス（例：`mode = Mode.HTTP_POST`、セッション、ファイルアップロードなど）を検証する必要があるときだけ HTTP サーバー（これも `bin/dispatcher start ...` で）を起動します。アプリのエントリポイントとして `main(String[] args)` を決してハードコードしないでください — `bin/dispatcher`（Windows では `bin/dispatcher.cmd`）がすべてのモジュールの唯一のエントリポイントです。

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

- `bin/dispatcher` を通じて `@Action` を実行・テスト・デバッグするとき — これは HTTP や IDE の実行構成に頼る前の、tinystruct アプリを扱うデフォルトの方法です。
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

tinystruct フレームワークは、`@Action` でアノテーションされたメソッドをターミナルとWeb環境の両方でルーティング可能なエンドポイントとして扱います。アプリケーションは `AbstractApplication` を拡張することで作成され、`init()` などのコアライフサイクルフックとリクエスト `Context` へのアクセスが提供されます。

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
```java
@Action(value = "login", mode = Mode.HTTP_POST)
public String doLogin(Request<?, ?> request) throws ApplicationException {
    request.getSession().setAttribute("userId", "42");
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
    <version>1.7.34</version>
</dependency>
```

> **セキュリティ警告（プロンプトインジェクション）：**
> ツールの戻り値は、そのままAIモデルのコンテキストウィンドウに渡されます。ツールの戻り値文字列に含める前に、呼び出し元から渡されたすべての引数を検証・サニタイズする**必要があります**。入力をサニタイズしないと、攻撃者がモデルの挙動を上書きする敵対的な指示（プロンプトインジェクション）を注入できてしまいます。常に長さ、文字種、null であるかどうかを検証してください。

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

## レッドフラグとアンチパターン

| 症状 | 正しいパターン |
|---|---|
| `com.google.gson` や `com.fasterxml.jackson` のインポート | `org.tinystruct.data.component.Builder` / `Builders` を使用する。 |
| JSON配列に `List<Builder>` を使用する | ジェネリックの型消去の問題を避けるため `Builders` を使用する。 |
| `ApplicationRuntimeException: template not found` | API専用アプリでは `init()` 内で `setTemplateRequired(false)` を呼び出す。 |
| `private` メソッドへの `@Action` アノテーション | アクションはフレームワークに登録されるために `public` である必要がある。 |
| アプリ内で `main(String[] args)` をハードコードする、または curl/ブラウザ/IDE の実行構成だけでテストする | すべてのモジュールのエントリポイント兼デフォルトの開発/テストツールとして `bin/dispatcher` を使用する。 |
| `bin/dispatcher` が存在しない、または手書き・コピーされた起動スクリプトになっている | フレームワークに生成させる：プロジェクトルートから `org.tinystruct.system.Dispatcher --version` を一度実行する（現在のOS用のスクリプトが作成される）。 |
| Windows で `bin/dispatcher` が `ClassNotFoundException: org.tinystruct.system.Dispatcher` で失敗する | シェルスクリプトは Git Bash/MSYS 上では実行できない。`bin\dispatcher.cmd` または WSL を使用する。 |
| `--import a.A,b.B` で `ClassNotFoundException` が発生する | クラスごとに `--import` を1つ：`--import a.A --import b.B`。 |
| シェルスクリプトの起動ファイルが `\r: command not found` で失敗する | ファイルが CRLF 改行になっている。`bin/dispatcher` を LF に変換する。 |
| 手動での `ActionRegistry` 登録 | 自動検出のために `@Action` アノテーションを優先する。 |
| 実行時にアクションが見つからない | クラスが `--import` でインポートされているか、`application.properties` に列挙されているか確認する。 |
| CLI引数が認識されない | `--key value` の形で渡し、`getContext().getAttribute("--key")` でアクセスする。 |
| 同じパスの2つのメソッドで、意図しない方が呼ばれる | 明示的な `mode`（例：`HTTP_GET` と `HTTP_POST`）を設定して区別する。 |

## ベストプラクティス

1. **`bin/dispatcher` を最優先に**：何よりもまず `bin/dispatcher` に対して開発・検証を行ってください — CLI からアクションを実行して挙動を確認し、その後 HTTP/モードに関する関心事を積み重ねます。これが最速のインナーループであり、フレームワークが実際にルーティングと引数バインディングを行う方法と確実に一致する唯一のツールです。
2. **粒度の細かいアプリケーション**：巨大な単一クラスではなく、ロジックを小さく焦点を絞ったアプリケーションに分割する。
3. **`init()` でのセットアップ**：コンストラクタではなく `init()` をセットアップ（設定、DB など）に活用する。`setAction()` を呼び出さず、`@Action` アノテーションを使用する。
4. **モードへの意識**：`@Action` の `Mode` パラメータを使用して、機密性の高い操作を `CLI` のみ、または特定の HTTP メソッドに制限する。
5. **パラメータより Context を優先**：任意の CLI フラグには、メソッドシグネチャにパラメータを追加するのではなく `getContext().getAttribute("--flag")` を使用する。
6. **非同期イベント**：イベントによってトリガーされる重い処理には、イベントハンドラ内で `CompletableFuture.runAsync()` を使用する。

## テクニカルリファレンス

詳細なガイドは `references/` ディレクトリにあります：

- [アーキテクチャと設定](references/architecture.md) — 抽象化、パッケージマップ、プロパティ
- [ルーティングと@Action](references/routing.md) — アノテーションの詳細、モード、パラメータ
- [データ処理](references/data-handling.md) — Builder、Builders、JSONのシリアライズ・パース
- [データベース永続化](references/database.md) — AbstractData POJO、CRUD、アノテーションとXMLマッピング、POJO生成、テーブルの自動作成
- [システムと使用方法](references/system-usage.md) — Context、セッション、SSE、ファイルアップロード、イベント、ネットワーキング
- [テストパターン](references/testing.md) — JUnit 5 によるユニットテストとHTTP統合テスト

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
