# ルートトランジションアニメーション

Angular Router はブラウザの **View Transitions API** をサポートしており、ルート間のスムーズなビジュアルトランジションを実現します。

## ビュートランジションの有効化

ルーター設定に `withViewTransitions()` を追加します。

```ts
provideRouter(routes, withViewTransitions());
```

これは**プログレッシブエンハンスメント**です。API をサポートしていないブラウザでも、トランジションアニメーションなしでルーターは動作します。

## 仕組み

1. ブラウザが古い状態のスクリーンショットを撮影します。
2. Router が DOM を更新します（新しいコンポーネントをアクティブ化）。
3. ブラウザが新しい状態のスクリーンショットを撮影します。
4. ブラウザが2つの状態間をアニメーション遷移します。

## CSS によるカスタマイズ

トランジションは**グローバル CSS ファイル**（コンポーネントスコープの CSS ではない）でカスタマイズします。

`::view-transition-old()` および `::view-transition-new()` 擬似要素を使用します。

```css
/* 例: クロスフェード + スライド */
::view-transition-old(root) {
  animation: 90ms cubic-bezier(0.4, 0, 1, 1) both fade-out;
}
::view-transition-new(root) {
  animation: 210ms cubic-bezier(0, 0, 0.2, 1) 90ms both fade-in;
}
```

## 高度な制御

`onViewTransitionCreated` を使用して、ナビゲーションコンテキストに基づいてトランジションをスキップしたり動作をカスタマイズしたりできます。

```ts
withViewTransitions({
  onViewTransitionCreated: ({transition, from, to}) => {
    // 特定のルートでアニメーションをスキップ
    if (to.url === '/no-animation') {
      transition.skipTransition();
    }
  },
});
```

## ベストプラクティス

- **グローバルスタイル**: ビューのカプセル化の問題を避けるため、トランジションアニメーションは常に `styles.css` で定義してください。
- **ビュートランジション名**: ルート間でスムーズにトランジションさせたい要素（例：ヘッダー画像）には、ユニークな `view-transition-name` を割り当ててください。
