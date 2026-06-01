# インプット

インプットを使用すると、親コンポーネントから子コンポーネントへデータを渡すことができます。Angularは最新のアプリケーションにはシグナルベースの `input` APIの使用を推奨しています。

## シグナルベースのインプット

`input()` 関数を使用してインプットを宣言します。これは `InputSignal` を返します。

```ts
import {Component, input, computed} from '@angular/core';

@Component({
  selector: 'app-user',
  template: `<p>User: {{ name() }} ({{ age() }})</p>`,
})
export class User {
  // デフォルト値を持つオプションのインプット
  name = input('Guest');

  // 必須インプット
  age = input.required<number>();

  // インプットはリアクティブなシグナルです
  label = computed(() => `Name: ${this.name()}`);
}
```

### テンプレートでの使用

```html
<app-user [name]="userName" [age]="25" />
```

## 設定オプション

`input` 関数は設定オブジェクトを受け取ります:

- **エイリアス**: テンプレートで使用するプロパティ名を変更します。
- **トランスフォーム**: コンポーネントに到達する前に値を変換します。

```ts
import { input, booleanAttribute } from '@angular/core';

@Component({...})
export class CustomButton {
  // エイリアスの例
  label = input('', { alias: 'btnLabel' });

  // 組み込みヘルパーを使用したトランスフォームの例
  disabled = input(false, { transform: booleanAttribute });
}
```

## モデルインプット（双方向バインディング）

双方向データバインディングをサポートするインプットを作成するには `model()` を使用します。

```ts
@Component({
  selector: 'custom-counter',
  template: `<button (click)="increment()">+</button>`,
})
export class CustomCounter {
  value = model(0);

  increment() {
    this.value.update((v) => v + 1);
  }
}
```

### 使用例

```html
<!-- シグナルとの双方向バインディング -->
<custom-counter [(value)]="mySignal" />

<!-- プレーンなプロパティとの双方向バインディング -->
<custom-counter [(value)]="myProperty" />
```

## デコレーターベースのインプット（@Input）

レガシーAPIは引き続きサポートされていますが、新しいコードには推奨されません。

```ts
import { Component, Input } from '@angular/core';

@Component({...})
export class Legacy {
  @Input({ required: true }) value = 0;
  @Input({ transform: trimString }) label = '';
}
```

## ベストプラクティス

- **シグナルを優先する**: より優れたリアクティビティと型安全性のために、`@Input()` の代わりに `input()` を使用してください。
- **必須インプット**: ビルド時エラーを得るために、必須データには `input.required()` を使用してください。
- **純粋なトランスフォーム**: インプットのトランスフォーム関数が純粋で静的に解析可能であることを確認してください。
- **競合の回避**: 標準のDOMプロパティ（`id`、`title` など）と競合するインプット名を使用しないでください。
