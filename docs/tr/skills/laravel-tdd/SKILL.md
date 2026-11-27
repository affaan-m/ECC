---
name: laravel-tdd
description: Test-driven development for Laravel with PHPUnit and Pest, factories, database testing, fakes, and coverage targets.
origin: ECC
---

# Laravel TDD İş Akışı

80%+ kapsam (unit + feature) ile Laravel uygulamaları için test-driven development.

## Ne Zaman Kullanılır

- Laravel'de yeni özellikler veya endpoint'ler
- Bug düzeltmeleri veya refactoring'ler
- Eloquent model'leri, policy'leri, job'ları ve notification'ları test etme
- Proje zaten PHPUnit'te standartlaşmamışsa yeni testler için Pest'i tercih edin

## Nasıl Çalışır

### Red-Green-Refactor Döngüsü

1) Başarısız bir test yazın
2) Geçmek için minimal değişiklik uygulayın
3) Testleri yeşil tutarken refactor edin

### Test Katmanları

- **Unit**: saf PHP sınıfları, value object'leri, servisler
- **Feature**: HTTP endpoint'leri, auth, validation, policy'ler
- **Integration**: database + kuyruk + harici sınırlar

Kapsama göre katmanları seçin:

- Saf iş mantığı ve servisler için **Unit** testleri kullanın.
- HTTP, auth, validation ve yanıt şekli için **Feature** testleri kullanın.
- DB/kuyruklar/harici servisleri birlikte doğrularken **Integration** testleri kullanın.

### Database Stratejisi

- Çoğu feature/integration testi için `RefreshDatabase` (test run'ı başına bir kez migration'ları çalıştırır, ardından desteklendiğinde her testi bir transaction'a sarar; in-memory veritabanları test başına yeniden migrate edebilir)
- Şema zaten migrate edilmişse ve sadece test başına rollback'e ihtiyacınız varsa `DatabaseTransactions`
- Her test için tam bir migrate/fresh'e ihtiyacınız varsa ve maliyetini karşılayabiliyorsanız `DatabaseMigrations`

Veritabanına dokunan testler için varsayılan olarak `RefreshDatabase` kullanın: transaction desteği olan veritabanları için, test run'ı başına bir kez (static bir bayrak aracılığıyla) migration'ları çalıştırır ve her testi bir transaction'a sarar; `:memory:` SQLite veya transaction'sız bağlantılar için her testten önce migrate eder. Şema zaten migrate edilmişse ve sadece test başına rollback'lere ihtiyacınız varsa `DatabaseTransactions` kullanın.

### Test Framework Seçimi

- Mevcut olduğunda yeni testler için varsayılan olarak **Pest** kullanın.
- Proje zaten PHPUnit'te standartlaşmışsa veya PHPUnit'e özgü araçlar gerektiriyorsa sadece **PHPUnit** kullanın.

## Örnekler

### PHPUnit Örneği

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

### Feature Test Örneği (HTTP Katmanı)

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

### Pest Örneği

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

### Feature Test Pest Örneği (HTTP Katmanı)

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

### Factory'ler ve State'ler

- Test verileri için factory'leri kullanın
- Uç durumlar için state'leri tanımlayın (archived, admin, trial)

```php
$user = User::factory()->state(['role' => 'admin'])->create();
```

### Database Testi

- Temiz durum için `RefreshDatabase` kullanın
- Testleri izole ve deterministik tutun
- Manuel sorgular yerine `assertDatabaseHas` tercih edin

### Persistence Test Örneği

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

### Yan Etkiler için Fake'ler

- Job'lar için `Bus::fake()`
- Kuyruğa alınmış işler için `Queue::fake()`
- Bildirimler için `Mail::fake()` ve `Notification::fake()`
- Domain event'leri için `Event::fake()`

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

### Auth Testi (Sanctum)

```php
use Laravel\Sanctum\Sanctum;

Sanctum::actingAs($user);

$response = $this->getJson('/api/projects');
$response->assertOk();
```

### HTTP ve Harici Servisler

- Harici API'leri izole etmek için `Http::fake()` kullanın
- Giden payload'ları `Http::assertSent()` ile doğrulayın

### Kapsam Hedefleri

- Unit + feature testleri için 80%+ kapsam zorlayın
- CI'da `pcov` veya `XDEBUG_MODE=coverage` kullanın

### Test Komutları

- `php artisan test`
- `vendor/bin/phpunit`
- `vendor/bin/pest`

### Test Yapılandırması

- Hızlı testler için `phpunit.xml`'de `DB_CONNECTION=sqlite` ve `DB_DATABASE=:memory:` ayarlayın
- Dev/prod verilerine dokunmaktan kaçınmak için testler için ayrı env tutun

### Yetkilendirme Testleri

```php
use Illuminate\Support\Facades\Gate;

$this->assertTrue(Gate::forUser($user)->allows('update', $project));
$this->assertFalse(Gate::forUser($otherUser)->allows('update', $project));
```

### Inertia Feature Testleri

Inertia.js kullanırken, Inertia test yardımcıları ile component ismi ve prop'ları doğrulayın.

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

Testleri Inertia yanıtlarıyla uyumlu tutmak için ham JSON assertion'ları yerine `assertInertia` tercih edin.
