---
description: React ビルドの失敗（Vite、webpack、Next.js、CRA、Parcel、esbuild、Bun）を段階的に修正します — JSX/TSX コンパイルエラー、ハイドレーションの不一致、サーバー/クライアントコンポーネント境界の失敗、型定義の欠落。react-build-resolver エージェントを呼び出して最小限のピンポイント修正を行います。
---

# React ビルドと修正

このコマンドは **react-build-resolver** エージェントを呼び出し、React ビルドエラーを最小限の変更で段階的に修正します。

## このコマンドが行うこと

1. **ビルドシステムの検出**: Vite、webpack、Next.js、CRA、Parcel、esbuild、または Bun を特定
2. **ビルドの実行**: プロジェクトのビルドスクリプトを実行
3. **エラーの解析**: 層（TypeScript / バンドラー設定 / ランタイム / ハイドレーション）でグループ化
4. **段階的な修正**: 1 つずつエラーを修正し、変更ごとにビルドを再実行
5. **サマリーレポート**: 修正済みの内容と残存事項を表示

## 使用タイミング

以下の場合に `/react-build` を使用する:

- `npm run build`（または pnpm/yarn/bun の同等コマンド）が失敗した
- TypeScript または React のアップグレード後の JSX/TSX コンパイルエラー
- ランタイムの Next.js ハイドレーション不一致エラー
- App Router のサーバー/クライアントコンポーネント境界エラー
- `react`、`react-dom`、`@types/react`、またはバンドラーのインストールまたはアップグレード後
- React に関連する型定義の欠落または「モジュールが見つからない」エラー

## スコープ

このコマンドは **React ビルド/バンドラー/ランタイムハイドレーション**の失敗を担当します。React が関与しない純粋な TypeScript 型エラーには、代わりに `/build-fix`（汎用）を使用してください。

## 実行される診断コマンド

```bash
# プロジェクトのビルドスクリプト（推奨）
npm run build --if-present
pnpm build 2>/dev/null
yarn build 2>/dev/null
bun run build 2>/dev/null

# 独立した型チェック
npm run typecheck --if-present
tsc --noEmit -p tsconfig.json

# バンドラー固有のフォールバック
next build                          # Next.js
vite build                          # Vite
react-scripts build                 # CRA
webpack --mode=production           # webpack
parcel build src/index.html         # Parcel
bun build ./src/index.tsx --outdir=dist
```

## セッション例

````text
User: /react-build

Agent:
# React ビルド解決

## 検出されたビルドシステム
Vite (vite.config.ts が存在、@vitejs/plugin-react が deps に含まれる)

## 初期診断

```bash
$ npm run build
> tsc -b && vite build

src/components/UserCard.tsx:1:8 - error TS6133: 'React' is declared but its value is never read.
src/components/Modal.tsx:12:15 - error TS7016: Could not find a declaration file for module 'react-portal'.
src/pages/Home.tsx:42:5 - error: 'useState' is not defined
```

エラー数: 3

## 修正 1: 旧 JSX トランスフォームの残留

File: src/components/UserCard.tsx:1
原因: `tsconfig.json` はすでに `"jsx": "react-jsx"` を使用している。明示的な `import React` は未使用。

```tsx
// 削除
- import React from 'react';
```

```bash
$ npm run build
# 残り 2 エラー
```

## 修正 2: 型定義の欠落

File: src/components/Modal.tsx
原因: `@types/react-portal` がインストールされていない。

```bash
$ npm i -D @types/react-portal
added 1 package
```

```bash
$ npm run build
# 残り 1 エラー
```

## 修正 3: フックインポートの欠落

File: src/pages/Home.tsx
原因: `useState` が参照されているがインポートされていない。

```tsx
- import { useEffect } from "react";
+ import { useEffect, useState } from "react";
```

```bash
$ npm run build
# ビルド成功!
```

## 最終確認

```bash
$ npm run build
✓ built in 2.34s

$ npm test
✓ 47 tests passed
```

## サマリー

| 指標 | 件数 |
|--------|-------|
| 修正したビルドエラー | 3 |
| 変更したファイル | 2 |
| 追加した依存関係 | 1 (@types/react-portal) |
| 残存する問題 | 0 |

Build Status: PASS: SUCCESS
````

## 修正される主なエラー

| エラー | 典型的な修正 |
|---|---|
| `'React' is not defined` | tsconfig で `"jsx": "react-jsx"` を設定（React 17+） |
| `@types/react` が欠落 | `npm i -D @types/react @types/react-dom` |
| `Unexpected token '<'` | `@vitejs/plugin-react` / `babel-loader` を追加 |
| `You're importing a component that needs useState`（Next.js） | `"use client"` を追加するか、フックをクライアントコンポーネントの子に移動 |
| `Module not found: Can't resolve 'fs'`（Next.js） | `fs` インポートを削除するか、ロジックをサーバーコンポーネント / API ルートに移動 |
| `Hydration failed because the initial UI does not match` | `Date.now()`/`Math.random()`/`window.*` を `useEffect` に移動 |
| `Invalid hook call` | React が複数存在 — `resolutions`/`overrides` で重複を解消 |
| `Element type is invalid` | デフォルトエクスポートと名前付きエクスポートの混同 |

## 修正戦略

1. **コンパイルエラーを最初に** — コードがビルドできなければならない
2. **ハイドレーションエラーを次に** — プロダクションの正確性に影響する
3. **バンドラー設定を 3 番目に** — プラグイン/ローダーの正確性を回復する
4. **1 度に 1 つの修正** — 各変更を検証する
5. **最小限の変更** — 説明なしに `// @ts-ignore` を使わない
6. **各修正後に再実行** — 新たなエラーをすぐに表面化させる

## 停止条件

以下の場合にエージェントは停止して報告する:

- 3 回の試行後も同じエラーが続く
- 修正が解決するよりも多くのエラーを引き起こす
- ビルド解決の範囲を超えるアーキテクチャの変更が必要（例: RSC 境界の再設計）
- バンドラーのバージョンがインストール済みの React メジャーをサポートしない

## 関連コマンド

- `/react-test` — ビルドがグリーンになった後にテストを実行
- `/react-review` — ビルドが成功した後にコード品質をレビュー
- `/build-fix` — 汎用ビルド修正（React 以外）
- `verification-loop` スキル — 完全な検証ループ

## 関連

- エージェント: `agents/react-build-resolver.md`
- スキル: `skills/react-patterns/`、`skills/frontend-patterns/`
- ルール: `rules/react/coding-style.md`、`rules/react/patterns.md`
