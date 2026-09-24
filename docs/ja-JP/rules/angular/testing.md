---
paths:
  - "**/*.spec.ts"
  - "**/*.test.ts"
---
# Angular テスト

> このファイルは [common/testing.md](../common/testing.md) を Angular 固有のコンテンツで拡張します。

## テストランナー

プロジェクトで設定されているテストランナーを使用してください。`angular.json` と `package.json` を確認してください。Angular プロジェクトでは一般的に Vitest、Jest、または Jasmine + Karma が使用されます。

```bash
ng test               # ウォッチモード
ng test --no-watch    # CI モード
```

## TestBed セットアップ

スタンドアロンコンポーネントの場合、コンポーネントを直接インポートします。外部テンプレートを持つコンポーネントには `compileComponents()` を呼び出してください。

```typescript
describe('UserCardComponent', () => {
  let fixture: ComponentFixture<UserCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(UserCardComponent);
  });
});
```

## シグナル入力

シグナルベースの入力は `fixture.componentRef.setInput()` で設定します:

```typescript
fixture.componentRef.setInput('user', mockUser);
fixture.detectChanges();
```

## コンポーネントハーネス

UI インタラクションには直接の DOM クエリよりも Angular CDK コンポーネントハーネスを優先してください。ハーネスはマークアップの変更に対してより耐性があります。

```typescript
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatButtonHarness } from '@angular/material/button/testing';

let loader: HarnessLoader;

beforeEach(() => {
  loader = TestbedHarnessEnvironment.loader(fixture);
});

it('triggers save on button click', async () => {
  const button = await loader.getHarness(MatButtonHarness.with({ text: 'Save' }));
  await button.click();
  expect(saveSpy).toHaveBeenCalled();
});
```

## ルーターテスト

ルーターに依存するコンポーネントには `RouterTestingHarness` を使用してください:

```typescript
import { RouterTestingHarness } from '@angular/router/testing';

it('renders user on navigation', async () => {
  const harness = await RouterTestingHarness.create();
  const component = await harness.navigateByUrl('/users/1', UserDetailComponent);
  expect(component.userId()).toBe('1');
});
```

## 非同期テスト

制御された非同期には `fakeAsync` + `tick` を使用してください。実際の非同期には `waitForAsync` と `fixture.whenStable()` を使用してください。

```typescript
it('loads user after delay', fakeAsync(() => {
  const service = TestBed.inject(UserService);
  vi.spyOn(service, 'getUser').mockReturnValue(of(mockUser));

  fixture.detectChanges();
  tick();
  fixture.detectChanges();

  expect(fixture.nativeElement.querySelector('.name').textContent).toBe(mockUser.name);
}));
```

## HTTP テスト

```typescript
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpTestingController } from '@angular/common/http/testing';

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  httpMock = TestBed.inject(HttpTestingController);
});

afterEach(() => httpMock.verify());
```

## サービステスト

コンポーネントフィクスチャなしでサービスを直接注入します:

```typescript
describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UserService);
  });
});
```

## テスト対象

- **サービス**: すべてのパブリックメソッド、エラーパス、HTTP インタラクション
- **コンポーネント**: 入力/出力バインディング、主要な状態のレンダリング結果、ハーネスを使用したユーザーインタラクション
- **パイプ**: 純粋な変換 — TestBed 不要のプレーンなユニットテスト
- **ガード/リゾルバ**: `RouterTestingHarness` を使用した許可および拒否状態の戻り値

## E2E テスト

重要なユーザーフローには、Cypress や Playwright などプロジェクトで設定されている E2E フレームワークを使用してください。

```typescript
describe('Login flow', () => {
  it('redirects to dashboard on valid credentials', () => {
    cy.visit('/login');
    cy.get('[data-cy=email]').type('user@example.com');
    cy.get('[data-cy=password]').type('password123');
    cy.get('[data-cy=submit]').click();
    cy.url().should('include', '/dashboard');
  });
});
```

- 安定したセレクタのためにインタラクティブ要素に `data-cy` 属性を追加
- E2E テストでセレクタに CSS クラスやテキストコンテンツに依存しない

## カバレッジ

サービスとパイプのカバレッジは80%以上を目標にしてください。コンポーネント: 実装の詳細ではなく、振る舞いをテストしてください。

## スキルリファレンス

包括的なテストパターン、ハーネスの使用法、非同期のベストプラクティスについては、スキル: `angular-developer` を参照してください。
