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

- **バージョンの基準**：以下のガイダンスはBun 1.4.xを対象としています。CLIフラグはリリース間で変更されることがあるため、フラグ名に依存する前に`bun --version`で実際のバージョンを確認してください。
- **ランタイム**：ドロップイン互換のNodeランタイム（JavaScriptCore上に構築）。Bun 1.4以降、ランタイム自体はRustで実装されています（Zigから移行）。100%Node互換ではありません — 一部のネイティブアドオン、あまり一般的でない`node:`内部APIや、Node固有の内部動作に依存するパッケージは動作しないことがあります。本番環境で依存する前に検証してください。
- **パッケージマネージャー**：Bunにはパッケージマネージャーが含まれています。インストール性能はプロジェクト、ネットワーク状況、キャッシュの状態によって変わります。ロックファイルは現行のBunでは`bun.lock`（テキスト）がデフォルトです。古いバージョンは`bun.lockb`（バイナリ）を使用しており、Bunは移行のため現在もこれを読み込めますが、新規プロジェクトは`bun.lock`を使うべきです。
- **バンドラー**：アプリとライブラリ用の組み込みバンドラーとトランスパイラー。
- **テストランナー**：Jest様のAPIを備えた組み込み`bun test`。

**Nodeからの移行**：`node script.js`を`bun run script.js`または`bun script.js`に置き換えます。`npm install`の代わりに`bun install`を実行します。ほとんどのパッケージは機能します。npm スクリプトには`bun run`を使用します。`bun x`をnpxスタイルの1回限りの実行に使用します。Nodeの組み込みはサポートされています。パフォーマンスの向上のため、Bun APIが存在する場合は優先してください。

**パッケージ・ワークスペースコマンド**：`bun add <pkg>` / `bun remove <pkg>` / `bun update [pkg]`で依存関係を管理し、`bun outdated`で古い依存関係を一覧表示します。`bun pm ls`はロックファイルを使ってプロジェクトの依存関係と解決済みバージョンを表示し、`--all`を付けると推移的な依存関係も含めます。インストール済みファイルの内容の整合性を検証するものではありません。[`bun audit`](https://bun.com/docs/pm/cli/audit)は`bun.lock`内のパッケージ名とバージョンを使ってレジストリの脆弱性情報を照会し、`package.json`、`bun.lock`、`node_modules`は変更しません。プライベートなパッケージ情報を送信する前に、承認済みの送信先を確認してください。スコープ付きレジストリにアドバイザリエンドポイントがないパッケージはスキップされ、終了コードに影響しません。`bun audit fix`は依存関係を更新・インストールし、ロックファイルとインストール済みパッケージ、場合によっては直接依存の固定バージョンも変更します。適用されるライフサイクルスクリプトも含む、変更を伴うインストール操作としてレビューしてください。`bun dedupe`は重複インストールを解消し、`bun prune`は参照されなくなったパッケージを削除します。モノレポはルートの`package.json`の`workspaces`配列を使用します（npm/yarnと同じ規約）。特定のワークスペースでスクリプトを実行するには`bun run --filter <pkg-name> <script>`を使用します。

**組み込みAPI**：依存関係を追加する前にこれらを検討してください — ファイルI/Oには`Bun.file` / `Bun.write`、組み込みSQLiteデータベースには`bun:sqlite`、HTTP/WebSocketサーバーには`Bun.serve`、SQLデータベースには[`Bun.sql`](https://bun.com/docs/runtime/sql)、Redisには[`Bun.redis`](https://bun.com/docs/runtime/redis)、S3互換オブジェクトストレージには[`Bun.S3Client`](https://bun.com/docs/runtime/s3)。その他の新機能は[1.4リリースノート](https://bun.com/blog/bun-v1.4)を参照してください。

**Vercel**：`vercel.json`で`bunVersion: "1.4.x"`を設定し、Bun 1.4（Rustランタイム）を使用してください。詳細は[VercelのBunランタイムドキュメント](https://vercel.com/docs/functions/runtimes/bun)を参照。ビルド：`bun run build`または`bun build ./src/index.ts --outdir=dist`。インストール：再現可能なデプロイの場合は`bun install --frozen-lockfile`。

**参考**：[Bun 1.4 リリースノート](https://bun.com/blog/bun-v1.4)。

## 例

### 実行とインストール

```bash
# 依存関係をインストール（bun.lockを作成/更新）
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

Bun 1.4でCIに利用できるオプションには、影響を受けるテストを選ぶ`bun test --changed[=<ref>]`、ファイルごとのグローバル環境を使う`bun test --isolate`、ワーカープロセスで実行する`bun test --parallel[=<n>]`、CIを分割する`bun test --shard=<n>/<count>`があります。`--isolate`は同じプロセス内でファイルごとに新しいJavaScriptグローバル環境を作り、文書化されたファイル単位のリソースをクリーンアップします。プロセスやセキュリティのサンドボックスではありません。`--parallel`ではデフォルトで有効です。`--timings=<file>`はスケジューリング用に過去の所要時間を読み込み、`--update-timings`は所要時間を記録します。例：`bun test --parallel --timings=./test-timings.json --update-timings`。複数シャードのタイミングファイルのパスを決める前に、インストール済みバージョンのヘルプとドキュメントを確認してください。

```typescript
// test/example.test.ts
import { expect, test } from "bun:test";

test("add", () => {
  expect(1 + 2).toBe(3);
});
```

### ランタイムAPI

```typescript
const file = Bun.file("package.json");
const json = await file.json();

Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response("Hello");
  },
});
```

## ベストプラクティス

- 再現可能なインストールのため、ロックファイル（`bun.lock`）をコミットする。
- スクリプトには`bun run`を優先する。TypeScriptの場合、Bunは`.ts`をネイティブに実行する。
- 依存関係を最新に保つ。Bunとそのエコシステムは急速に進化している。
