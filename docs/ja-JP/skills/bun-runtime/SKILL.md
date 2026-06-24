---
name: bun-runtime
description: ランタイムとしてのBun、パッケージマネージャー、バンドラー、テストランナー。Bun対Nodeを選択する場合、移行メモ、Vercelサポート。
origin: ECC
---

# Bunランタイム

Bunは高速なオールインワンJavaScriptランタイムとツールキット：ランタイム、パッケージマネージャー、バンドラー、テストランナー。

## 使用時期

- **Bunを好む**：新しいJS/TSプロジェクト、インストール/実行速度が重要なスクリプト、Bunランタイムでのデプロイメント、単一のツールチェーン（実行+インストール+テスト+ビルド）が必要な場合。
- **Nodeを好む**：最大のエコシステム互換性、ノードを仮定するレガシーツール、またはある依存関係が既知のBun問題がある場合。

使用時期：Bunを採用、Nodeから移行、Bunスクリプト/テストを書いたりデバッグしたり、Vercelまたは他のプラットフォームでBunを構成する場合。

## 動作方法

- **ランタイム**：ドロップイン互換のNodeランタイム（JavaScriptCoreで構築、Zigで実装）。
- **パッケージマネージャー**：`bun install`はnpm/yarnよりも大幅に高速です。ロックファイルは`bun.lock`（テキスト）（デフォルト）。古いバージョンは`bun.lockb`（バイナリ）を使用しました。
- **バンドラー**：アプリとライブラリ用の組み込みバンドラーとトランスパイラー。
- **テストランナー**：Jest様のAPIを備えた組み込み`bun test`。

**Nodeからの移行**：`node script.js`を`bun run script.js`または`bun script.js`に置き換えます。`npm install`の代わりに`bun install`を実行します。ほとんどのパッケージは機能します。npm スクリプトには`bun run`を使用します。`bun x`をnpxスタイルの1回限りの実行に使用します。Nodeの組み込みはサポートされています。パフォーマンスの向上のため、Bunチャネルが存在する場合は優先。

**Vercel**：プロジェクト設定でBunに設定をランタイムに設定します。ビルド：`bun run build`または`bun build ./src/index.ts --outdir=dist`。インストール：再現可能なデプロイの場合は`bun install --frozen-lockfile`。

## 例

### 実行とインストール

```bash
# 依存関係をインストール（bun.lockまたはbun.lockbを作成/更新）
bun install

# スクリプトまたはファイルを実行
bun run dev
bun run src/index.ts
bun src/index.ts
```

### スクリプトとenv

```bash
bun run --env-file=.env dev
FOO=bar bun run script.ts
```

### テスト

```bash
bun test
bun test --watch
```

```typescript
// test/example.test.ts
import { expect, test } from "bun:test";

test("add", () => {
  expect(1 + 2).toBe(3);
});
```

## 常見の問題

- `bun install`は`node_modules`を作成しますが、シンボリックリンクの多用により構造が異なります。
- 古い依存関係にはBun互換性の問題がある可能性があります。Node にフォールバックする。
- VercelでBun使用時は設定とビルドコマンドが必須。
