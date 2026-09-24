---
name: laravel-security
description: Laravel セキュリティベストプラクティス：認証・認可、バリデーション、CSRF、一括割当、ファイルアップロード、シークレット管理、レート制限、安全なデプロイメント
origin: ECC
---

# Laravel セキュリティベストプラクティス

Laravel アプリケーションを一般的な脆弱性から守るための包括的なセキュリティガイダンス。

## アクティベートする時機

- 認証または認可を追加する場合
- ユーザー入力とファイルアップロードを処理する場合
- 新しい API エンドポイントを構築する場合
- シークレットと環境設定を管理する場合
- 本番環境デプロイメントを強化する場合

## 仕組み

- ミドルウェアは基本的な保護を提供（CSRF は `VerifyCsrfToken` 経由、セキュリティヘッダーは `SecurityHeaders` 経由）
- ガードとポリシーがアクセス制御を実施（`auth:sanctum`、`$this->authorize`、ポリシーミドルウェア）
- フォームリクエストが入力を検証し形成（`UploadInvoiceRequest`）サービスに到達する前に
- レート制限が不正使用保護を追加（`RateLimiter::for('login')`）認証制御と並行して
- データの安全性は暗号化されたキャスト、一括割当ガード、署名付きルート（`URL::temporarySignedRoute` + `signed` ミドルウェア）から来ます

## コアセキュリティ設定

- `APP_DEBUG=false` を本番環境で設定
- `APP_KEY` をセットして、漏洩時にはローテーション必須
- `SESSION_SECURE_COOKIE=true` と `SESSION_SAME_SITE=lax`（または機密アプリケーションは `strict`）を設定
- 正しい HTTPS 検出のため、信頼できるプロキシを設定

## セッションとクッキーの強化

- `SESSION_HTTP_ONLY=true` を設定して JavaScript アクセスを防止
- 高リスクフローに対して `SESSION_SAME_SITE=strict` を使用
- ログイン時と権限変更時にセッションを再生成

## 認証とトークン

- Laravel Sanctum または Passport を API 認証に使用
- 機密データの場合、有効期限の短いトークンとリフレッシュフローを優先
- ログアウトと侵害されたアカウントでトークンを無効化

ルート保護例：

```php
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->get('/me', function (Request $request) {
    return $request->user();
});
```

## パスワードセキュリティ

- `Hash::make()` でパスワードをハッシュし、平文で保存しない
- パスワードリセットフロー用に Laravel のパスワードブローカーを使用

```php
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;

$validated = $request->validate([
    'password' => ['required', 'string', Password::min(12)->letters()->mixedCase()->numbers()->symbols()],
]);

$user->update(['password' => Hash::make($validated['password'])]);
```

## 認可：ポリシーとゲート

- モデルレベルの認可にはポリシーを使用
- コントローラーとサービスで認可を実施

```php
$this->authorize('update', $project);
```

ルートレベルの実施にはポリシーミドルウェアを使用：

```php
use Illuminate\Support\Facades\Route;

Route::put('/projects/{project}', [ProjectController::class, 'update'])
    ->middleware(['auth:sanctum', 'can:update,project']);
```

## バリデーションとデータサニタイゼーション

- フォームリクエストで常にユーザー入力をバリデーション
- 厳密なバリデーションルールと型チェックを使用
- リクエストペイロードを派生フィールドに信頼しない

## 一括割当保護

- `$fillable` または `$guarded` を使用して、`Model::unguard()` は回避
- DTO またはかば詰明示的な属性マッピングを優先

## SQL インジェクション防止

- Eloquent またはクエリビルダーのパラメータバインディングを使用
- 厳密に必要でない限り生 SQL を回避

```php
DB::select('select * from users where email = ?', [$email]);
```

## XSS 防止

- Blade は標準で出力をエスケープ（`{{ }}`）
- `{!! !!}` は信頼できる、サニタイズされた HTML にのみ使用
- リッチテキストを専用ライブラリでサニタイズ

## CSRF 保護

- `VerifyCsrfToken` ミドルウェアを有効に保つ
- フォームに `@csrf` を含めて、SPA リクエストで XSRF トークンを送信

SPA 認証（Sanctum）の場合、ステートフルなリクエストが設定されていることを確認：

```php
// config/sanctum.php
'stateful' => explode(',', env('SANCTUM_STATEFUL_DOMAINS', 'localhost')),
```

## ファイルアップロード安全性

- ファイルサイズ、MIME タイプ、拡張子をバリデーション
- 可能な場合、公開パスの外にアップロードを保存
- 必要に応じてファイルをマルウェアスキャン

```php
final class UploadInvoiceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return (bool) $this->user()?->can('upload-invoice');
    }

    public function rules(): array
    {
        return [
            'invoice' => ['required', 'file', 'mimes:pdf', 'max:5120'],
        ];
    }
}
```

```php
$path = $request->file('invoice')->store(
    'invoices',
    config('filesystems.private_disk', 'local') // set this to a non-public disk
);
```

## レート制限

- 認証とライトエンドポイントに `throttle` ミドルウェアを適用
- ログイン、パスワードリセット、OTP にはより厳しい制限を使用

```php
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

RateLimiter::for('login', function (Request $request) {
    return [
        Limit::perMinute(5)->by($request->ip()),
        Limit::perMinute(5)->by(strtolower((string) $request->input('email'))),
    ];
});
```

## シークレットと認証情報

- シークレットをソースコントロールにコミットしない
- 環境変数とシークレットマネージャーを使用
- 公開後はキーをローテーション、セッションを無効化

## 暗号化された属性

保存中のシックレット列には暗号化されたキャストを使用。

```php
protected $casts = [
    'api_token' => 'encrypted',
];
```

## セキュリティヘッダー

- 必要に応じて CSP、HSTS、フレーム保護を追加
- HTTPS リダイレクトを実施するために信頼できるプロキシ設定を使用

ヘッダーを設定するためのミドルウェア例：

```php
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class SecurityHeaders
{
    public function handle(Request $request, \Closure $next): Response
    {
        $response = $next($request);

        $response->headers->add([
            'Content-Security-Policy' => "default-src 'self'",
            'Strict-Transport-Security' => 'max-age=31536000', // add includeSubDomains/preload only when all subdomains are HTTPS
            'X-Frame-Options' => 'DENY',
            'X-Content-Type-Options' => 'nosniff',
            'Referrer-Policy' => 'no-referrer',
        ]);

        return $response;
    }
}
```

## CORS と API 公開

- `config/cors.php` でオリジンを制限
- 認証済みルートではワイルドカードオリジンを回避

```php
// config/cors.php
return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],
    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    'allowed_origins' => ['https://app.example.com'],
    'allowed_headers' => [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'X-XSRF-TOKEN',
        'X-CSRF-TOKEN',
    ],
    'supports_credentials' => true,
];
```

## ログと個人情報

- パスワード、トークン、フルカードデータをログに記録しない
- 構造化ログで機密フィールドをマスク

```php
use Illuminate\Support\Facades\Log;

Log::info('User updated profile', [
    'user_id' => $user->id,
    'email' => '[REDACTED]',
    'token' => '[REDACTED]',
]);
```

## 依存関係セキュリティ

- `composer audit` を定期的に実行
- 依存関係をケアをもって固定し、CVE で迅速にアップデート

## 署名付き URL

一時的な改ざん防止リンクに署名付きルートを使用。

```php
use Illuminate\Support\Facades\URL;

$url = URL::temporarySignedRoute(
    'downloads.invoice',
    now()->addMinutes(15),
    ['invoice' => $invoice->id]
);
```

```php
use Illuminate\Support\Facades\Route;

Route::get('/invoices/{invoice}/download', [InvoiceController::class, 'download'])
    ->name('downloads.invoice')
    ->middleware('signed');
```
