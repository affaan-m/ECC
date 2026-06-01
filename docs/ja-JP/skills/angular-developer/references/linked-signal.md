# `linkedSignal` による依存状態

`linkedSignal` 関数を使用すると、他の状態と本質的に連動した書き込み可能な状態を作成できます。これは、インプットや別のシグナルから派生したデフォルト値を持つ必要があるが、ユーザーが独立して変更することもできる状態に最適です。

ソースの状態が変化すると、`linkedSignal` は新しい計算値にリセットされます。

## 基本的な使い方

ソースに基づいて再計算するだけでよい場合は、計算関数を渡します。`linkedSignal` は `computed` と同様に機能しますが、結果のシグナルは書き込み可能です（`.set()` や `.update()` を呼び出せます）。

```ts
import { Component, signal, linkedSignal } from '@angular/core';

@Component({...})
export class ShippingMethodPicker {
  shippingOptions = signal(['Ground', 'Air', 'Sea']);

  // デフォルトは最初のオプションです。
  // shippingOptions が変化すると、selectedOption は新しい最初のオプションにリセットされます。
  selectedOption = linkedSignal(() => this.shippingOptions()[0]);

  changeShipping(index: number) {
    // このシグナルを手動で更新することもできます！
    this.selectedOption.set(this.shippingOptions()[index]);
  }
}
```

## 高度な使い方: 以前の状態を考慮する

ソースの状態が変化したとき、ユーザーの手動選択がまだ有効であれば保持したい場合があります。そのためには、`source` と `computation` を提供するオブジェクト構文を使用します。

`computation` 関数はソースの新しい値と、以前のソース値および以前の `linkedSignal` 値を含む `previous` オブジェクトを受け取ります。

```ts
interface ShippingMethod { id: number; name: string; }

@Component({...})
export class ShippingMethodPicker {
  shippingOptions = signal<ShippingMethod[]>([
    {id: 0, name: 'Ground'}, {id: 1, name: 'Air'}, {id: 2, name: 'Sea'}
  ]);

  selectedOption = linkedSignal<ShippingMethod[], ShippingMethod>({
    source: this.shippingOptions,
    computation: (newOptions, previous) => {
      // 新しくロードされたオプションにユーザーが以前選択したオプションが
      // 含まれている場合はそれを維持し、そうでなければ最初のオプションにリセットします。
      return newOptions.find(opt => opt.id === previous?.value.id) ?? newOptions[0];
    }
  });
}
```

### `linkedSignal` vs `computed` vs `effect` の使い分け

- `computed` を使う: 状態が他の状態から **厳密に** 派生していて、手動更新が不要な場合。
- `linkedSignal` を使う: 状態が他の状態から派生しているが、ユーザーが **オーバーライドや手動更新** を行う必要がある場合。
- 1つの状態を別の状態と同期させるために `effect` を使用 **しない**。それはアンチパターンです。代わりに `computed` または `linkedSignal` を使用してください。
