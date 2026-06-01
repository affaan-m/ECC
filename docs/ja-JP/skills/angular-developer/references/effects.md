# `effect` と `afterRenderEffect` によるサイドエフェクト

Angular において、**エフェクト**とは、追跡している1つ以上のシグナル値が変化するたびに実行される処理です。

## `effect` を使用すべき場面

エフェクトは、シグナルの状態を命令的な（シグナルではない）APIと同期させるために使用します。

**有効なユースケース:**

- アナリティクスのロギング。
- `localStorage` や `sessionStorage` への状態の同期。
- `<canvas>` やサードパーティのチャートライブラリへのカスタムレンダリング。

**重要なルール: 状態を伝播させるためにエフェクトを使用しないでください。**
2つのシグナルを同期させるためにエフェクト内でシグナルの `.set()` や `.update()` を呼び出している場合、それは誤りです。`ExpressionChangedAfterItHasBeenChecked` エラーや無限ループを引き起こします。**状態の派生には必ず `computed()` または `linkedSignal()` を使用してください。**

## 基本的な使い方

エフェクトは変更検知プロセスの中で非同期的に実行されます。常に少なくとも1回は実行されます。

```ts
import { Component, signal, effect } from '@angular/core';

@Component({...})
export class Example {
  count = signal(0);

  constructor() {
    // エフェクトはインジェクションコンテキスト（コンストラクタなど）内で作成する必要があります
    effect((onCleanup) => {
      console.log(`Count changed to ${this.count()}`);

      const timer = setTimeout(() => console.log('Timer finished'), 1000);

      // クリーンアップ関数は次の実行前、またはコンポーネント破棄時に実行されます
      onCleanup(() => clearTimeout(timer));
    });
  }
}
```

## `afterRenderEffect` による DOM 操作

標準の `effect` はAngularがDOMを更新する _前_ に実行されます。シグナルの変化に基づいてDOMを手動で検査または変更する必要がある場合（サードパーティのUIライブラリを統合する場合など）は、`afterRenderEffect` を使用してください。

`afterRenderEffect` はAngularがDOMのレンダリングを完了した後に実行されます。

### レンダーフェーズ

リフロー（強制レイアウトスラッシング）を防ぐため、`afterRenderEffect` ではDOMの読み取りと書き込みを特定のフェーズに分けることが強制されます。

```ts
import { Component, afterRenderEffect, viewChild, ElementRef } from '@angular/core';

@Component({...})
export class Chart {
  canvas = viewChild.required<ElementRef>('canvas');

  constructor() {
    afterRenderEffect({
      // 1. DOMから読み取る
      earlyRead: () => {
        return this.canvas().nativeElement.getBoundingClientRect().width;
      },
      // 2. DOMに書き込む（前のフェーズの結果を受け取る）
      write: (width) => {
        // writeフェーズでDOMを読み取らないでください。
        setupChart(this.canvas().nativeElement, width);
      }
    });
  }
}
```

**利用可能なフェーズ（この順序で実行されます）:**

1. `earlyRead`
2. `write`（ここでは読み取り禁止）
3. `mixedReadWrite`（可能な限り避けること）
4. `read`（ここでは書き込み禁止）

_注意: `afterRenderEffect` はクライアント上でのみ実行され、サーバーサイドレンダリング（SSR）中は実行されません。_
