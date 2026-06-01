# RouterTestingHarness を使ったテスト

ルーティングを含むコンポーネントをテストする際は、Router や関連サービスをモックしないことが非常に重要です。代わりに `RouterTestingHarness` を使用してください。これは実際のアプリケーションに近い環境でルーティングロジックをテストするための、堅牢で信頼性の高い手段を提供します。

ハーネスを使用することで、実際のルーター設定、ガード、リゾルバーをテストできるため、より意味のあるテストになります。

## ルーターテストのセットアップ

`RouterTestingHarness` はルーティングシナリオをテストするための主要ツールです。また、`TestBed` 設定で `provideRouter` 関数を使用してテスト用のルートを提供する必要があります。

### セットアップの例

```ts
import {TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {RouterTestingHarness} from '@angular/router/testing';
import {Dashboard} from './dashboard.component';
import {HeroDetail} from './hero-detail.component';

describe('Dashboard Component Routing', () => {
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    // 1. TestBed をテスト用ルートで設定する
    await TestBed.configureTestingModule({
      providers: [
        // テスト固有のルートで provideRouter を使用する
        provideRouter([
          {path: '', component: Dashboard},
          {path: 'heroes/:id', component: HeroDetail},
        ]),
      ],
    }).compileComponents();

    // 2. RouterTestingHarness を作成する
    harness = await RouterTestingHarness.create();
  });
});
```

### 重要な概念

1. **`provideRouter([...])`**: テスト固有のルーティング設定を提供します。テスト対象のコンポーネントが正しく動作するために必要なルートを含めてください。
2. **`RouterTestingHarness.create()`**: ハーネスを非同期で作成・初期化し、ルート URL（`/`）への初期ナビゲーションを実行します。

## ルーターテストの記述

ハーネスが作成されたら、それを使ってナビゲーションを駆動し、ルーターおよびアクティブ化されたコンポーネントの状態についてアサーションを行うことができます。

### 例: ナビゲーションのテスト

```ts
it('should navigate to a hero detail when a hero is selected', async () => {
  // 1. 初期コンポーネントにナビゲートし、そのインスタンスを取得する
  const dashboard = await harness.navigateByUrl('/', Dashboard);

  // ダッシュボードにヒーローを選択するメソッドがあると仮定
  const heroToSelect = {id: 42, name: 'Test Hero'};
  dashboard.selectHero(heroToSelect);

  // ナビゲーションをトリガーするアクションの後、安定するまで待機する
  await harness.fixture.whenStable();

  // 2. URL についてアサーションを行う
  expect(harness.router.url).toEqual('/heroes/42');

  // 3. ナビゲーション後にアクティブ化されたコンポーネントを取得する
  const heroDetail = await harness.getHarness(HeroDetail);

  // 4. 新しいコンポーネントの状態についてアサーションを行う
  expect(await heroDetail.componentInstance.hero.name).toBe('Test Hero');
});

it('should get the activated component directly', async () => {
  // 1ステップでナビゲートしてコンポーネントインスタンスを取得する
  const dashboardInstance = await harness.navigateByUrl('/', Dashboard);

  expect(dashboardInstance).toBeInstanceOf(Dashboard);
});
```

### ベストプラクティス

- **ハーネスでナビゲートする**: ナビゲーションのシミュレーションには常に `harness.navigateByUrl()` を使用してください。このメソッドはアクティブ化されたコンポーネントのインスタンスに解決されるプロミスを返します。
- **ルーターの状態にアクセスする**: `harness.router` を使用してライブルーターインスタンスにアクセスし、その状態（例：`harness.router.url`）についてアサーションを行います。
- **アクティブ化されたコンポーネントを取得する**: 現在アクティブ化されているルーティングコンポーネントのコンポーネントハーネスインスタンスを取得するには `harness.getHarness(ComponentType)` を、`DebugElement` を取得するには `harness.routeDebugElement` を使用します。
- **安定するまで待機する**: ナビゲーションを引き起こすアクションを実行した後は、アサーションを行う前に必ず `await harness.fixture.whenStable()` でルーティングの完了を確認してください。
