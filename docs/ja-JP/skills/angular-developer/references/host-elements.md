# コンポーネントのホスト要素

**ホスト要素**とは、コンポーネントのセレクターに一致するDOM要素です。コンポーネントのテンプレートはこの要素の内部にレンダリングされます。

## ホスト要素へのバインディング

`@Component` デコレーターの `host` プロパティを使用して、プロパティ、属性、スタイル、イベントをホスト要素にバインドします。これはレガシーデコレーターよりも **推奨されるアプローチ** です。

```ts
@Component({
  selector: 'custom-slider',
  host: {
    'role': 'slider', // 静的属性
    '[attr.aria-valuenow]': 'value', // 属性バインディング
    '[class.active]': 'isActive()', // クラスバインディング
    '[style.color]': 'color()', // スタイルバインディング
    '[tabIndex]': 'disabled ? -1 : 0', // プロパティバインディング
    '(keydown)': 'onKeyDown($event)', // イベントバインディング
  },
})
export class CustomSlider {
  value = 0;
  disabled = false;
  isActive = signal(false);
  color = signal('blue');

  onKeyDown(event: KeyboardEvent) {
    /* ... */
  }
}
```

## レガシーデコレーター

`@HostBinding` と `@HostListener` は後方互換性のためにサポートされていますが、新しいコードでは使用を避けてください。

```ts
export class CustomSlider {
  @HostBinding('tabIndex')
  get tabIndex() {
    return this.disabled ? -1 : 0;
  }

  @HostListener('keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    /* ... */
  }
}
```

## バインディングの競合

コンポーネント（ホストバインディング）とコンシューマー（テンプレートバインディング）の両方が同じプロパティにバインドされている場合:

1. **静的 vs 静的**: インスタンス（コンシューマー）のバインディングが優先されます。
2. **静的 vs 動的**: 動的なバインディングが優先されます。
3. **動的 vs 動的**: コンポーネントのホストバインディングが優先されます。

## ホスト属性のインジェクト

`inject` 関数と `HostAttributeToken` を使用して、構築時にホスト要素から静的属性を読み取ります。

```ts
import {Component, HostAttributeToken, inject} from '@angular/core';

@Component({
  selector: 'app-btn',
  template: `<ng-content />`,
})
export class AppButton {
  // `{ optional: true }` でインジェクトしない限り、'type'がない場合はエラーをスローします
  type = inject(new HostAttributeToken('type'));
}
```

使用例:

```html
<app-btn type="primary">Click Me</app-btn>
```
