# アウトプット（カスタムイベント）

アウトプットを使用すると、子コンポーネントがカスタムイベントを発行し、親コンポーネントがそれをリッスンできるようになります。Angularは最新のアプリケーションには新しい `output()` 関数の使用を推奨しています。

## 関数ベースのアウトプット

`output()` 関数を使用してアウトプットを宣言します。これは `OutputEmitterRef` を返します。

```ts
import {Component, output} from '@angular/core';

@Component({
  selector: 'custom-slider',
  template: `<button (click)="changeValue(50)">Set to 50</button>`,
})
export class CustomSlider {
  // イベントデータなしのアウトプット
  panelClosed = output<void>();

  // イベントデータあり（number型）のアウトプット
  valueChanged = output<number>();

  changeValue(newValue: number) {
    this.valueChanged.emit(newValue);
  }
}
```

### テンプレートでの使用

括弧 `()` を使用してアウトプットイベントにバインドします。イベントがデータを発行する場合は、特殊な `$event` 変数を使用してアクセスします。

```html
<custom-slider (panelClosed)="savePanelState()" (valueChanged)="logValue($event)" />
```

## 設定オプション

`output` 関数はエイリアスを指定する設定オブジェクトを受け取ります。

```ts
@Component({...})
export class CustomSlider {
  // テンプレートでは 'valueChanged' という名前のイベントですが、
  // コンポーネントクラスでは 'changed' としてアクセスします。
  changed = output<number>({ alias: 'valueChanged' });
}
```

## プログラム的なサブスクリプション

コンポーネントを動的に作成する場合、アウトプットにプログラム的にサブスクライブできます:

```ts
const componentRef = viewContainerRef.createComponent(CustomSlider);

const subscription = componentRef.instance.valueChanged.subscribe((val) => {
  console.log('Value changed:', val);
});

// 必要に応じて手動でクリーンアップします（Angularは破棄されたコンポーネントを自動的にクリーンアップします）
subscription.unsubscribe();
```

## デコレーターベースのアウトプット（@Output）

レガシーAPIは `@Output()` デコレーターと `EventEmitter` を使用します。引き続きサポートされていますが、新しいコードには推奨されません。

```ts
import { Component, Output, EventEmitter } from '@angular/core';

@Component({...})
export class LegacyExample {
  @Output() valueChanged = new EventEmitter<number>();

  // エイリアス付き
  @Output('customEventName') changed = new EventEmitter<void>();
}
```

## ベストプラクティス

- **`output()` を優先する**: `@Output()` と `EventEmitter` の代わりに関数ベースの `output()` を使用してください。
- **命名規則**: アウトプット名には `camelCase` を使用してください。`on` をプレフィックスとして付けないでください（例: `onValueChanged` ではなく `valueChanged` を使用）。
- **DOMバブリングなし**: Angularのカスタムイベントは、ネイティブイベントのようにDOMツリーをバブルアップしません。
- **競合の回避**: ネイティブDOMイベント（`click` や `submit` など）と競合する名前を選択しないでください。
