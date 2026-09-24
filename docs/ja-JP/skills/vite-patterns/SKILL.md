---
name: vite-patterns
description: Vite build tool patterns including config, plugins, HMR, env variables, proxy setup, SSR, library mode, dependency pre-bundling, and build optimization. Activate when working with vite.config.ts, Vite plugins, or Vite-based projects.
origin: ECC
---

# Vite パターン

Vite 8+ プロジェクトのビルドツールおよびデベロップメントサーバーのパターン。設定、環境変数、プロキシ設定、ライブラリモード、依存関係の事前バンドル、一般的な本番環境の落とし穴をカバー。

## 使用するタイミング

- `vite.config.ts` または `vite.config.js` を設定するとき
- 環境変数または `.env` ファイルを設定するとき
- APIバックエンド用のデベロップメントサーバープロキシを設定するとき
- ビルド出力（チャンク、ミニファイ、アセット）を最適化するとき
- `build.lib` でライブラリを公開するとき
- 依存関係の事前バンドルまたはCJS/ESM相互運用のトラブルシューティングをするとき
- HMR、デベロップメントサーバー、またはビルドエラーをデバッグするとき
- Viteプラグインの選択または順序付けをするとき

## 動作の仕組み

- **デベロップメントモード**はソースファイルをネイティブESMとして提供します（バンドルなし）。変換はモジュールリクエストごとにオンデマンドで行われるため、コールドスタートが速くHMRが精確です。
- **ビルドモード**はRolldown（v7+）またはRollup（v5〜v6）を使用して、ツリーシェイキング、コード分割、Oxcベースのミニファイでアプリを本番用にバンドルします。
- **依存関係の事前バンドル**はesbuildを通じてCJS/UMD依存関係をESMに一度変換し、結果を `node_modules/.vite` にキャッシュします。これにより後続の起動では処理をスキップできます。
- **プラグイン**はデベロップメントとビルドにわたって統一されたインターフェースを共有します。同じプラグインオブジェクトが、デベロップメントサーバーのオンデマンド変換と本番パイプラインの両方で機能します。
- **環境変数**はビルド時に静的にインライン化されます。`VITE_` プレフィックス付きの変数はバンドル内のパブリック定数になり、プレフィックスなしのものはクライアントコードから見えません。

## 例

### 設定の構造

#### 基本設定

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
})
```

#### 条件付き設定

```typescript
// vite.config.ts
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd())   // VITE_ プレフィックスのみ（安全）

  return {
    plugins: [react()],
    server: command === 'serve' ? { port: 3000 } : undefined,
    define: {
      __API_URL__: JSON.stringify(env.VITE_API_URL),
    },
  }
})
```

#### 主要な設定オプション

| キー | デフォルト | 説明 |
|-----|---------|-------------|
| `root` | `'.'` | プロジェクトルート（`index.html` の場所） |
| `base` | `'/'` | デプロイされたアセットのパブリックベースパス |
| `envPrefix` | `'VITE_'` | クライアントに公開する環境変数のプレフィックス |
| `build.outDir` | `'dist'` | 出力ディレクトリ |
| `build.minify` | `'oxc'` | ミニファイアー（`'oxc'`、`'terser'`、または `false`） |
| `build.sourcemap` | `false` | `true`、`'inline'`、または `'hidden'` |

### プラグイン

#### 必須プラグイン

ほとんどのプラグインのニーズは、少数のよく管理されたパッケージでカバーできます。独自のプラグインを作成する前にこれらを検討してください。

| プラグイン | 目的 | 使用タイミング |
|--------|---------|-------------|
| `@vitejs/plugin-react-swc` | SWC経由のReact HMR + Fast Refresh | Reactアプリのデフォルト（Babelバリアントより高速） |
| `@vitejs/plugin-react` | Babel経由のReact HMR + Fast Refresh | Babelプラグインが必要な場合のみ（emotion、MobXデコレーター） |
| `@vitejs/plugin-vue` | Vue 3 SFCサポート | Vueアプリ |
| `vite-plugin-checker` | ワーカースレッドでHMRオーバーレイ付きの `tsc` + ESLintを実行 | **TypeScriptアプリ全般** — Viteは `vite build` 中に型チェックを行いません |
| `vite-tsconfig-paths` | `tsconfig.json` の `paths` エイリアスを尊重 | `tsconfig.json` にエイリアスが既にある場合 |
| `vite-plugin-dts` | ライブラリモードで `.d.ts` ファイルを出力 | TypeScriptライブラリを公開するとき |
| `vite-plugin-svgr` | SVGをReactコンポーネントとしてインポート | SVGをコンポーネントとして使用するReactアプリ |
| `rollup-plugin-visualizer` | バンドルのツリーマップ/サンバーストレポート | 定期的なバンドルサイズの監査（`enforce: 'post'` を使用） |
| `vite-plugin-pwa` | ゼロ設定のPWA + Workbox | オフライン対応アプリ |

**重要な注意：** `vite build` はトランスパイルしますが、型チェックは行いません。`vite-plugin-checker` を追加するか、CIで `tsc --noEmit` を実行しない限り、型エラーは本番環境にサイレントに出荷されます。

#### カスタムプラグインの作成

カスタムプラグインの作成は稀です。ほとんどのニーズは既存のプラグインでカバーできます。必要な場合は `vite.config.ts` にインラインで書き始め、再利用する場合にのみ抽出してください。

```typescript
// vite.config.ts — 最小限のインラインプラグイン
function myPlugin(): Plugin {
  return {
    name: 'my-plugin',                       // 必須、一意でなければならない
    enforce: 'pre',                           // 'pre' | 'post'（オプション）
    apply: 'build',                           // 'build' | 'serve'（オプション）
    transform(code, id) {
      if (!id.endsWith('.custom')) return
      return { code: transformCustom(code), map: null }
    },
  }
}
```

**主要フック：** `transform`（ソースの変更）、`resolveId` + `load`（仮想モジュール）、`transformIndexHtml`（HTMLへの注入）、`configureServer`（デベロップメントミドルウェアの追加）、`hotUpdate`（カスタムHMR — v7+で非推奨の `handleHotUpdate` の代替）。

**仮想モジュール**は `\0` プレフィックス規約を使用します — `resolveId` は `'\0virtual:my-id'` を返すことで他のプラグインがスキップします。ユーザーコードは `'virtual:my-id'` をインポートします。

完全なプラグインAPIは [vite.dev/guide/api-plugin](https://vite.dev/guide/api-plugin) を参照してください。開発中の変換パイプラインのデバッグには `vite-plugin-inspect` を使用してください。

### HMR API

フレームワークプラグイン（`@vitejs/plugin-react`、`@vitejs/plugin-vue` など）はHMRを自動的に処理します。カスタム状態ストア、デベロップメントツール、または更新を跨いで状態を保持する必要があるフレームワーク非依存のユーティリティをビルドする場合のみ、`import.meta.hot` を直接使用してください。

```typescript
// src/store.ts — バニラモジュールの手動HMR
if (import.meta.hot) {
  // 更新を跨いで状態を保持する（.dataを再代入せず、必ず変更すること）
  import.meta.hot.data.count = import.meta.hot.data.count ?? 0

  // モジュールが置き換えられる前にサイドエフェクトをクリーンアップ
  import.meta.hot.dispose((data) => clearInterval(data.intervalId))

  // このモジュール自身の更新を受け入れる
  import.meta.hot.accept()
}
```

すべての `import.meta.hot` コードは本番ビルドからツリーシェイクされます — ガードを削除する必要はありません。

### 環境変数

Viteは `.env`、`.env.local`、`.env.[mode]`、`.env.[mode].local` をその順序で読み込みます（後のものが前のものを上書き）。`*.local` ファイルはgitignoreされており、ローカルのシークレット用です。

#### クライアントサイドアクセス

`VITE_` プレフィックス付きの変数のみがクライアントコードに公開されます：

```typescript
import.meta.env.VITE_API_URL   // string
import.meta.env.MODE            // 'development' | 'production' | カスタム
import.meta.env.BASE_URL        // base設定値
import.meta.env.DEV             // boolean
import.meta.env.PROD            // boolean
import.meta.env.SSR             // boolean
```

#### 設定での環境変数使用

```typescript
// vite.config.ts
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())          // VITE_ プレフィックスのみ（安全）
  return {
    define: {
      __API_URL__: JSON.stringify(env.VITE_API_URL),
    },
  }
})
```

### セキュリティ

#### `VITE_` プレフィックスはセキュリティ境界ではない

`VITE_` でプレフィックスされた変数は**ビルド時にクライアントバンドルに静的にインライン化されます**。ミニファイ、base64エンコード、ソースマップの無効化では隠せません。悪意のある攻撃者は出荷されたJavaScriptから任意の `VITE_` 変数を抽出できます。

**ルール：** パブリックな値（APIのURL、フィーチャーフラグ、パブリックキー）のみを `VITE_` 変数に入れてください。シークレット（APIトークン、データベースのURL、プライベートキー）はAPIまたはサーバーレス関数の背後にあるサーバーサイドに置かなければなりません。

#### `loadEnv('')` の落とし穴

```typescript
// BAD: 第3引数として '' を渡すと、サーバーのシークレットを含む全ての環境変数が読み込まれ、
// `define` でクライアントコードにインライン化できてしまう。
const env = loadEnv(mode, process.cwd(), '')

// GOOD: 明示的なプレフィックスリスト
const env = loadEnv(mode, process.cwd(), ['VITE_', 'APP_'])
```

#### 本番環境のソースマップ

本番環境のソースマップはオリジナルのソースコードを漏洩させます。エラートラッカー（Sentry、Bugsnag）にアップロードしてローカルで削除しない限り、無効にしてください：

```typescript
build: {
  sourcemap: false,                                  // デフォルト — このままにする
}
```

#### `.gitignore` チェックリスト

- `.env.local`、`.env.*.local` — ローカルのシークレットオーバーライド
- `dist/` — ビルド出力
- `node_modules/.vite` — 事前バンドルキャッシュ（古いエントリはゴーストエラーを引き起こす）

### サーバープロキシ

```typescript
// vite.config.ts — server.proxy
server: {
  proxy: {
    '/foo': 'http://localhost:4567',                    // 文字列の短縮形

    '/api': {
      target: 'http://localhost:8080',
      changeOrigin: true,                               // 仮想ホストバックエンドに必要
      rewrite: (path) => path.replace(/^\/api/, ''),
    },
  },
}
```

WebSocketプロキシには、ルート設定に `ws: true` を追加してください。

### ビルド最適化

#### 手動チャンク

```typescript
// vite.config.ts — build.rolldownOptions
build: {
  rolldownOptions: {
    output: {
      // オブジェクト形式：特定のパッケージをグループ化
      manualChunks: {
        'react-vendor': ['react', 'react-dom'],
        'ui-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-popover'],
      },
    },
  },
}
```

```typescript
// 関数形式：ヒューリスティックで分割
manualChunks(id) {
  if (id.includes('node_modules/react')) return 'react-vendor'
  if (id.includes('node_modules')) return 'vendor'
}
```

### パフォーマンス

#### バレルファイルを避ける

バレルファイル（ディレクトリからすべてを再エクスポートする `index.ts`）は、1つのシンボルをインポートする場合でも再エクスポートされたファイルをすべて読み込むことを強制します。これは公式ドキュメントで指摘されているデベロップメントサーバーの速度低下の主な原因です。

```typescript
// BAD — 1つのユーティリティのインポートがViteにバレル全体を読み込ませる
import { slash } from '@/utils'

// GOOD — 直接インポート、そのファイルだけが読み込まれる
import { slash } from '@/utils/slash'
```

#### インポート拡張子を明示的にする

暗黙の拡張子はそれぞれ `resolve.extensions` を通じて最大6回のファイルシステムチェックを強制します。大規模なコードベースでは積み重なります。

```typescript
// BAD
import Component from './Component'

// GOOD
import Component from './Component.tsx'
```

`tsconfig.json` の `allowImportingTsExtensions` と `resolve.extensions` を実際に使用する拡張子だけに絞ってください。

#### ホットパスルートのウォームアップ

`server.warmup.clientFiles` は、ブラウザがリクエストする前に既知のホットエントリを事前変換します。これにより大規模アプリでのコールドロードリクエストのウォーターフォールが解消されます。

```typescript
// vite.config.ts
server: {
  warmup: {
    clientFiles: ['./src/main.tsx', './src/routes/**/*.tsx'],
  },
}
```

#### 遅いデベロップメントサーバーのプロファイリング

`vite dev` が遅いと感じたら、`vite --profile` から始めてアプリを操作し、`p+enter` を押して `.cpuprofile` を保存します。[Speedscope](https://www.speedscope.app) で読み込み、どのプラグインが時間を消費しているかを確認します（通常はコミュニティプラグインの `buildStart`、`config`、または `configResolved` フック）。

### ライブラリモード

npmパッケージを公開する場合は `build.lib` を使用します。設定の詳細よりも重要な2つの落とし穴があります：

1. **型は出力されません** — `vite-plugin-dts` を追加するか、別途 `tsc --emitDeclarationOnly` を実行してください。
2. **ピア依存関係は必ず外部化しなければなりません** — リストされていないピアがライブラリにバンドルされると、コンシューマーで重複ランタイムエラーが発生します。

```typescript
// vite.config.ts
build: {
  lib: {
    entry: 'src/index.ts',
    formats: ['es', 'cjs'],
    fileName: (format) => `my-lib.${format}.js`,
  },
  rolldownOptions: {
    external: ['react', 'react-dom', 'react/jsx-runtime'],  // すべてのピア依存関係
  },
}
```

### SSR外部化

ベアの `createServer({ middlewareMode: true })` のセットアップはフレームワーク作者向けです。ほとんどのアプリはNuxt、Remix、SvelteKit、Astro、またはTanStack Startを使用すべきです。フレームワークユーザーとして調整するのは、依存関係がSSRで壊れた場合の外部化設定です：

```typescript
// vite.config.ts — SSRオプション
ssr: {
  external: ['node-native-package'],           // SSRバンドルで require() として保持
  noExternal: ['esm-only-package'],            // SSR出力に強制バンドル（ほとんどのSSRエラーを修正）
  target: 'node',                              // 'node' または 'webworker'
}
```

### 依存関係の事前バンドル

Viteは依存関係を事前バンドルして、CJS/UMDをESMに変換し、リクエスト数を削減します。

```typescript
// vite.config.ts — optimizeDeps
optimizeDeps: {
  include: [
    'lodash-es',                              // 重い依存関係を強制的に事前バンドル
    'cjs-package',                            // 相互運用問題を引き起こすCJS依存関係
    'deep-lib/components/**',                 // 深いインポートのグロブ
  ],
  exclude: ['local-esm-package'],             // 除外する場合は有効なESMでなければならない
  force: true,                                // キャッシュを無視して再最適化（一時的なデバッグ）
}
```

### 一般的な落とし穴

#### デベロップメントとビルドが一致しない

デベロップメントは変換にesbuild/Rolldownを使用し、ビルドはバンドルにRolldownを使用します。CJSライブラリは両者で異なる動作をする場合があります。デプロイ前に必ず `vite build && vite preview` で確認してください。

#### デプロイ後の古いチャンク

新しいビルドは新しいチャンクハッシュを生成します。アクティブなセッションを持つユーザーは、もはや存在しない古いファイル名をリクエストします。Viteには組み込みの解決策がありません。緩和策：

- デプロイメントウィンドウ中は古い `dist/assets/` ファイルを保持する
- ルーターでダイナミックインポートエラーをキャッチしてページをリロードする

#### Dockerとコンテナ

Viteはデフォルトで `localhost` にバインドし、コンテナの外からはアクセスできません：

```typescript
// vite.config.ts — Docker/コンテナ設定
server: {
  host: true,                                  // 0.0.0.0 にバインド
  hmr: { clientPort: 3000 },                   // リバースプロキシ経由の場合
}
```

#### モノレポのファイルアクセス

Viteはプロジェクトルートへのファイル提供を制限します。ルート外のパッケージはブロックされます：

```typescript
// vite.config.ts — モノレポのファイルアクセス
server: {
  fs: {
    allow: ['..'],                             // 親ディレクトリ（ワークスペースルート）を許可
  },
}
```

### アンチパターン

```typescript
// BAD: envPrefix を '' にすると全ての環境変数（シークレットを含む）がクライアントに公開される
envPrefix: ''

// BAD: アプリケーションソースコードで require() が動くと思い込む — ViteはESMファースト
const lib = require('some-lib')                // 代わりに import を使用

// BAD: 全てのnode_moduleを個別のチャンクに分割する — 何百もの小さなファイルを生成
manualChunks(id) {
  if (id.includes('node_modules')) {
    return id.split('node_modules/')[1].split('/')[0]   // パッケージごとに1チャンク
  }
}

// BAD: ライブラリモードでピア依存関係を外部化しない — 重複ランタイムエラーを引き起こす
// rolldownOptions.external なしの build.lib

// BAD: 非推奨のesbuildミニファイアーを使用する
build: { minify: 'esbuild' }                  // 'oxc'（デフォルト）または 'terser' を使用

// BAD: import.meta.hot.data を再代入で変更する
import.meta.hot.data = { count: 0 }           // 誤り：プロパティを変更すべきで再代入しない
import.meta.hot.data.count = 0                 // 正しい
```

**プロセスのアンチパターン：**

- **`vite preview` は本番サーバーではありません** — ビルドされたバンドルのスモークテストです。`dist/` を実際の静的ホスト（NGINX、Cloudflare Pages、Vercel静的）にデプロイするか、マルチステージDockerfileを使用してください。
- **`vite build` が型チェックを行うと期待する** — トランスパイルのみです。型エラーは本番環境にサイレントに出荷されます。`vite-plugin-checker` を追加するか、CIで `tsc --noEmit` を実行してください。
- **デフォルトで `@vitejs/plugin-legacy` を導入する** — バンドルサイズが約40%膨らみ、ソースマップのバンドルアナライザーが壊れ、95%以上のモダンブラウザユーザーには不要です。仮定ではなく実際のアナリティクスに基づいて適用してください。
- **`tsconfig.json` パスを重複した30以上の `resolve.alias` エントリで手動管理する** — 代わりに `vite-tsconfig-paths` を使用してください。ExcalidrawやPostHogで観察されているため、新しいプロジェクトでは避けてください。
- **依存関係の変更後に古い `node_modules/.vite` を放置する** — 事前バンドルキャッシュがゴーストエラーを引き起こします。ブランチを切り替えたときや依存関係をパッチした後にクリアしてください。

## クイックリファレンス

| パターン | 使用タイミング |
|---------|-------------|
| `defineConfig` | 常に — 型推論を提供する |
| `loadEnv(mode, root, ['VITE_'])` | 設定での環境変数アクセス（明示的なプレフィックス） |
| `vite-plugin-checker` | TypeScriptアプリ（型チェックのギャップを埋める） |
| `vite-tsconfig-paths` | 手動の `resolve.alias` の代わりに |
| `optimizeDeps.include` | 相互運用問題を引き起こすCJS依存関係 |
| `server.proxy` | デベロップメント中にAPIリクエストをバックエンドにルーティング |
| `server.host: true` | Docker、コンテナ、リモートアクセス |
| `server.warmup.clientFiles` | ホットパスルートの事前変換 |
| `build.lib` + `external` | npmパッケージの公開 |
| `manualChunks`（オブジェクト形式） | ベンダーバンドルの分割 |
| `vite --profile` | 遅いデベロップメントサーバーのデバッグ |
| `vite build && vite preview` | 本番バンドルのローカルスモークテスト（本番サーバーではない） |

## 関連スキル

- `frontend-patterns` — Reactコンポーネントパターン
- `docker-patterns` — Viteを使用したコンテナ化されたデベロップメント
- `nextjs-turbopack` — Next.jsの代替バンドラー
