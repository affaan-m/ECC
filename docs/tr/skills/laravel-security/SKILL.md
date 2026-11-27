---
name: laravel-security
description: Laravel security best practices for authn/authz, validation, CSRF, mass assignment, file uploads, secrets, rate limiting, and secure deployment.
origin: ECC
---

# Laravel Güvenlik En İyi Uygulamaları

Laravel uygulamalarını yaygın güvenlik açıklarına karşı korumak için kapsamlı güvenlik rehberi.

## Ne Zaman Aktif Edilir

- Kimlik doğrulama veya yetkilendirme ekleme
- Kullanıcı girişi ve dosya yüklemelerini işleme
- Yeni API endpoint'leri oluşturma
- Gizli bilgileri ve ortam ayarlarını yönetme
- Production deployment'ları sertleştirme

## Nasıl Çalışır

- Middleware temel korumalar sağlar (CSRF için `VerifyCsrfToken`, güvenlik başlıkları için `SecurityHeaders`).
- Guard'lar ve policy'ler erişim kontrolünü zorlar (`auth:sanctum`, `$this->authorize`, policy middleware).
- Form Request'ler servislere ulaşmadan önce girişi doğrular ve şekillendirir (`UploadInvoiceRequest`).
- Rate limiting, auth kontrolleri ile birlikte kötüye kullanım koruması ekler (`RateLimiter::for('login')`).
- Veri güvenliği encrypted cast'lerden, mass-assignment korumalarından ve signed route'lardan gelir (`URL::temporarySignedRoute` + `signed` middleware).

## Temel Güvenlik Ayarları

- Production'da `APP_DEBUG=false`
- `APP_KEY` ayarlanmalı ve tehlikeye girdiğinde döndürülmelidir
- `SESSION_SECURE_COOKIE=true` ve `SESSION_SAME_SITE=lax` ayarlayın (veya hassas uygulamalar için `strict`)
- Doğru HTTPS algılama için güvenilir proxy'leri yapılandırın

## Session ve Cookie Sertleştirme

- JavaScript erişimini önlemek için `SESSION_HTTP_ONLY=true` ayarlayın
- Yüksek riskli akışlar için `SESSION_SAME_SITE=strict` kullanın
- Login ve ayrıcalık değişikliklerinde session'ları yeniden oluşturun

## Kimlik Doğrulama ve Token'lar

- API kimlik doğrulama için Laravel Sanctum veya Passport kullanın
- Hassas veriler için yenileme akışları ile kısa ömürlü token'ları tercih edin
- Logout ve tehlikeye girmiş hesaplarda token'ları iptal edin

Örnek route koruması:

```php
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->get('/me', function (Request $request) {
    return $request->user();
});
```

## Parola Güvenliği

- `Hash::make()` ile parolaları hash'leyin ve asla düz metin saklamayın
- Sıfırlama akışları için Laravel'in password broker'ını kullanın

```php
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;

$validated = $request->validate([
    'password' => ['required', 'string', Password::min(12)->letters()->mixedCase()->numbers()->symbols()],
]);

$user->update(['password' => Hash::make($validated['password'])]);
```

## Yetkilendirme: Policy'ler ve Gate'ler

- Model seviyesi yetkilendirme için policy'leri kullanın
- Controller'larda ve servislerde yetkilendirmeyi zorlayın

```php
$this->authorize('update', $project);
```

Route seviyesi zorlama için policy middleware kullanın:

```php
use Illuminate\Support\Facades\Route;

Route::put('/projects/{project}', [ProjectController::class, 'update'])
    ->middleware(['auth:sanctum', 'can:update,project']);
```

## Validation ve Veri Temizleme

- Her zaman Form Request'ler ile girişleri doğrulayın
- Sıkı validation kuralları ve tip kontrolleri kullanın
- Türetilmiş alanlar için request payload'larına asla güvenmeyin

## Mass Assignment Koruması

- `$fillable` veya `$guarded` kullanın ve `Model::unguard()` kullanmaktan kaçının
- DTO'ları veya açık attribute mapping'i tercih edin

## SQL Injection Önleme

- Eloquent veya query builder parametre binding kullanın
- Kesinlikle gerekli olmadıkça raw SQL kullanmaktan kaçının

```php
DB::select('select * from users where email = ?', [$email]);
```

## XSS Önleme

- Blade varsayılan olarak çıktıyı escape eder (`{{ }}`)
- `{!! !!}` sadece güvenilir, temizlenmiş HTML için kullanın
- Zengin metni özel bir kütüphane ile temizleyin

## CSRF Koruması

- `VerifyCsrfToken` middleware'ini etkin tutun
- Formlara `@csrf` ekleyin ve SPA istekleri için XSRF token'ları gönderin

Sanctum ile SPA kimlik doğrulaması için, stateful isteklerin yapılandırıldığından emin olun:

```php
// config/sanctum.php
'stateful' => explode(',', env('SANCTUM_STATEFUL_DOMAINS', 'localhost')),
```

## Dosya Yükleme Güvenliği

- Dosya boyutunu, MIME tipini ve uzantısını doğrulayın
- Mümkün olduğunda yüklemeleri public path dışında saklayın
- Gerekirse dosyaları malware için tarayın

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
    config('filesystems.private_disk', 'local') // bunu public olmayan bir disk'e ayarlayın
);
```

## Rate Limiting

- Auth ve yazma endpoint'lerinde `throttle` middleware'i uygulayın
- Login, password reset ve OTP için daha sıkı limitler kullanın

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

## Gizli Bilgiler ve Kimlik Bilgileri

- Gizli bilgileri asla kaynak kontrolüne commit etmeyin
- Ortam değişkenlerini ve gizli yöneticileri kullanın
- Maruz kalma sonrası anahtarları döndürün ve session'ları geçersiz kılın

## Şifreli Attribute'lar

Bekleyen hassas sütunlar için encrypted cast'leri kullanın.

```php
protected $casts = [
    'api_token' => 'encrypted',
];
```

## Güvenlik Başlıkları

- Uygun yerlerde CSP, HSTS ve frame koruması ekleyin
- HTTPS yönlendirmelerini zorlamak için güvenilir proxy yapılandırması kullanın

Başlıkları ayarlamak için örnek middleware:

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
            'Strict-Transport-Security' => 'max-age=31536000', // tüm subdomain'ler HTTPS olduğunda includeSubDomains/preload ekleyin
            'X-Frame-Options' => 'DENY',
            'X-Content-Type-Options' => 'nosniff',
            'Referrer-Policy' => 'no-referrer',
        ]);

        return $response;
    }
}
```

## CORS ve API Erişimi

- `config/cors.php`'de origin'leri kısıtlayın
- Kimlik doğrulamalı route'lar için wildcard origin'lerden kaçının

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

## Loglama ve PII

- Parolaları, token'ları veya tam kart verilerini asla loglamayın
- Yapılandırılmış loglarda hassas alanları redakte edin

```php
use Illuminate\Support\Facades\Log;

Log::info('User updated profile', [
    'user_id' => $user->id,
    'email' => '[REDACTED]',
    'token' => '[REDACTED]',
]);
```

## Bağımlılık Güvenliği

- Düzenli olarak `composer audit` çalıştırın
- Bağımlılıkları dikkatle sabitleyin ve CVE'lerde hızlıca güncelleyin

## Signed URL'ler

Geçici, kurcalamaya dayanıklı bağlantılar için signed route'ları kullanın.

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
