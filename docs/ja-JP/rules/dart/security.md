---
paths:
  - "**/*.dart"
  - "**/pubspec.yaml"
  - "**/AndroidManifest.xml"
  - "**/Info.plist"
---
# Dart/Flutter セキュリティ

> このファイルは [common/security.md](../common/security.md) を Dart、Flutter、およびモバイル固有のコンテンツで拡張します。

## シークレット管理

- Dart ソースコードに API キー、トークン、認証情報をハードコードしない
- コンパイル時設定には `--dart-define` または `--dart-define-from-file` を使用する (値は真のシークレットではない — サーバーサイドのシークレットにはバックエンドプロキシを使用する)
- `flutter_dotenv` または同等のものを使用し、`.env` ファイルを `.gitignore` に記載する
- ランタイムシークレットはプラットフォームのセキュアなストレージに保存する: `flutter_secure_storage` (iOS の Keychain、Android の EncryptedSharedPreferences)

```dart
// BAD
const apiKey = 'sk-abc123...';

// GOOD — コンパイル時設定 (シークレットではなく、設定可能な値)
const apiKey = String.fromEnvironment('API_KEY');

// GOOD — セキュアなストレージからのランタイムシークレット
final token = await secureStorage.read(key: 'auth_token');
```

## ネットワークセキュリティ

- HTTPS を強制する — 本番環境で `http://` の呼び出しは禁止
- Android の `network_security_config.xml` を設定してクリアテキストトラフィックをブロックする
- `Info.plist` の `NSAppTransportSecurity` を設定して任意のロードを禁止する
- すべての HTTP クライアントにリクエストタイムアウトを設定する — デフォルトのままにしない
- セキュリティが重要なエンドポイントには証明書ピンニングを検討する

```dart
// タイムアウトと HTTPS 強制を設定した Dio
final dio = Dio(BaseOptions(
  baseUrl: 'https://api.example.com',
  connectTimeout: const Duration(seconds: 10),
  receiveTimeout: const Duration(seconds: 30),
));
```

## 入力バリデーション

- API またはストレージに送信する前にすべてのユーザー入力をバリデートおよびサニタイズする
- SQLクエリに未サニタイズの入力を渡さない — パラメータ化クエリを使用する (sqflite、drift)
- ナビゲーション前にディープリンク URL をサニタイズする — スキーム、ホスト、パスパラメータを検証する
- ナビゲーション前に `Uri.tryParse` を使用して検証する

```dart
// BAD — SQL インジェクション
await db.rawQuery("SELECT * FROM users WHERE email = '$userInput'");

// GOOD — パラメータ化クエリ
await db.query('users', where: 'email = ?', whereArgs: [userInput]);

// BAD — 未検証のディープリンク
final uri = Uri.parse(incomingLink);
context.go(uri.path); // 任意のルートにナビゲートできてしまう

// GOOD — 検証済みのディープリンク
final uri = Uri.tryParse(incomingLink);
if (uri != null && uri.host == 'myapp.com' && _allowedPaths.contains(uri.path)) {
  context.go(uri.path);
}
```

## データ保護

- トークン、PII、認証情報は `flutter_secure_storage` にのみ保存する
- 機密データを `SharedPreferences` やローカルファイルに平文で書き込まない
- ログアウト時に認証ステートをクリアする: トークン、キャッシュされたユーザーデータ、Cookie
- 機密操作には生体認証 (`local_auth`) を使用する
- 機密データをログに記録しない — `print(token)` や `debugPrint(password)` は禁止

## Android 固有

- `AndroidManifest.xml` で必要なパーミッションのみを宣言する
- Android コンポーネント (`Activity`、`Service`、`BroadcastReceiver`) は必要な場合のみ export する。不要な場合は `android:exported="false"` を追加する
- インテントフィルターを確認する — 暗黙的インテントフィルターを持つ export されたコンポーネントはどのアプリからもアクセス可能
- 機密データを表示する画面では `FLAG_SECURE` を使用する (スクリーンショットを防止)

```xml
<!-- AndroidManifest.xml — エクスポートされるコンポーネントを制限 -->
<activity android:name=".MainActivity" android:exported="true">
    <!-- ランチャーアクティビティのみ exported=true が必要 -->
</activity>
<activity android:name=".SensitiveActivity" android:exported="false" />
```

## iOS 固有

- `Info.plist` で必要な使用説明のみを宣言する (`NSCameraUsageDescription` など)
- シークレットは Keychain に保存する — `flutter_secure_storage` は iOS で Keychain を使用する
- App Transport Security (ATS) を使用する — 任意のロードを禁止する
- 機密ファイルのデータ保護エンタイトルメントを有効にする

## WebView セキュリティ

- `webview_flutter` v4+ (`WebViewController` / `WebViewWidget`) を使用する — レガシーの `WebView` ウィジェットは削除済み
- 明示的に必要でない限り JavaScript を無効にする (`JavaScriptMode.disabled`)
- URL をロードする前に検証する — ディープリンクから任意の URL をロードしない
- 必要不可欠で注意深くサンドボックス化されている場合を除き、Dart コールバックを JavaScript に公開しない
- `NavigationDelegate.onNavigationRequest` を使用してナビゲーションリクエストをインターセプトして検証する

```dart
// webview_flutter v4+ API (WebViewController + WebViewWidget)
final controller = WebViewController()
  ..setJavaScriptMode(JavaScriptMode.disabled) // 必要でない限り無効
  ..setNavigationDelegate(
    NavigationDelegate(
      onNavigationRequest: (request) {
        final uri = Uri.tryParse(request.url);
        if (uri == null || uri.host != 'trusted.example.com') {
          return NavigationDecision.prevent;
        }
        return NavigationDecision.navigate;
      },
    ),
  );

// ウィジェットツリー内:
WebViewWidget(controller: controller)
```

## 難読化とビルドセキュリティ

- リリースビルドで難読化を有効にする: `flutter build apk --obfuscate --split-debug-info=./debug-info/`
- `--split-debug-info` の出力はバージョン管理から除外する (クラッシュシンボル化のみに使用)
- ProGuard/R8 のルールがシリアライズされたクラスを意図せず公開しないことを確認する
- リリース前に `flutter analyze` を実行してすべての警告に対応する
