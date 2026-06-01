# Angular シグナル概要

シグナルは、現代の Angular アプリケーションにおけるリアクティビティの基盤です。**シグナル**は値のラッパーであり、その値が変化したときに関心のあるコンシューマーに通知します。

## 書き込み可能シグナル（`signal`）

`signal()` を使用して、直接更新できる状態を作成します。

```ts
import {signal} from '@angular/core';

// 書き込み可能シグナルを作成する
const count = signal(0);

// 値を読み取る（常にゲッター関数を呼び出す必要がある）
console.log(count());

// 値を直接更新する
count.set(3);

// 前の値に基づいて更新する
count.update((value) => value + 1);
```

### 読み取り専用として公開する

サービスから状態を公開する際は、外部からの変更を防ぐために読み取り専用バージョンを公開することがベストプラクティスです。

```ts
private readonly _count = signal(0);
// コンシューマーはこれを読み取れるが、.set() や .update() は呼び出せない
readonly count = this._count.asReadonly();
```

## 算出シグナル（`computed`）

`computed()` を使用して、他のシグナルから値を導出する読み取り専用シグナルを作成します。

- **遅延評価**: 算出シグナルが読み取られるまで導出関数は実行されません。
- **メモ化**: 結果はキャッシュされます。依存するシグナルのいずれかが変化した場合にのみ再計算されます。
- **動的な依存関係**: 導出処理中に_実際に読み取られた_シグナルのみが追跡されます。

```ts
import {signal, computed} from '@angular/core';

const count = signal(0);
const doubleCount = computed(() => count() * 2);

// doubleCount は count が変化すると自動的に更新される。
```

## リアクティブコンテキスト

**リアクティブコンテキスト**は、Angular がシグナルの読み取りを監視して依存関係を確立するランタイム状態です。

Angular は以下を評価する際に自動的にリアクティブコンテキストに入ります。

- `computed` シグナル
- `effect` コールバック
- `linkedSignal` の計算
- コンポーネントテンプレート

### 追跡なしの読み取り（`untracked`）

リアクティブコンテキスト内でシグナルを読み取る際に依存関係を作成したくない場合（シグナルが変化してもコンテキストが再実行されないようにしたい場合）は、`untracked()` を使用します。

```ts
import {effect, untracked} from '@angular/core';

effect(() => {
  // この effect は currentUser が変化した場合にのみ実行される。
  // ここで counter が読み取られても、counter が変化したときには実行されない。
  console.log(`User: ${currentUser()}, Count: ${untracked(counter)}`);
});
```

### リアクティブコンテキストにおける非同期処理

リアクティブコンテキストは**同期**コードに対してのみ有効です。`await` 以降のシグナルの読み取りは追跡されません。**非同期境界の前に必ずシグナルを読み取ってください。**

```ts
// 誤り: await の後に theme() を読み取っているため追跡されない
effect(async () => {
  const data = await fetchUserData();
  console.log(theme());
});

// 正しい: await の前にシグナルを読み取る
effect(async () => {
  const currentTheme = theme();
  const data = await fetchUserData();
  console.log(currentTheme);
});
```
