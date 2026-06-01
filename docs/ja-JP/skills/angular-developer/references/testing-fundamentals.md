# テストの基礎

このガイドは Angular のユニットテストおよびコンポーネントテストを記述するための基本的な原則とプラクティスを説明します。プロジェクトに設定済みのテストランナーを使用してください。

## 中心的な考え方: 非同期ファースト

現代の Angular アプリケーションは、特にシグナルやゾーンレス変更検知を使用する場合、状態の変化を非同期的にスケジュールすることが多くあります。テストはこれを考慮する必要があります。

「実行、待機、検証」パターンを推奨します。

1. **実行**: 状態を更新するかアクションを実行する（例：コンポーネントのインプットを設定する、ボタンをクリックする）。
2. **待機**: `await fixture.whenStable()` を使用して、フレームワークがスケジュールされた更新を処理し変更をレンダリングするのを待つ。
3. **検証**: 結果を確認する。

### 基本的なテスト構造の例

```ts
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {MyComponent} from './my.component';

describe('MyComponent', () => {
  let component: MyComponent;
  let fixture: ComponentFixture<MyComponent>;
  let h1: HTMLElement;

  beforeEach(async () => {
    // 1. テストモジュールを設定する
    await TestBed.configureTestingModule({
      imports: [MyComponent],
    }).compileComponents();

    // 2. コンポーネントフィクスチャを作成する
    fixture = TestBed.createComponent(MyComponent);
    component = fixture.componentInstance;
    h1 = fixture.nativeElement.querySelector('h1');
  });

  it('should display the default title', async () => {
    // 実行: （暗黙的）コンポーネントはデフォルト状態で作成される。
    // 初期データバインディングを待機する。
    await fixture.whenStable();
    // 初期状態を検証する。
    expect(h1.textContent).toContain('Default Title');
  });

  it('should display a different title after a change', async () => {
    // 実行: コンポーネントの title プロパティを変更する。
    component.title.set('New Test Title');

    // 非同期更新の完了を待機する。
    await fixture.whenStable();

    // DOM が更新されたことを検証する。
    expect(h1.textContent).toContain('New Test Title');
  });
});
```

## TestBed と ComponentFixture

- **`TestBed`**: テスト専用の Angular モジュールを作成するための主要ユーティリティです。`beforeEach` で `TestBed.configureTestingModule({...})` を使用して、コンポーネントの宣言、サービスの提供、テストに必要なインポートをセットアップします。
- **`ComponentFixture`**: 作成されたコンポーネントインスタンスとその環境へのハンドルです。
  - `fixture.componentInstance`: コンポーネントのクラスインスタンスにアクセスします。
  - `fixture.nativeElement`: コンポーネントのルート DOM 要素にアクセスします。
  - `fixture.debugElement`: `nativeElement` の Angular 固有のラッパーで、DOM をクエリするためのより安全でプラットフォームに依存しない方法を提供します（例：`debugElement.query(By.css('p'))`）。
