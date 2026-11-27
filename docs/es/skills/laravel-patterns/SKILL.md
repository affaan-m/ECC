---
name: laravel-patterns
description: Patrones de arquitectura Laravel, routing/controladores, Eloquent ORM, capas de servicio, colas, eventos, caché y API resources para aplicaciones en producción.
origin: ECC
---

# Patrones de Desarrollo Laravel

Patrones de arquitectura Laravel de nivel producción para aplicaciones escalables y mantenibles.

## Cuándo Usar

- Construir aplicaciones web o APIs con Laravel
- Estructurar controladores, servicios y lógica de dominio
- Trabajar con modelos Eloquent y relaciones
- Diseñar APIs con resources y paginación
- Agregar colas, eventos, caché y jobs en segundo plano

## Cómo Funciona

- Estructurar la app con límites claros (controladores -> servicios/actions -> modelos).
- Usar bindings explícitos y bindings con scope para mantener el routing predecible; aplicar autorización para el control de acceso.
- Favorecer modelos tipados, casts y scopes para mantener la lógica de dominio consistente.
- Mantener el trabajo intensivo de IO en colas y cachear lecturas costosas.
- Centralizar la configuración en `config/*` y mantener los entornos explícitos.

## Ejemplos

### Estructura del Proyecto

Usar un layout convencional de Laravel con límites de capa claros (HTTP, servicios/actions, modelos).

### Layout Recomendado

```
app/
├── Actions/            # Casos de uso de un solo propósito
├── Console/
├── Events/
├── Exceptions/
├── Http/
│   ├── Controllers/
│   ├── Middleware/
│   ├── Requests/       # Validación con Form Requests
│   └── Resources/      # API resources
├── Jobs/
├── Models/
├── Policies/
├── Providers/
├── Services/           # Servicios de dominio coordinadores
└── Support/
config/
database/
├── factories/
├── migrations/
└── seeders/
resources/
├── views/
└── lang/
routes/
├── api.php
├── web.php
└── console.php
```

### Controladores -> Servicios -> Actions

Mantener los controladores delgados. Poner la orquestación en servicios y la lógica de un solo propósito en actions.

```php
final class CreateOrderAction
{
    public function __construct(private OrderRepository $orders) {}

    public function handle(CreateOrderData $data): Order
    {
        return $this->orders->create($data);
    }
}

final class OrdersController extends Controller
{
    public function __construct(private CreateOrderAction $createOrder) {}

    public function store(StoreOrderRequest $request): JsonResponse
    {
        $order = $this->createOrder->handle($request->toDto());

        return response()->json([
            'success' => true,
            'data' => OrderResource::make($order),
            'error' => null,
            'meta' => null,
        ], 201);
    }
}
```

### Routing y Controladores

Preferir route-model binding y controladores de recursos para mayor claridad.

```php
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->group(function () {
    Route::apiResource('projects', ProjectController::class);
});
```

### Route Model Binding con Scope

Usar bindings con scope para prevenir acceso entre tenants.

```php
Route::scopeBindings()->group(function () {
    Route::get('/accounts/{account}/projects/{project}', [ProjectController::class, 'show']);
});
```

### Rutas Anidadas y Nombres de Binding

- Mantener prefijos y rutas consistentes para evitar doble anidamiento (ej. `conversation` vs `conversations`).
- Usar un único nombre de parámetro que coincida con el modelo vinculado (ej. `{conversation}` para `Conversation`).
- Preferir bindings con scope al anidar para aplicar relaciones padre-hijo.

```php
use App\Http\Controllers\Api\ConversationController;
use App\Http\Controllers\Api\MessageController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->prefix('conversations')->group(function () {
    Route::post('/', [ConversationController::class, 'store'])->name('conversations.store');

    Route::scopeBindings()->group(function () {
        Route::get('/{conversation}', [ConversationController::class, 'show'])
            ->name('conversations.show');

        Route::post('/{conversation}/messages', [MessageController::class, 'store'])
            ->name('conversation-messages.store');

        Route::get('/{conversation}/messages/{message}', [MessageController::class, 'show'])
            ->name('conversation-messages.show');
    });
});
```

Si deseas que un parámetro resuelva a una clase de modelo diferente, definir un binding explícito. Para lógica de binding personalizada, usar `Route::bind()` o implementar `resolveRouteBinding()` en el modelo.

```php
use App\Models\AiConversation;
use Illuminate\Support\Facades\Route;

Route::model('conversation', AiConversation::class);
```

### Bindings del Contenedor de Servicios

Vincular interfaces a implementaciones en un service provider para una inyección de dependencias clara.

```php
use App\Repositories\EloquentOrderRepository;
use App\Repositories\OrderRepository;
use Illuminate\Support\ServiceProvider;

final class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(OrderRepository::class, EloquentOrderRepository::class);
    }
}
```

### Patrones de Modelos Eloquent

### Configuración del Modelo

```php
final class Project extends Model
{
    use HasFactory;

    protected $fillable = ['name', 'owner_id', 'status'];

    protected $casts = [
        'status' => ProjectStatus::class,
        'archived_at' => 'datetime',
    ];

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->whereNull('archived_at');
    }
}
```

### Casts Personalizados y Objetos de Valor

Usar enums u objetos de valor para tipado estricto.

```php
use Illuminate\Database\Eloquent\Casts\Attribute;

protected $casts = [
    'status' => ProjectStatus::class,
];
```

```php
protected function budgetCents(): Attribute
{
    return Attribute::make(
        get: fn (int $value) => Money::fromCents($value),
        set: fn (Money $money) => $money->toCents(),
    );
}
```

### Eager Loading para Evitar N+1

```php
$orders = Order::query()
    ->with(['customer', 'items.product'])
    ->latest()
    ->paginate(25);
```

### Query Objects para Filtros Complejos

```php
final class ProjectQuery
{
    public function __construct(private Builder $query) {}

    public function ownedBy(int $userId): self
    {
        $query = clone $this->query;

        return new self($query->where('owner_id', $userId));
    }

    public function active(): self
    {
        $query = clone $this->query;

        return new self($query->whereNull('archived_at'));
    }

    public function builder(): Builder
    {
        return $this->query;
    }
}
```

### Global Scopes y Soft Deletes

Usar global scopes para filtrado por defecto y `SoftDeletes` para registros recuperables.
Usar ya sea un global scope o un named scope para el mismo filtro, no ambos, a menos que se desee comportamiento en capas.

```php
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Builder;

final class Project extends Model
{
    use SoftDeletes;

    protected static function booted(): void
    {
        static::addGlobalScope('active', function (Builder $builder): void {
            $builder->whereNull('archived_at');
        });
    }
}
```

### Query Scopes para Filtros Reutilizables

```php
use Illuminate\Database\Eloquent\Builder;

final class Project extends Model
{
    public function scopeOwnedBy(Builder $query, int $userId): Builder
    {
        return $query->where('owner_id', $userId);
    }
}

// En servicio, repositorio, etc.
$projects = Project::ownedBy($user->id)->get();
```

### Transacciones para Actualizaciones Multi-Paso

```php
use Illuminate\Support\Facades\DB;

DB::transaction(function (): void {
    $order->update(['status' => 'paid']);
    $order->items()->update(['paid_at' => now()]);
});
```

### Migraciones

### Convención de Nomenclatura

- Los nombres de archivo usan timestamps: `YYYY_MM_DD_HHMMSS_create_users_table.php`
- Las migraciones usan clases anónimas (sin clase con nombre); el nombre del archivo comunica la intención
- Los nombres de tablas son `snake_case` y plurales por defecto

### Ejemplo de Migración

```php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('orders', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('customer_id')->constrained()->cascadeOnDelete();
            $table->string('status', 32)->index();
            $table->unsignedInteger('total_cents');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('orders');
    }
};
```

### Form Requests y Validación

Mantener la validación en Form Requests y transformar las entradas a DTOs.

```php
use App\Models\Order;

final class StoreOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('create', Order::class) ?? false;
    }

    public function rules(): array
    {
        return [
            'customer_id' => ['required', 'integer', 'exists:customers,id'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.sku' => ['required', 'string'],
            'items.*.quantity' => ['required', 'integer', 'min:1'],
        ];
    }

    public function toDto(): CreateOrderData
    {
        return new CreateOrderData(
            customerId: (int) $this->validated('customer_id'),
            items: $this->validated('items'),
        );
    }
}
```

### API Resources

Mantener respuestas de API consistentes con resources y paginación.

```php
$projects = Project::query()->active()->paginate(25);

return response()->json([
    'success' => true,
    'data' => ProjectResource::collection($projects->items()),
    'error' => null,
    'meta' => [
        'page' => $projects->currentPage(),
        'per_page' => $projects->perPage(),
        'total' => $projects->total(),
    ],
]);
```

### Eventos, Jobs y Colas

- Emitir eventos de dominio para efectos secundarios (emails, analíticas)
- Usar jobs en cola para trabajo lento (reportes, exportaciones, webhooks)
- Preferir handlers idempotentes con reintentos y backoff

### Caché

- Cachear endpoints y consultas costosas con muchas lecturas
- Invalidar cachés en eventos del modelo (created/updated/deleted)
- Usar tags al cachear datos relacionados para facilitar la invalidación

### Configuración y Entornos

- Mantener secretos en `.env` y configuración en `config/*.php`
- Usar sobreescrituras de configuración por entorno y `config:cache` en producción
