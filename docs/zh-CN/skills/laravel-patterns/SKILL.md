---
name: laravel-patterns
description: Laravel架构模式、路由/控制器、Eloquent ORM、服务层、队列、事件、缓存以及用于生产应用的API资源。
origin: ECC
---

# Laravel 开发模式

适用于可扩展、可维护应用的生产级 Laravel 架构模式。

## 适用场景

* 构建 Laravel Web 应用或 API
* 构建控制器、服务和领域逻辑
* 使用 Eloquent 模型和关系
* 使用资源和分页设计 API
* 添加队列、事件、缓存和后台任务

## 工作原理

* 围绕清晰的边界（控制器 -> 服务/操作 -> 模型）构建应用。
* 使用显式绑定和作用域绑定来保持路由可预测；同时仍强制执行授权以实现访问控制。
* 倾向于使用类型化模型、转换器和作用域来保持领域逻辑一致。
* 将 IO 密集型工作放在队列中，并缓存昂贵的读取操作。
* 将配置集中在 `config/*` 中，并保持环境配置显式化。

## 示例

### 项目结构

使用具有清晰层级边界（HTTP、服务/操作、模型）的常规 Laravel 布局。

### 推荐布局

```
app/
├── Actions/            # 单一用途的用例
├── Console/
├── Events/
├── Exceptions/
├── Http/
│   ├── Controllers/
│   ├── Middleware/
│   ├── Requests/       # 表单请求验证
│   └── Resources/      # API 资源
├── Jobs/
├── Models/
├── Policies/
├── Providers/
├── Services/           # 协调领域服务
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

### 控制器 -> 服务 -> 操作

保持控制器精简。将编排逻辑放在服务中，将单一职责逻辑放在操作中。

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

### 路由与控制器

为了清晰起见，优先使用路由模型绑定和资源控制器。

```php
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->group(function () {
    Route::apiResource('projects', ProjectController::class);
});
```

### 路由模型绑定（作用域）

使用作用域绑定来防止跨租户访问。

```php
Route::scopeBindings()->group(function () {
    Route::get('/accounts/{account}/projects/{project}', [ProjectController::class, 'show']);
});
```

### 嵌套路由和绑定名称

* 保持前缀和路径一致，避免双重嵌套（例如 `conversation` 与 `conversations`）。
* 使用与绑定模型匹配的单一参数名（例如，`{conversation}` 对应 `Conversation`）。
* 嵌套时优先使用作用域绑定以强制执行父子关系。

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

如果希望参数解析为不同的模型类，请定义显式绑定。对于自定义绑定逻辑，请使用 `Route::bind()` 或在模型上实现 `resolveRouteBinding()`。

```php
use App\Models\AiConversation;
use Illuminate\Support\Facades\Route;

Route::model('conversation', AiConversation::class);
```

### 服务容器绑定

在服务提供者中将接口绑定到实现，以实现清晰的依赖关系连接。

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

### Eloquent 模型模式

### 模型配置

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

### 自定义转换器与值对象

使用枚举或值对象进行严格类型化。

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

### 预加载以避免 N+1 问题

```php
$orders = Order::query()
    ->with(['customer', 'items.product'])
    ->latest()
    ->paginate(25);
```

### 用于复杂筛选的查询对象

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

### 全局作用域与软删除

使用全局作用域进行默认筛选，并使用 `SoftDeletes` 处理可恢复的记录。
对于同一筛选器，请使用全局作用域或命名作用域中的一种，除非你打算实现分层行为。

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

### 用于可重用筛选器的查询作用域

```php
use Illuminate\Database\Eloquent\Builder;

final class Project extends Model
{
    public function scopeOwnedBy(Builder $query, int $userId): Builder
    {
        return $query->where('owner_id', $userId);
    }
}

// In service, repository etc.
$projects = Project::ownedBy($user->id)->get();
```

### 用于多步更新的数据库事务

```php
use Illuminate\Support\Facades\DB;

DB::transaction(function (): void {
    $order->update(['status' => 'paid']);
    $order->items()->update(['paid_at' => now()]);
});
```

### 数据库迁移

### 命名约定

* 文件名使用时间戳：`YYYY_MM_DD_HHMMSS_create_users_table.php`
* 迁移使用匿名类（无命名类）；文件名传达意图
* 表名默认为 `snake_case` 且为复数形式

### 迁移示例

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

### 表单请求与验证

将验证逻辑放在表单请求中，并将输入转换为 DTO。

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

### API 资源

使用资源和分页保持 API 响应一致。

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

### 事件、任务和队列

* 为副作用（邮件、分析）触发领域事件
* 使用队列任务处理耗时工作（报告、导出、Webhook）
* 优先使用具有重试和退避机制的幂等处理器

### 缓存

* 缓存读密集型端点和昂贵查询
* 在模型事件（创建/更新/删除）时使缓存失效
* 缓存相关数据时使用标签以便于失效

### 配置与环境

* 将机密信息保存在 `.env` 中，将配置保存在 `config/*.php` 中
* 使用按环境配置覆盖，并在生产环境中使用 `config:cache`
