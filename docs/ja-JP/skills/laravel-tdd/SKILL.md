---
name: laravel-tdd
description: Laravel での TDD：PHPUnit と Pest、ファクトリー、データベーステスト、フェイク、カバレッジターゲット
origin: ECC
---

# Laravel TDD ワークフロー

PHPUnit と Pest を使用した Laravel アプリケーション用のテスト駆動開発。80%+ カバレッジ（ユニット + フィーチャー）。

## 使用時機

- Laravel の新機能またはエンドポイント
- バグ修正またはリファクタリング
- Eloquent モデル、ポリシー、ジョブ、通知のテスト
- プロジェクトが PHPUnit を標準化していない限り、新しいテストには Pest を優先

## 仕組み

### RED-GREEN-REFACTOR サイクル

1) テスト失敗を書く
2) 最小限の変更を実装して合格させる
3) テストを緑に保ちながらリファクタリング

### テスト層

- **ユニット**：純粋な PHP クラス、値オブジェクト、サービス
- **フィーチャー**：HTTP エンドポイント、認証、バリデーション、ポリシー
- **統合**：データベース + キュー + 外部バウンダリー

スコープに基づいて層を選択：

- **ユニット**テストを純粋なビジネスロジックとサービスに使用。
- **フィーチャー**テストを HTTP、認証、バリデーション、レスポンス形状に使用。
- **統合**テストを DB/キュー/外部サービスを一緒に検証するときに使用。

### データベース戦略

- `RefreshDatabase` ほとんどのフィーチャー/統合テスト用（テスト実行ごとにマイグレーションを 1 回実行し、次に各テストをトランザクション内でラップ；メモリ内データベースは各テストごとに再マイグレーションする可能性がある）
- `DatabaseTransactions` スキーマがすでにマイグレーションされており、テストごとのロールバックのみが必要なとき
- `DatabaseMigrations` すべてのテストで完全な migrate/fresh が必要なとき、またはコストを負担できるとき

`RefreshDatabase` をデータベースに触れるテストのデフォルトとして使用：トランザクション サポート付きデータベースの場合、マイグレーション ステップ フラグを使用して テスト実行ごとに 1 回実行し、次に各テストをトランザクション内でラップします；`:memory:` SQLite または非トランザクションの接続では、各テストの前にマイグレーションします。スキーマがすでにマイグレーションされており、テストごとのロールバックのみが必要なときは `DatabaseTransactions` を使用します。

### テストフレームワーク選択

- **新しいテストの場合は Pest をデフォルト**で使用。
- **PHPUnit** はプロジェクトがすでにそれを標準化している、またはPHPUnit 固有のツールが必要なときのみ使用。

## 例

### PHPUnit 例

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

### フィーチャーテスト例（HTTP レイヤー）

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

### Pest 例

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

### フィーチャーテスト Pest 例（HTTP レイヤー）

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

### ファクトリーと状態

- テストデータにはファクトリーを使用
- エッジケース（アーカイブ済み、管理者、トライアル）の状態を定義

```php
$user = User::factory()->state(['role' => 'admin'])->create();
```

### データベーステスト

- クリーンな状態には `RefreshDatabase` を使用
- テストを隔離して決定論的に保つ
- 手動クエリより `assertDatabaseHas` を優先

### 永続性テスト例

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

### 副作用のためのフェイク

- `Bus::fake()` ジョブ用
- `Queue::fake()` キュー作業用
- `Mail::fake()` と `Notification::fake()` 通知用
- `Event::fake()` ドメインイベント用

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

### 認証テスト（Sanctum）

```php
use Laravel\Sanctum\Sanctum;

Sanctum::actingAs($user);

$response = $this->getJson('/api/projects');
$response->assertOk();
```

### HTTP と外部サービス

- `Http::fake()` を使用して外部 API を隔離
- `Http::assertSent()` で送信ペイロードをアサート

### カバレッジターゲット

- ユニット + フィーチャーテストで 80%+ カバレッジを実施
- CI では `pcov` または `XDEBUG_MODE=coverage` を使用

### テストコマンド

- `php artisan test`
- `vendor/bin/phpunit`
- `vendor/bin/pest`

### テスト設定

- `phpunit.xml` を使用して `DB_CONNECTION=sqlite` と `DB_DATABASE=:memory:` を設定して高速テスト
- テストは dev/prod データに触れないように別の env を保つ

### 認可テスト

```php
use Illuminate\Support\Facades\Gate;

$this->assertTrue(Gate::forUser($user)->allows('update', $project));
$this->assertFalse(Gate::forUser($otherUser)->allows('update', $project));
```

### Inertia フィーチャーテスト

Inertia.js 使用時、Inertia テスティングヘルパーでコンポーネント名とプロップをアサート。

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

生の JSON アサーションより `assertInertia` を優先して、テストを Inertia レスポンスに合わせておく。
