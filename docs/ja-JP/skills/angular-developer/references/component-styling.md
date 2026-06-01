# コンポーネントスタイリング

Angular コンポーネントは、テンプレートに特定のスタイルを定義でき、カプセル化とモジュール性を実現します。

## スタイルの定義

スタイルはインラインまたは別ファイルで定義できます。

```ts
@Component({
  selector: 'app-photo',
  // インラインスタイル
  styles: `
    img {
      border-radius: 50%;
    }
  `,
  // または外部ファイル
  styleUrl: 'photo.component.css',
})
export class Photo {}
```

## ビューのカプセル化

すべてのコンポーネントにはビューのカプセル化設定があり、スタイルのスコープ方法を決定します。

| モード                            | 動作                                                                                                |
| :-------------------------------- | :-------------------------------------------------------------------------------------------------- |
| `Emulated`（デフォルト）          | 一意の HTML 属性を使用してスタイルをコンポーネントにスコープします。グローバルスタイルは引き続き影響する場合があります。 |
| `ShadowDom`                       | ブラウザのネイティブ Shadow DOM API を使用してスタイルを完全に分離します。                           |
| `None`                            | カプセル化を無効にします。コンポーネントのスタイルはグローバルになります。                           |
| `ExperimentalIsolatedShadowDom`   | コンポーネント自身のスタイルのみが適用されることを厳密に保証します。                                 |

### 使用方法

```ts
import { ViewEncapsulation } from '@angular/core';

@Component({
  ...,
  encapsulation: ViewEncapsulation.None,
})
export class GlobalStyled {}
```

## 特殊なセレクター

### `:host`

コンポーネントのホスト要素（コンポーネントのセレクターに一致する要素）をターゲットにします。

```css
:host {
  display: block;
  border: 1px solid black;
}
```

### `:host-context()`

祖先の何らかの条件に基づいてホスト要素をターゲットにします。

```css
/* 祖先のいずれかに 'theme-dark' クラスがある場合にスタイルを適用 */
:host-context(.theme-dark) {
  background-color: #333;
}
```

### `::ng-deep`

特定のルールのビューカプセル化を無効にし、子コンポーネントに「リーク」させます。
**注意: Angular チームは `::ng-deep` の使用を強く推奨していません。** 後方互換性のためにのみサポートされています。

## テンプレート内のスタイル

コンポーネントのテンプレートに `<style>` 要素を直接使用できます。ビューのカプセル化ルールは引き続き適用されます。

```html
<style>
  .dynamic-class {
    color: red;
  }
</style>
<div class="dynamic-class">Hello</div>
```

## 外部スタイル

CSS での `<link>` または `@import` の使用は外部スタイルとして扱われます。**外部スタイルは擬似的なビューカプセル化の影響を受けません。**
