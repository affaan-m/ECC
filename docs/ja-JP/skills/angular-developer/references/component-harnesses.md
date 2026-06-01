# コンポーネントハーネスを使ったテスト

コンポーネントハーネスは、テストでコンポーネントと対話するための標準的で推奨される方法です。コンポーネントの内部 DOM 構造の変更からテストを保護することで、堅牢でユーザー中心の API を提供し、テストの脆さを軽減して可読性を高めます。

## ハーネスを使う理由

- **堅牢性:** コンポーネントの内部 HTML や CSS クラスをリファクタリングしてもテストが壊れません。
- **可読性:** DOM クエリ（`fixture.nativeElement.querySelector(...)`）の代わりに、ユーザーの視点からの操作（例: `button.click()`、`slider.getValue()`）でテストを記述できます。
- **再利用性:** 同じハーネスをユニットテストと E2E テストの両方で使用できます。

Angular Material はライブラリ内のすべてのコンポーネントに対してテストハーネスを提供しています。

## ユニットテストでのハーネスの使用

`TestbedHarnessEnvironment` は、ユニットテストでハーネスを使用するためのエントリポイントです。

### 例: `MatButtonHarness` を使ったテスト

```ts
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {MatButtonHarness} from '@angular/material/button/testing';
import {MyButtonContainerComponent} from './my-button-container.component';

describe('MyButtonContainerComponent', () => {
  let fixture: ComponentFixture<MyButtonContainerComponent>;
  let loader: HarnessLoader;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MyButtonContainerComponent, MatButtonModule],
    }).compileComponents();

    fixture = TestBed.createComponent(MyButtonContainerComponent);
    // コンポーネントのフィクスチャ用のハーネスローダーを作成
    loader = TestbedHarnessEnvironment.loader(fixture);
  });

  it('should find a button with specific text', async () => {
    // テキストが "Submit" の MatButton のハーネスを読み込む
    const submitButton = await loader.getHarness(MatButtonHarness.with({text: 'Submit'}));

    // ハーネス API を使用してコンポーネントと対話する
    expect(await submitButton.isDisabled()).toBe(false);
    await submitButton.click();

    // ... アサーション
  });
});
```

### 主要な概念

1. **`HarnessLoader`**: ハーネスインスタンスを検索・作成するためのオブジェクトです。`TestbedHarnessEnvironment.loader(fixture)` を使用してコンポーネントのフィクスチャ用ローダーを取得します。

2. **`loader.getHarness(HarnessClass)`**: 最初にマッチするコンポーネントのハーネスインスタンスを非同期で検索・返します。

3. **`HarnessClass.with({ ... })`**: 多くのハーネスは静的な `with` メソッドを提供しており、`HarnessPredicate` を返します。これにより、テキスト、セレクター、または無効状態などのプロパティに基づいてコンポーネントをフィルタリングして検索できます。テスト対象のコンポーネントを正確にターゲットにするために常に使用してください。

4. **ハーネス API:** ハーネスインスタンスを取得したら、そのメソッド（例: `.click()`、`.getText()`、`.getValue()`）を使用してコンポーネントと対話します。これらのメソッドは非同期操作と変更検出の待機を自動的に処理します。
