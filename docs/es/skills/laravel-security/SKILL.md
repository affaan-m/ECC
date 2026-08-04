---
name: laravel-security
description: Buenas prácticas de seguridad en Laravel para autenticación/autorización, validación, CSRF, asignación masiva, subida de archivos, secretos, limitación de velocidad y despliegue seguro.
origin: ECC
---

# Buenas Prácticas de Seguridad en Laravel

Guía completa de seguridad para aplicaciones Laravel que protege contra vulnerabilidades comunes.

## Cuándo Activar

- Agregar autenticación o autorización
- Manejar entrada de usuarios y subida de archivos
- Construir nuevos endpoints de API
- Gestionar secretos y configuración de entornos
- Reforzar despliegues en producción

## Cómo Funciona

- El middleware proporciona protecciones de base (CSRF mediante `VerifyCsrfToken`, cabeceras de seguridad mediante `SecurityHeaders`).
- Los guards y policies aplican el control de acceso (`auth:sanctum`, `$this->authorize`, middleware de policy).
- Los Form Requests validan y dan forma a la entrada (`UploadInvoiceRequest`) antes de que llegue a los servicios.
- La limitación de velocidad agrega protección contra abusos (`RateLimiter::for('login')`) junto con controles de autenticación.
- La seguridad de datos proviene de casts encriptados, guards de asignación masiva y rutas firmadas (`URL::temporarySignedRoute` + middleware `signed`).

## Configuración Principal de Seguridad

- `APP_DEBUG=false` en producción
- `APP_KEY` debe estar establecido y rotarse al comprometerse
- Establecer `SESSION_SECURE_COOKIE=true` y `SESSION_SAME_SITE=lax` (o `strict` para apps sensibles)
- Configurar proxies de confianza para la detección correcta de HTTPS

## Reforzamiento de Sesión y Cookies

- Establecer `SESSION_HTTP_ONLY=true` para prevenir acceso desde JavaScript
- Usar `SESSION_SAME_SITE=strict` para flujos de alto riesgo
- Regenerar sesiones al iniciar sesión y al cambiar privilegios

## Autenticación y Tokens

- Usar Laravel Sanctum o Passport para autenticación de API
- Preferir tokens de corta vida con flujos de actualización para datos sensibles
- Revocar tokens al cerrar sesión y en cuentas comprometidas

Ejemplo de protección de rutas:

```php
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->get('/me', function (Request $request) {
    return $request->user();
});
```

## Seguridad de Contraseñas

- Hashear contraseñas con `Hash::make()` y nunca almacenar texto plano
- Usar el password broker de Laravel para los flujos de restablecimiento

```php
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;

$validated = $request->validate([
    'password' => ['required', 'string', Password::min(12)->letters()->mixedCase()->numbers()->symbols()],
]);

$user->update(['password' => Hash::make($validated['password'])]);
```

## Autorización: Policies y Gates

- Usar policies para autorización a nivel de modelo
- Aplicar autorización en controladores y servicios

```php
$this->authorize('update', $project);
```

Usar middleware de policy para aplicación a nivel de ruta:

```php
use Illuminate\Support\Facades\Route;

Route::put('/projects/{project}', [ProjectController::class, 'update'])
    ->middleware(['auth:sanctum', 'can:update,project']);
```

## Validación y Sanitización de Datos

- Siempre validar entradas con Form Requests
- Usar reglas de validación estrictas y verificaciones de tipo
- Nunca confiar en los payloads de la request para campos derivados

## Protección contra Asignación Masiva

- Usar `$fillable` o `$guarded` y evitar `Model::unguard()`
- Preferir DTOs o mapeo explícito de atributos

## Prevención de Inyección SQL

- Usar Eloquent o el query builder con binding de parámetros
- Evitar SQL crudo a menos que sea estrictamente necesario

```php
DB::select('select * from users where email = ?', [$email]);
```

## Prevención de XSS

- Blade escapa la salida por defecto (`{{ }}`)
- Usar `{!! !!}` solo para HTML de confianza y sanitizado
- Sanitizar texto enriquecido con una librería dedicada

## Protección CSRF

- Mantener el middleware `VerifyCsrfToken` habilitado
- Incluir `@csrf` en formularios y enviar tokens XSRF en requests de SPA

Para autenticación SPA con Sanctum, asegurarse de que las requests stateful estén configuradas:

```php
// config/sanctum.php
'stateful' => explode(',', env('SANCTUM_STATEFUL_DOMAINS', 'localhost')),
```

## Seguridad en Subida de Archivos

- Validar tamaño de archivo, tipo MIME y extensión
- Almacenar subidas fuera del directorio público cuando sea posible
- Escanear archivos en busca de malware si es necesario

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
    config('filesystems.private_disk', 'local') // establecer a un disco no público
);
```

## Limitación de Velocidad

- Aplicar middleware `throttle` en endpoints de autenticación y escritura
- Usar límites más estrictos para login, restablecimiento de contraseña y OTP

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

## Secretos y Credenciales

- Nunca hacer commit de secretos al control de versiones
- Usar variables de entorno y gestores de secretos
- Rotar claves después de una exposición e invalidar sesiones

## Atributos Encriptados

Usar casts encriptados para columnas sensibles en reposo.

```php
protected $casts = [
    'api_token' => 'encrypted',
];
```

## Cabeceras de Seguridad

- Agregar CSP, HSTS y protección de frames donde sea apropiado
- Usar configuración de proxies de confianza para forzar redirecciones HTTPS

Ejemplo de middleware para establecer cabeceras:

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
            'Strict-Transport-Security' => 'max-age=31536000', // agregar includeSubDomains/preload solo cuando todos los subdominios sean HTTPS
            'X-Frame-Options' => 'DENY',
            'X-Content-Type-Options' => 'nosniff',
            'Referrer-Policy' => 'no-referrer',
        ]);

        return $response;
    }
}
```

## CORS y Exposición de API

- Restringir orígenes en `config/cors.php`
- Evitar orígenes wildcard para rutas autenticadas

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

## Logging y PII

- Nunca registrar contraseñas, tokens o datos completos de tarjetas
- Redactar campos sensibles en logs estructurados

```php
use Illuminate\Support\Facades\Log;

Log::info('User updated profile', [
    'user_id' => $user->id,
    'email' => '[REDACTED]',
    'token' => '[REDACTED]',
]);
```

## Seguridad de Dependencias

- Ejecutar `composer audit` regularmente
- Fijar dependencias con cuidado y actualizar rápidamente ante CVEs

## URLs Firmadas

Usar rutas firmadas para enlaces temporales a prueba de manipulaciones.

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
