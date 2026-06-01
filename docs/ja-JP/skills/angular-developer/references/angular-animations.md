# Angular アニメーション

Angular で要素をアニメーションさせる際は、**まず `package.json` でプロジェクトの Angular バージョンを確認してください**。
モダンなアプリケーション（**Angular v20.2 以上**）では、`animate.enter` と `animate.leave` を使ったネイティブ CSS を優先してください。古いアプリケーションでは、非推奨の `@angular/animations` パッケージを使用する必要がある場合があります。

## 1. ネイティブ CSS アニメーション（v20.2 以上で推奨）

モダンな Angular では、要素が DOM に追加・削除される際のアニメーションに `animate.enter` と `animate.leave` が提供されています。これらは適切なタイミングで CSS クラスを適用します。

### `animate.enter` と `animate.leave`

要素に直接使用して、エンターまたはリーブのフェーズ中に CSS クラスを適用します。Angular はアニメーション完了時にエンタークラスを自動的に削除します。`animate.leave` の場合、Angular はアニメーションが完了するまで待ってから DOM から要素を削除します。

`animate.enter` の例：

```html
@if (isShown()) {
<div class="enter-container" animate.enter="enter-animation">
  <p>The box is entering.</p>
</div>
}
```

```css
/* トランジションを使用する場合は開始スタイルを指定してください */
.enter-container {
  border: 1px solid #dddddd;
  margin-top: 1em;
  padding: 20px;
  font-weight: bold;
  font-size: 20px;
}
.enter-container p {
  margin: 0;
}
.enter-animation {
  animation: slide-fade 1s;
}
@keyframes slide-fade {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

_注意: `animate.leave` は削除される子要素に追加できます。_

### イベントバインディングとサードパーティライブラリ

`(animate.enter)` と `(animate.leave)` にバインドして、関数を呼び出したり GSAP などの JS ライブラリを使用したりできます。

```html
@if(show()) {
<div (animate.leave)="onLeave($event)">...</div>
}
```

```ts
import { AnimationCallbackEvent } from '@angular/core';

onLeave(event: AnimationCallbackEvent) {
  // カスタムアニメーションロジックをここに記述
  // 重要: Angular が要素を削除できるよう、完了時に必ず animationComplete() を呼び出すこと！
  event.animationComplete();
}
```

## 2. 高度な CSS アニメーション

CSS は高度なアニメーションシーケンスのための強力なツールを提供しています。

### 状態とスタイルのアニメーション

プロパティバインディングを使用して要素の CSS クラスを切り替え、トランジションをトリガーします。

```html
<div [class.open]="isOpen">...</div>
```

```css
div {
  transition: height 0.3s ease-out;
  height: 100px;
}
div.open {
  height: 200px;
}
```

### auto 高さのアニメーション

`css-grid` を使用して auto 高さへのアニメーションが可能です。

```css
.container {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.3s;
}
.container.open {
  grid-template-rows: 1fr;
}
.container > div {
  overflow: hidden;
}
```

### スタガーと並列アニメーション

- **スタガー**: リスト内のアイテムに異なる値の `animation-delay` または `transition-delay` を使用します。
- **並列**: `animation` ショートハンドで複数のアニメーションを適用します（例: `animation: rotate 3s, fade-in 2s;`）。

### プログラムによる制御

標準の Web API を使用してアニメーションを直接取得します：

```ts
const animations = element.getAnimations();
animations.forEach((anim) => anim.pause());
```

## 3. レガシーアニメーション DSL（非推奨）

古いプロジェクト（v20.2 以前、または `@angular/animations` がすでに多用されているプロジェクト）では、コンポーネントメタデータ DSL を使用します。

**重要:** レガシーアニメーションと `animate.enter`/`leave` を同一コンポーネント内で混在させないでください。

### セットアップ

```ts
bootstrapApplication(App, {
  providers: [provideAnimationsAsync()],
});
```

### トランジションの定義

```ts
import {signal} from '@angular/core';
import {trigger, state, style, animate, transition} from '@angular/animations';

@Component({
  animations: [
    trigger('openClose', [
      state('open', style({opacity: 1})),
      state('closed', style({opacity: 0})),
      transition('open <=> closed', [animate('0.5s')]),
    ]),
  ],
  template: `<div [@openClose]="isOpen() ? 'open' : 'closed'">...</div>`,
})
export class OpenClose {
  isOpen = signal(true);
}
```
