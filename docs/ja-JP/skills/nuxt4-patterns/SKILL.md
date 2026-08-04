---
name: nuxt4-patterns
description: ハイドレーション安全性、パフォーマンス、ルートルール、遅延ロード、useFetchとuseAsyncDataを使ったSSR安全なデータフェッチングのためのNuxt 4アプリパターン。
origin: ECC
---

# Nuxt 4パターン

SSR、ハイブリッドレンダリング、ルートルール、またはページレベルのデータフェッチングを使用してNuxt 4アプリを構築またはデバッグするときに使用する。

## アクティベートするタイミング

- サーバーHTMLとクライアントの状態の間のハイドレーション不一致
- プリレンダリング、SWR、ISR、またはクライアントのみのセクションなどのルートレベルのレンダリング決定
- 遅延ロード、遅延ハイドレーション、またはペイロードサイズに関するパフォーマンス作業
- `useFetch`、`useAsyncData`、または`$fetch`を使ったページやコンポーネントのデータフェッチング
- ルートパラメータ、ミドルウェア、またはSSR/クライアントの差異に結びついたNuxtルーティングの問題

## ハイドレーション安全性

- 最初のレンダリングを決定論的に保つ。SSRレンダリングされたテンプレートの状態に`Date.now()`、`Math.random()`、ブラウザのみのAPI、またはストレージ読み取りを直接入れないこと。
- サーバーが同じマークアップを生成できない場合、ブラウザのみのロジックを`onMounted()`、`import.meta.client`、`ClientOnly`、または`.client.vue`コンポーネントの後ろに移動する。
- `vue-router`のものではなく、Nuxtの`useRoute()`コンポーザブルを使用する。
- SSRレンダリングされたマークアップを駆動するために`route.fullPath`を使用しない。URLフラグメントはクライアントのみであり、ハイドレーション不一致を引き起こす可能性がある。
- `ssr: false`は不一致のデフォルト修正としてではなく、真にブラウザのみの領域のエスケープハッチとして扱う。

## データフェッチング

- ページとコンポーネントでSSR安全なAPI読み取りには`await useFetch()`を優先する。サーバーでフェッチしたデータをNuxtペイロードに転送し、ハイドレーション時の2回目のフェッチを避ける。
- フェッチャーが単純な`$fetch()`呼び出しでない場合、カスタムキーが必要な場合、または複数の非同期ソースを構成する場合は`useAsyncData()`を使用する。
- `useAsyncData()`にキャッシュの再利用と予測可能なリフレッシュ動作のための安定したキーを提供する。
- `useAsyncData()`ハンドラを副作用なしに保つ。SSRとハイドレーション中に実行される可能性がある。
- `$fetch()`はユーザーによるトリガーの書き込みまたはクライアントのみのアクションに使用し、SSRからハイドレートされるべきトップレベルのページデータには使用しない。
- ナビゲーションをブロックすべきでない非重要データには`lazy: true`、`useLazyFetch()`、または`useLazyAsyncData()`を使用する。UIで`status === 'pending'`を処理する。
- `server: false`はSEOや最初のペイントに不要なデータのみに使用する。
- `pick`でペイロードサイズを削減し、深いリアクティビティが不要な場合はより浅いペイロードを優先する。

```ts
const route = useRoute()

const { data: article, status, error, refresh } = await useAsyncData(
  () => `article:${route.params.slug}`,
  () => $fetch(`/api/articles/${route.params.slug}`),
)

const { data: comments } = await useFetch(`/api/articles/${route.params.slug}/comments`, {
  lazy: true,
  server: false,
})
```

## ルートルール

レンダリングとキャッシング戦略には`nuxt.config.ts`の`routeRules`を優先する:

```ts
export default defineNuxtConfig({
  routeRules: {
    '/': { prerender: true },
    '/products/**': { swr: 3600 },
    '/blog/**': { isr: true },
    '/admin/**': { ssr: false },
    '/api/**': { cache: { maxAge: 60 * 60 } },
  },
})
```

- `prerender`: ビルド時の静的HTML
- `swr`: キャッシュされたコンテンツを提供しながらバックグラウンドで再検証
- `isr`: サポートされているプラットフォームでの増分静的再生成
- `ssr: false`: クライアントレンダリングルート
- `cache`または`redirect`: Nitroレベルのレスポンス動作

グローバルではなくルートグループごとにルートルールを選択する。マーケティングページ、カタログ、ダッシュボード、APIは通常異なる戦略が必要。

## 遅延ロードとパフォーマンス

- Nuxtはすでにルートでページをコード分割している。コンポーネント分割を微小最適化する前に、ルートの境界を意味のあるものに保つ。
- 非重要コンポーネントを動的にインポートするには`Lazy`プレフィックスを使用する。
- UIが実際に必要になるまでチャンクが読み込まれないよう、`v-if`で遅延コンポーネントを条件付きでレンダリングする。
- フォールドより下または非重要なインタラクティブUIには遅延ハイドレーションを使用する。

```vue
<template>
  <LazyRecommendations v-if="showRecommendations" />
  <LazyProductGallery hydrate-on-visible />
</template>
```

- カスタム戦略には、可視性またはアイドル戦略で`defineLazyHydrationComponent()`を使用する。
- Nuxtの遅延ハイドレーションは単一ファイルコンポーネントで機能する。遅延ハイドレーションコンポーネントに新しいpropsを渡すと、すぐにハイドレーションがトリガーされる。
- Nuxtがルートコンポーネントと生成されたペイロードをプリフェッチできるよう、内部ナビゲーションには`NuxtLink`を使用する。

## レビューチェックリスト

- 最初のSSRレンダリングとハイドレートされたクライアントレンダリングが同じマークアップを生成する
- ページデータがトップレベルの`$fetch`ではなく`useFetch`または`useAsyncData`を使用している
- 非重要なデータが遅延で明示的なローディングUIがある
- ルートルールがページのSEOと新鮮度要件に一致している
- 重いインタラクティブアイランドが遅延ロードまたは遅延ハイドレートされている
