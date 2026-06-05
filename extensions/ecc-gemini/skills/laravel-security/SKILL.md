---
name: laravel-security
description: Laravel security best practices for authn/authz, validation, CSRF, mass assignment, file uploads, secrets, rate limiting, and secure deployment.
origin: ECC
---

# Laravel Security Best Practices

Comprehensive security guidance for Laravel applications to protect against common vulnerabilities.

## When to Activate

- Adding authentication or authorization
- Handling user input and file uploads
- Building new API endpoints
- Managing secrets and environment settings
- Hardening production deployments

## How It Works

- Middleware provides baseline protections (CSRF via `VerifyCsrfToken`, security headers via `SecurityHeaders`).
- Guards and policies enforce access control (`auth:sanctum`, `$this->authorize`, policy middleware).
- Form Requests validate and shape input (`UploadInvoiceRequest`) before it reaches services.
- Rate limiting adds abuse protection (`RateLimiter::for('login')`) alongside auth controls.
- Data safety comes from encrypted casts, mass-assignment guards, and signed routes (`URL::temporarySignedRoute` + `signed` middleware).

## Core Security Settings

- `APP_DEBUG=false` in production
- `APP_KEY` must be set and rotated on compromise
- Set `SESSION_SECURE_COOKIE=true` and `SESSION_SAME_SITE=lax` (or `strict` for sensitive apps)
- Configure trusted proxies for correct HTTPS detection

## Session and Cookie Hardening

- Set `SESSION_HTTP_ONLY=true` to prevent JavaScript access
- Use `SESSION_SAME_SITE=strict` for high-risk flows
- Regenerate sessions on login and privilege changes

## Authentication and Tokens

- Use Laravel Sanctum or Passport for API auth
- Prefer short-lived tokens with refresh flows for sensitive data
- Revoke tokens on logout and compromised accounts

Example route protection:

```php
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->get('/me', function (Request $request) {
    return $request->user();
});
```

## Password Security

- Hash passwords with `Hash::make()` and never store plaintext
- Use Laravel's password broker for reset flows

```php
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;

$validated = $request->validate([
    'password' => ['required', 'string', Password::min(12)->letters()->mixedCase()->numbers()->symbols()],
]);

$user->update(['password' => Hash::make($validated['password'])]);
```

## Authorization: Policies and Gates

- Use policies for model-level authorization
- Enforce authorization in controllers and services

```php
$this->authorize('update', $project);
```

Use policy middleware for route-level enforcement:

```php
use Illuminate\Support\Facades\Route;

Route::put('/projects/{project}', [ProjectController::class, 'update'])
    ->middleware(['auth:sanctum', 'can:update,project']);
```

## Validation and Data Sanitization

- Always validate inputs with Form Requests
- Use strict validation rules and type checks
- Never trust request payloads for derived fields

## Mass Assignment Protection

- Use `$fillable` or `$guarded` and avoid `Model::unguard()`
- Prefer DTOs or explicit attribute mapping

## SQL Injection Prevention

- Use Eloquent or query builder parameter binding
- Avoid raw SQL unless strictly necessary

```php
DB::select('select * from users where email = ?', [$email]);
```

## XSS Prevention

- Blade escapes output by default (`{{ }}`)
- Use `{!! !!}` only for trusted, sanitized HTML
- Sanitize rich text with a dedicated library

## CSRF Protection

- Keep `VerifyCsrfToken` middleware enabled
- Include `@csrf` in forms and send XSRF tokens for SPA requests

For SPA authentication with Sanctum, ensure stateful requests are configured:

```php
// config/sanctum.php
'stateful' => explode(',', env('SANCTUM_STATEFUL_DOMAINS', 'localhost')),
```

## File Upload Safety

- Validate file size, MIME type, and extension
- Store uploads outside the public path when possible
- Scan files for malware if required

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

## Rate Limiting

- Apply `throttle` middleware on auth and write endpoints
- Use stricter limits for login, password reset, and OTP

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

## Secrets and Credentials

- Never commit secrets to source control
- Use environment variables and secret managers
- Rotate keys after exposure and invalidate sessions

## Encrypted Attributes

Use encrypted casts for sensitive columns at rest.

```php
protected $casts = [
    'api_token' => 'encrypted',
];
```

## Security Headers

- Add CSP, HSTS, and frame protection where appropriate
- Use trusted proxy configuration to enforce HTTPS redirects

Example middleware to set headers:

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

## CORS and API Exposure

- Restrict origins in `config/cors.php`
- Avoid wildcard origins for authenticated routes

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

## Logging and PII

- Never log passwords, tokens, or full card data
- Redact sensitive fields in structured logs

```php
use Illuminate\Support\Facades\Log;

Log::info('User updated profile', [
    'user_id' => $user->id,
    'email' => '[REDACTED]',
    'token' => '[REDACTED]',
]);
```

## Dependency Security

- Run `composer audit` regularly
- Pin dependencies with care and update promptly on CVEs

## Signed URLs

Use signed routes for temporary, tamper-proof links.

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
