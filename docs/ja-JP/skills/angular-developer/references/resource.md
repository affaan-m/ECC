# `resource` による非同期リアクティビティ

> [!IMPORTANT]
> `resource` API は現在 Angular において実験的な機能です。

`Resource` は非同期データフェッチを Angular のシグナルベースのリアクティビティに組み込みます。依存関係が変化するたびに非同期ローダー関数を実行し、ステータスと結果を同期シグナルとして公開します。

## 基本的な使い方

`resource` 関数は、2 つの主なプロパティを持つオプションオブジェクトを受け取ります。

1. `params`: リアクティブな計算（`computed` のようなもの）。ここで読み取られたシグナルが変化すると、リソースが再フェッチします。
2. `loader`: パラメーターに基づいてデータをフェッチする非同期関数。

```ts
import { Component, resource, signal, computed } from '@angular/core';

@Component({...})
export class UserProfile {
  userId = signal('123');

  userResource = resource({
    // userId をリアクティブに追跡
    params: () => ({ id: this.userId() }),

    // params が変化するたびに実行される
    loader: async ({ params, abortSignal }) => {
      const response = await fetch(`/api/users/${params.id}`, { signal: abortSignal });
      if (!response.ok) throw new Error('Network error');
      return response.json();
    }
  });

  // computed シグナルでリソース値を使用する
  userName = computed(() => {
    if (this.userResource.hasValue()) {
      return this.userResource.value()?.name;
    } else {
      return 'Loading...';
    }
  });
}
```

## リクエストのキャンセル

前のローダーが実行中に `params` シグナルが変化した場合、`Resource` は提供された `abortSignal` を使用して未完了のリクエストをキャンセルしようとします。**必ず `abortSignal` を `fetch` 呼び出しに渡してください。**

## データの再読み込み

params を変更せずに、`.reload()` を呼び出すことでローダーを強制的に再実行できます。

```ts
this.userResource.reload();
```

## リソースステータスシグナル

`Resource` オブジェクトは、現在の状態を読み取るためのいくつかのシグナルを提供します。

- `value()`: 解決済みのデータ。存在しない場合は `undefined`。
- `hasValue()`: 型ガードのブール値。値が存在する場合は `true`。
- `isLoading()`: ローダーが現在実行中かどうかを示すブール値。
- `error()`: ローダーがスローしたエラー。存在しない場合は `undefined`。
- `status()`: 正確な状態を表す文字列定数（`'idle'`、`'loading'`、`'resolved'`、`'error'`、`'reloading'`、`'local'`）。

## ローカルミューテーション

リソースの値を直接、楽観的に更新できます。これによりステータスが `'local'` に変わります。

```ts
this.userResource.value.set({name: 'Optimistic Update'});
```

## `httpResource` によるリアクティブデータフェッチ

Angular の `HttpClient` を使用している場合は、`httpResource` の利用を推奨します。これは Angular HTTP スタック（インターセプターを含む）を活用しながら、同じシグナルベースのリソース API を提供する特化型ラッパーです。
