---
name: laravel-tdd
description: Desarrollo guiado por pruebas para Laravel con PHPUnit y Pest, factories, pruebas de base de datos, fakes y objetivos de cobertura.
origin: ECC
---

# Flujo de Trabajo TDD en Laravel

Desarrollo guiado por pruebas para aplicaciones Laravel usando PHPUnit y Pest con 80%+ de cobertura (unit + feature).

## Cuándo Usar

- Nuevas funcionalidades o endpoints en Laravel
- Correcciones de bugs o refactorizaciones
- Probar modelos Eloquent, policies, jobs y notifications
- Preferir Pest para pruebas nuevas a menos que el proyecto ya esté estandarizado en PHPUnit

## Cómo Funciona

### Ciclo Rojo-Verde-Refactorizar

1) Escribir una prueba fallida
2) Implementar el cambio mínimo para que pase
3) Refactorizar manteniendo las pruebas en verde

### Capas de Prueba

- **Unit**: clases PHP puras, objetos de valor, servicios
- **Feature**: endpoints HTTP, autenticación, validación, policies
- **Integration**: base de datos + colas + límites externos

Elegir capas según el alcance:

- Usar pruebas **Unit** para lógica de negocio pura y servicios.
- Usar pruebas **Feature** para HTTP, autenticación, validación y forma de respuesta.
- Usar pruebas **Integration** cuando se validen BD/colas/servicios externos juntos.

### Estrategia de Base de Datos

- `RefreshDatabase` para la mayoría de pruebas feature/integration (ejecuta migraciones una vez por ejecución de prueba, luego envuelve cada prueba en una transacción cuando está soportado; las bases de datos en memoria pueden re-migrar por prueba)
- `DatabaseTransactions` cuando el esquema ya está migrado y solo se necesita rollback por prueba
- `DatabaseMigrations` cuando se necesita un migrate/fresh completo para cada prueba y se puede asumir el costo

Usar `RefreshDatabase` como predeterminado para pruebas que tocan la base de datos: para bases de datos con soporte de transacciones, ejecuta las migraciones una vez por ejecución de prueba (mediante un flag estático) y envuelve cada prueba en una transacción; para SQLite `:memory:` o conexiones sin transacciones, migra antes de cada prueba. Usar `DatabaseTransactions` cuando el esquema ya está migrado y solo se necesitan rollbacks por prueba.

### Elección del Framework de Pruebas

- Usar **Pest** por defecto para pruebas nuevas cuando esté disponible.
- Usar **PHPUnit** solo si el proyecto ya lo estandariza o requiere herramientas específicas de PHPUnit.

## Ejemplos

### Ejemplo con PHPUnit

```php
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class ProjectControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_owner_can_create_project(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/api/projects', [
            'name' => 'New Project',
        ]);

        $response->assertCreated();
        $this->assertDatabaseHas('projects', ['name' => 'New Project']);
    }
}
```

### Ejemplo de Prueba Feature (Capa HTTP)

```php
use App\Models\Project;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class ProjectIndexTest extends TestCase
{
    use RefreshDatabase;

    public function test_projects_index_returns_paginated_results(): void
    {
        $user = User::factory()->create();
        Project::factory()->count(3)->for($user)->create();

        $response = $this->actingAs($user)->getJson('/api/projects');

        $response->assertOk();
        $response->assertJsonStructure(['success', 'data', 'error', 'meta']);
    }
}
```

### Ejemplo con Pest

```php
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

use function Pest\Laravel\actingAs;
use function Pest\Laravel\assertDatabaseHas;

uses(RefreshDatabase::class);

test('owner can create project', function () {
    $user = User::factory()->create();

    $response = actingAs($user)->postJson('/api/projects', [
        'name' => 'New Project',
    ]);

    $response->assertCreated();
    assertDatabaseHas('projects', ['name' => 'New Project']);
});
```

### Ejemplo de Prueba Feature con Pest (Capa HTTP)

```php
use App\Models\Project;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

use function Pest\Laravel\actingAs;

uses(RefreshDatabase::class);

test('projects index returns paginated results', function () {
    $user = User::factory()->create();
    Project::factory()->count(3)->for($user)->create();

    $response = actingAs($user)->getJson('/api/projects');

    $response->assertOk();
    $response->assertJsonStructure(['success', 'data', 'error', 'meta']);
});
```

### Factories y Estados

- Usar factories para datos de prueba
- Definir estados para casos límite (archivado, admin, trial)

```php
$user = User::factory()->state(['role' => 'admin'])->create();
```

### Pruebas de Base de Datos

- Usar `RefreshDatabase` para estado limpio
- Mantener las pruebas aisladas y deterministas
- Preferir `assertDatabaseHas` sobre consultas manuales

### Ejemplo de Prueba de Persistencia

```php
use App\Models\Project;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class ProjectRepositoryTest extends TestCase
{
    use RefreshDatabase;

    public function test_project_can_be_retrieved_by_slug(): void
    {
        $project = Project::factory()->create(['slug' => 'alpha']);

        $found = Project::query()->where('slug', 'alpha')->firstOrFail();

        $this->assertSame($project->id, $found->id);
    }
}
```

### Fakes para Efectos Secundarios

- `Bus::fake()` para jobs
- `Queue::fake()` para trabajo en cola
- `Mail::fake()` y `Notification::fake()` para notificaciones
- `Event::fake()` para eventos de dominio

```php
use Illuminate\Support\Facades\Queue;

Queue::fake();

dispatch(new SendOrderConfirmation($order->id));

Queue::assertPushed(SendOrderConfirmation::class);
```

```php
use Illuminate\Support\Facades\Notification;

Notification::fake();

$user->notify(new InvoiceReady($invoice));

Notification::assertSentTo($user, InvoiceReady::class);
```

### Pruebas de Autenticación (Sanctum)

```php
use Laravel\Sanctum\Sanctum;

Sanctum::actingAs($user);

$response = $this->getJson('/api/projects');
$response->assertOk();
```

### HTTP y Servicios Externos

- Usar `Http::fake()` para aislar APIs externas
- Verificar payloads salientes con `Http::assertSent()`

### Objetivos de Cobertura

- Aplicar 80%+ de cobertura para pruebas unit + feature
- Usar `pcov` o `XDEBUG_MODE=coverage` en CI

### Comandos de Prueba

- `php artisan test`
- `vendor/bin/phpunit`
- `vendor/bin/pest`

### Configuración de Pruebas

- Usar `phpunit.xml` para establecer `DB_CONNECTION=sqlite` y `DB_DATABASE=:memory:` para pruebas rápidas
- Mantener un entorno separado para pruebas para evitar tocar datos de desarrollo/producción

### Pruebas de Autorización

```php
use Illuminate\Support\Facades\Gate;

$this->assertTrue(Gate::forUser($user)->allows('update', $project));
$this->assertFalse(Gate::forUser($otherUser)->allows('update', $project));
```

### Pruebas Feature con Inertia

Al usar Inertia.js, verificar el nombre del componente y las props con los helpers de testing de Inertia.

```php
use App\Models\User;
use Inertia\Testing\AssertableInertia;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class DashboardInertiaTest extends TestCase
{
    use RefreshDatabase;

    public function test_dashboard_inertia_props(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->get('/dashboard');

        $response->assertOk();
        $response->assertInertia(fn (AssertableInertia $page) => $page
            ->component('Dashboard')
            ->where('user.id', $user->id)
            ->has('projects')
        );
    }
}
```

Preferir `assertInertia` sobre aserciones JSON crudas para mantener las pruebas alineadas con las respuestas de Inertia.
