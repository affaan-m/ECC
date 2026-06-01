---
name: prisma-patterns
description: TypeScript バックエンド向け Prisma ORM のパターン集 — スキーマ設計、クエリ最適化、トランザクション、ページネーション、および重要な落とし穴（updateMany がレコードではなく件数を返す、$transaction のタイムアウト、migrate dev による DB リセット、一括書き込みで @updatedAt がスキップされる、サーバーレスでの接続枯渇など）。
origin: ECC
---

# Prisma パターン

TypeScript バックエンドにおける Prisma ORM の本番利用パターンと非自明な落とし穴。
Prisma 5.x および 6.x で検証済み。一部の挙動は Prisma 4 と異なる。

バージョン固有のパターンを適用する前に Prisma のバージョンを確認する:

```bash
npx prisma --version
```

Prisma 5 では `relationJoins` が導入され、クエリ戦略と設定に応じてリレーションを別クエリではなく JOIN でロードできるようになった。`omit` フィールド修飾子と `prisma.$extends` クライアント拡張 API も追加された。なお、`relationJoins` は大規模な 1:N リレーションや深くネストされた `include` でロウの爆発を引き起こす可能性がある — リレーションが親ごとに多数の行を返す場合は両アプローチをベンチマークすること。

## 有効化するタイミング

- Prisma スキーマのモデルやリレーションを設計・変更するとき
- クエリ、トランザクション、ページネーションロジックを記述するとき
- `updateMany`、`deleteMany`、その他の一括操作を使用するとき
- データベースマイグレーションを実行または計画するとき
- サーバーレス環境（Vercel、Lambda、Cloudflare Workers）にデプロイするとき
- ソフトデリートまたはマルチテナントの行フィルタリングを実装するとき

## 基本概念

### ID 戦略

| 戦略 | 使用場面 | 避ける場面 |
|---|---|---|
| `@default(cuid())` | デフォルトの選択肢 — URL セーフ、ソート可能、衝突なし | 外部システムに連番 ID が必要な場合 |
| `@default(uuid())` | Prisma 以外のシステムとの相互運用性が必要な場合 | 書き込みが多いテーブル（ランダム UUID が B ツリーインデックスを断片化する） |
| `@default(autoincrement())` | 内部結合テーブル、監査ログ | 公開向け ID（レコード件数が露出する） |

### スキーマのデフォルト

```prisma
model User {
  id        String    @id @default(cuid())
  email     String    @unique  // @unique はすでにインデックスを作成する — @@index は不要
  name      String
  role      Role      @default(USER)
  posts     Post[]
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([createdAt])
  @@index([deletedAt, createdAt]) // ソフトデリート + ソートクエリ向けの複合インデックス
}
```

- `WHERE` または `ORDER BY` で使用するすべての外部キーとカラムに `@@index` を追加する。
- ソフトデリートが想定される要件であれば `deletedAt DateTime?` を最初から宣言する — 後から追加するとライブテーブルへのマイグレーションが必要になる。
- `updatedAt @updatedAt` は Prisma が `update` と `upsert` のみで自動設定する（一括更新の落とし穴については「アンチパターン」を参照）。

### `include` vs `select`

| | `include` | `select` |
|---|---|---|
| 返却内容 | すべてのスカラーフィールド + 指定したリレーション | 指定したフィールドのみ |
| 使用場面 | ほとんどのフィールドとリレーションが必要な場合 | ホットパス、大規模テーブル、オーバーフェッチを避けたい場合 |
| パフォーマンス | 幅広いテーブルでオーバーフェッチになる可能性 | ペイロードが最小、大規模データセットで高速 |
| Prisma 5 での注意 | デフォルトで JOIN を使用（`relationJoins`） | 同様 |

```ts
// include — すべてのカラム + リレーション
const user = await prisma.user.findUnique({
  where: { id },
  include: { posts: { select: { id: true, title: true } } },
});

// select — 明示的な許可リスト
const user = await prisma.user.findUnique({
  where: { id },
  select: { id: true, email: true, name: true },
});
```

API レスポンスに Prisma エンティティをそのまま返してはならない — 公開フィールドを制御するためにレスポンス DTO にマッピングする:

```ts
// 悪い例: passwordHash、deletedAt、内部フィールドが漏洩する
return await prisma.user.findUniqueOrThrow({ where: { id } });

// 良い例: 明示的な DTO マッピング
const user = await prisma.user.findUniqueOrThrow({ where: { id } });
return { id: user.id, name: user.name, email: user.email };
```

### トランザクション形式の選択

| 状況 | 使用形式 |
|---|---|
| 独立した操作で相互依存がない | 配列形式 |
| 後のステップが前の結果に依存する | インタラクティブ形式 |
| 外部呼び出し（メール、HTTP）を含む | トランザクション外で処理 |

```ts
// 配列形式 — 1 回のラウンドトリップでバッチ処理
const [user, post] = await prisma.$transaction([
  prisma.user.update({ where: { id }, data: { name } }),
  prisma.post.create({ data: { title, authorId: id } }),
]);

// インタラクティブ形式 — tx クライアントのみ使用し、外側の prisma クライアントは使わない
const post = await prisma.$transaction(async (tx) => {
  const user = await tx.user.findUniqueOrThrow({ where: { id } });
  if (user.role !== 'ADMIN') throw new Error('Forbidden');
  return tx.post.create({ data: { title, authorId: user.id } });
});
```

### PrismaClient シングルトン

`PrismaClient` のインスタンスはそれぞれ独自の接続プールを開く。1 回だけインスタンス化する。

```ts
// lib/prisma.ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

`globalThis` パターンにより、ホットリロード時（Next.js、nodemon、ts-node-dev）に重複インスタンスが発生するのを防ぐ。

### N+1 問題

ループ内でリレーションをロードすると、行ごとに 1 クエリが発行される。

```ts
// 悪い例: N+1 — ユーザーごとに追加クエリが発行される
const users = await prisma.user.findMany();
for (const user of users) {
  const posts = await prisma.post.findMany({ where: { authorId: user.id } });
}

// 良い例: 単一クエリ
const users = await prisma.user.findMany({ include: { posts: true } });
```

Prisma 5 以降の `relationJoins` では、`include` 形式が単一の JOIN を使用する。大規模な 1:N セットでは結果セットのサイズが増加する場合がある — リレーションが親ごとに多数の行を返す可能性がある場合は両アプローチをベンチマークすること。

## コード例

### カーソルページネーション（フィードや大規模データセットに推奨）

```ts
async function getPosts(cursor?: string, limit = 20) {
  const items = await prisma.post.findMany({
    where: { published: true },
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' }, // タイムスタンプが重複した場合の不安定なページネーションを防ぐ二次ソート
    ],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });

  const hasNextPage = items.length > limit;
  if (hasNextPage) items.pop();

  return { items, nextCursor: hasNextPage ? items[items.length - 1].id : null };
}
```

`limit + 1` 件取得して最後の要素を pop する — 追加の件数クエリなしに `hasNextPage` を検出する標準的な方法。複数の行が同じタイムスタンプを持つ場合の不安定なページネーションを防ぐため、一意フィールド（例: `id`）を必ず二次 `orderBy` に含める。任意のページにジャンプする必要がある場合（管理テーブルなど）のみオフセットページネーションを使用する。

### ソフトデリート

```ts
// 常に明示的にフィルタリングする — ミドルウェアに依存しない（動作が隠れてデバッグが困難になる）
const activeUsers = await prisma.user.findMany({ where: { deletedAt: null } });

await prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
await prisma.user.update({ where: { id }, data: { deletedAt: null } }); // 復元
```

### エラーハンドリング

```ts
import { Prisma } from '@prisma/client';

try {
  await prisma.user.create({ data: { email } });
} catch (e) {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') throw new ConflictError('Email already exists');
    if (e.code === 'P2025') throw new NotFoundError('Record not found');
    if (e.code === 'P2003') throw new BadRequestError('Referenced record does not exist');
  }
  throw e;
}
```

主なコード: `P2002` ユニーク制約違反 · `P2025` レコードなし · `P2003` 外部キー制約違反。

サービス境界でキャッチしてドメインエラーに変換する。生の Prisma メッセージを API コンシューマーに公開しない。

### 接続プール — サーバーレス

接続パラメータは直接 `DATABASE_URL` に埋め込む — URL にすでにクエリパラメータ（例: `?schema=public`）が含まれている場合、文字列結合すると壊れる:

```bash
# .env — 推奨: URL にパラメータを埋め込む
DATABASE_URL="postgresql://user:pass@host/db?connection_limit=1&pool_timeout=20"

# 外部プーラー使用時（PgBouncer、Supabase プーラー）
DATABASE_URL="postgresql://user:pass@host/db?pgbouncer=true&connection_limit=1"
```

```ts
// Vercel、AWS Lambda などのサーバーレスランタイム: インスタンスごとにプールを 1 に制限する
// connection_limit と pool_timeout は DATABASE_URL で制御する
const prisma = new PrismaClient();
```

## アンチパターン

### `updateMany` は件数を返し、レコードを返さない

```ts
// 悪い例: 結果は { count: 2 } — users[0] は undefined
const users = await prisma.user.updateMany({ where: { role: 'GUEST' }, data: { role: 'USER' } });

// 良い例: まず ID を取得してから更新し、影響を受けた行のみを取得する
const targets = await prisma.user.findMany({
  where: { role: 'GUEST' },
  select: { id: true },
});
const ids = targets.map((u) => u.id);
await prisma.user.updateMany({ where: { id: { in: ids } }, data: { role: 'USER' } });
const updated = await prisma.user.findMany({ where: { id: { in: ids } } });
```

`deleteMany` も同様 — `{ count: n }` を返し、削除された行は返さない。

### `$transaction` インタラクティブ形式は 5 秒後にタイムアウトする

```ts
// 悪い例: トランザクション内の外部呼び出しがデフォルト 5 秒を超える → "Transaction already closed"
await prisma.$transaction(async (tx) => {
  const user = await tx.user.findUniqueOrThrow({ where: { id } });
  await sendWelcomeEmail(user.email); // 外部呼び出し
  await tx.user.update({ where: { id }, data: { emailSent: true } });
});

// 良い例: 外部呼び出しはトランザクションの外で行う
const user = await prisma.user.findUniqueOrThrow({ where: { id } });
await sendWelcomeEmail(user.email);
await prisma.user.update({ where: { id }, data: { emailSent: true } });

// タイムアウトの延長は一括処理で本当に必要な場合のみ
await prisma.$transaction(async (tx) => { ... }, { timeout: 30_000 });
```

### `migrate dev` はデータベースをリセットすることがある

`migrate dev` はスキーマのドリフトを検出するとリセットを促すことがあり、すべてのデータが削除される。

```bash
# 共有開発環境、ステージング、本番では絶対に使用しない
npx prisma migrate dev --name add_column

# ローカル単独開発以外では安全
npx prisma migrate deploy

# 適用せずにドリフトを確認する
npx prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL"
```

### マイグレーションファイルを手動編集すると将来のデプロイが壊れる

Prisma はすべてのマイグレーションファイルのチェックサムを検証する。適用後に編集すると、元のファイルがすでに実行されたすべての環境で `P3006 checksum mismatch` が発生する。代わりに新しいマイグレーションを作成する。

### 破壊的なスキーマ変更はマルチステップマイグレーションが必要

既存カラムへの `NOT NULL` 追加やカラム名の変更を 1 つのマイグレーションで行うと、テーブルがロックされるかデータが失われる。エクスパンド・アンド・コントラクトを使用する:

```bash
# ステップ 1: ローカルでマイグレーションを作成してからデプロイ
npx prisma migrate dev --name add_new_column   # ローカルのみ
npx prisma migrate deploy                       # ステージング / 本番
```

```ts
// ステップ 2: データをバックフィルする（シェルではなくスクリプトやマイグレーションジョブで実行）
await prisma.user.updateMany({ data: { newColumn: derivedValue } });
```

```bash
# ステップ 3: NOT NULL 制約のマイグレーションをローカルで作成してからデプロイ
npx prisma migrate dev --name make_new_column_required  # ローカルのみ
npx prisma migrate deploy                               # ステージング / 本番
```

### `@updatedAt` は `updateMany` で発火しない

`@updatedAt` は `update` と `upsert` でのみ自動設定される。一括書き込みでは古い値のままになる。

```ts
// 悪い例: updatedAt が古い値のままになる
await prisma.post.updateMany({ where: { authorId }, data: { published: true } });

// 良い例
await prisma.post.updateMany({
  where: { authorId },
  data: { published: true, updatedAt: new Date() },
});
```

### ソフトデリート + `findUniqueOrThrow` で削除済みレコードが漏洩する

`findUniqueOrThrow` は DB 上に行が存在しない場合のみ `P2025` をスローする。ソフトデリートされた行は DB 上に存在するためエラーなしで返される。

`findUniqueOrThrow` は `where` にユニーク制約フィールドを必要とする — `id` と並べて `deletedAt: null` を追加すると、`{ id, deletedAt }` が複合ユニーク制約でないため型エラーになる。代わりに `findFirstOrThrow` を使用する。

```ts
// 悪い例: ソフトデリートされたユーザーが返される
const user = await prisma.user.findUniqueOrThrow({ where: { id } });

// 悪い例: Prisma 型エラー — { id, deletedAt } はユニーク制約ではない
const user = await prisma.user.findUniqueOrThrow({ where: { id, deletedAt: null } });

// 良い例: findFirstOrThrow は任意の where 条件をサポートする
const user = await prisma.user.findFirstOrThrow({ where: { id, deletedAt: null } });
```

### `where` なしの `deleteMany` は全行を削除する

```ts
// 悪い例: テーブルを暗黙的に全削除する
await prisma.post.deleteMany();

// 良い例
await prisma.post.deleteMany({ where: { authorId: userId } });
```

## ベストプラクティス

| ルール | 理由 |
|---|---|
| CI/CD では `migrate deploy`、`migrate dev` はローカルのみ | `migrate dev` はドリフト時に DB をリセットする可能性がある |
| エンティティをレスポンス DTO にマッピングする | 内部フィールドの漏洩を防ぐ |
| サービス境界で `PrismaClientKnownRequestError` をキャッチする | ドメインエラーに変換する |
| 手動の null チェックより `*OrThrow` メソッドを優先する | 自動的に P2025 をスローする。非ユニークフィールドでフィルタリングする場合は `findFirstOrThrow` を使用 |
| サーバーレスでは `connection_limit=1` + 外部プーラー | 接続枯渇を防ぐ |
| `deleteMany` には必ず `where` を指定する | テーブルの誤全削除を防ぐ |
| `updateMany` では `updatedAt: new Date()` を手動設定する | `@updatedAt` は一括書き込みをスキップする |

## 関連スキル

- `nestjs-patterns` — Prisma を統合する NestJS サービスレイヤー
- `postgres-patterns` — PostgreSQL レベルのインデックスと接続チューニング
- `database-migrations` — 本番向けのマルチステップマイグレーション計画
- `backend-patterns` — 汎用的な API とサービスレイヤー設計
