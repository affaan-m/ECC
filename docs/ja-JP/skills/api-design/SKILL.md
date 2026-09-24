---
name: api-design
description: リソース命名、ステータス コード、ページネーション、フィルタリング、エラー応答、バージョン管理、およびレート制限を含む REST API デザイン パターン。
origin: ECC
---

# API デザイン パターン

一貫性のある開発者フレンドリーな REST API を設計するための規約とベスト プラクティス。

## アクティブ化するとき

- 新しい API エンドポイントを設計しているとき
- 既存の API 契約をレビューしているとき
- ページネーション、フィルタリング、またはソートを追加しているとき
- API のエラー処理を実装しているとき
- API バージョン管理戦略を計画しているとき
- パブリックまたはパートナー向けの API を構築しているとき

## リソース デザイン

### URL 構造

```
# リソースは名詞、複数形、小文字、ケバブケース
GET    /api/v1/users
GET    /api/v1/users/:id
POST   /api/v1/users
PUT    /api/v1/users/:id
PATCH  /api/v1/users/:id
DELETE /api/v1/users/:id

# 関係のための サブ リソース
GET    /api/v1/users/:id/orders
POST   /api/v1/users/:id/orders

# CRUD にマップされないアクション (動詞は慎重に使用)
POST   /api/v1/orders/:id/cancel
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
```

### 命名規則

```
# よい
/api/v1/team-members          # 複数単語リソース用ケバブケース
/api/v1/orders?status=active  # フィルタリング用クエリ パラメーター
/api/v1/users/123/orders      # 所有権用のネストされたリソース

# 悪い
/api/v1/getUsers              # URL 内の動詞
/api/v1/user                  # 単数形（複数形を使用）
/api/v1/team_members          # URL 内のスネークケース
/api/v1/users/123/getOrders   # ネストされたリソース内の動詞
```

## HTTP メソッドとステータス コード

### メソッド セマンティクス

| メソッド | べき等 | セーフ | 使用対象 |
|--------|--------|--------|---------|
| GET | はい | はい | リソースを取得 |
| POST | いいえ | いいえ | リソースを作成、アクションをトリガー |
| PUT | はい | いいえ | リソースの完全な置換 |
| PATCH | いいえ* | いいえ | リソースの部分的な更新 |
| DELETE | はい | いいえ | リソースを削除 |

*PATCH は適切な実装でべき等にすることができます

### ステータス コード リファレンス

```
# 成功
200 OK                    — GET、PUT、PATCH（応答本体付き）
201 Created               — POST (Location ヘッダーを含める)
204 No Content            — DELETE、PUT（応答本体なし）

# クライアント エラー
400 Bad Request           — 検証失敗、不正な JSON
401 Unauthorized          — 認証がない、または無効
403 Forbidden             — 認証済みですが認可されていない
404 Not Found             — リソースが存在しません
409 Conflict              — 重複エントリ、状態競合
422 Unprocessable Entity  — セマンティック上無効（有効な JSON、悪いデータ）
429 Too Many Requests     — レート制限を超過

# サーバー エラー
500 Internal Server Error — 予期しない失敗 (詳細は公開しない)
502 Bad Gateway           — アップストリーム サービスが失敗
503 Service Unavailable   — 一時的なオーバーロード、Retry-After を含める
```

### 一般的な間違い

```
# 悪い: すべてに 200
{ "status": 200, "success": false, "error": "Not found" }

# よい: HTTP ステータス コードをセマンティック的に使用
HTTP/1.1 404 Not Found
{ "error": { "code": "not_found", "message": "User not found" } }

# 悪い: 検証エラーに 500
# よい: フィールドレベルの詳細を含む 400 または 422

# 悪い: 作成されたリソースに 200
# よい: Location ヘッダー付き 201
HTTP/1.1 201 Created
Location: /api/v1/users/abc-123
```

## 応答フォーマット

### 成功応答

```json
{
  "data": {
    "id": "abc-123",
    "email": "alice@example.com",
    "name": "Alice",
    "created_at": "2025-01-15T10:30:00Z"
  }
}
```

### コレクション応答（ページネーション付き）

```json
{
  "data": [
    { "id": "abc-123", "name": "Alice" },
    { "id": "def-456", "name": "Bob" }
  ],
  "meta": {
    "total": 142,
    "page": 1,
    "per_page": 20,
    "total_pages": 8
  },
  "links": {
    "self": "/api/v1/users?page=1&per_page=20",
    "next": "/api/v1/users?page=2&per_page=20",
    "last": "/api/v1/users?page=8&per_page=20"
  }
}
```

### エラー応答

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "field": "email",
        "message": "Must be a valid email address",
        "code": "invalid_format"
      },
      {
        "field": "age",
        "message": "Must be between 0 and 150",
        "code": "out_of_range"
      }
    ]
  }
}
```

### 応答エンベロープ バリエーション

```typescript
// オプション A: データ ラッパー付きエンベロープ（パブリック API に推奨）
interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
  links?: PaginationLinks;
}

interface ApiError {
  error: {
    code: string;
    message: string;
    details?: FieldError[];
  };
}

// オプション B: フラット応答（シンプル、内部 API 向け）
// 成功: リソースを直接返す
// エラー: エラー オブジェクトを返す
// HTTP ステータス コードで区別
```

## ページネーション

### オフセット ベース（シンプル）

```
GET /api/v1/users?page=2&per_page=20

# 実装
SELECT * FROM users
ORDER BY created_at DESC
LIMIT 20 OFFSET 20;
```

**長所:** 実装が簡単、「N ページにジャンプ」をサポート
**短所:** 大きなオフセット（OFFSET 100000）で低速、同時挿入で矛盾

### カーソル ベース（スケーラブル）

```
GET /api/v1/users?cursor=eyJpZCI6MTIzfQ&limit=20

# 実装
SELECT * FROM users
WHERE id > :cursor_id
ORDER BY id ASC
LIMIT 21;  -- 次が있는지 判定するため 1 つ余分に取得
```

```json
{
  "data": [...],
  "meta": {
    "has_next": true,
    "next_cursor": "eyJpZCI6MTQzfQ"
  }
}
```

**長所:** 位置に関わらず一貫性のあるパフォーマンス、同時挿入では安定
**短所:** 任意のページへのジャンプができない、カーソルが不透明

### どちらを使用するか

| ユースケース | ページネーション タイプ |
|----------|----------------|
| 管理ダッシュボード、小さなデータセット（<10K） | オフセット |
| 無限スクロール、フィード、大きなデータセット | カーソル |
| パブリック API | カーソル（デフォルト）とオフセット（オプション） |
| 検索結果 | オフセット（ユーザーはページ番号を期待） |

## フィルタリング、ソート、検索

### フィルタリング

```
# シンプルな等価性
GET /api/v1/orders?status=active&customer_id=abc-123

# 比較演算子（括弧表記を使用）
GET /api/v1/products?price[gte]=10&price[lte]=100
GET /api/v1/orders?created_at[after]=2025-01-01

# 複数値（カンマ区切り）
GET /api/v1/products?category=electronics,clothing

# ネストされたフィールド（ドット表記）
GET /api/v1/orders?customer.country=US
```

### ソート

```
# 単一フィールド (降順用に - を頭に付ける)
GET /api/v1/products?sort=-created_at

# 複数フィールド（カンマ区切り）
GET /api/v1/products?sort=-featured,price,-created_at
```

### 全文検索

```
# 検索クエリ パラメーター
GET /api/v1/products?q=wireless+headphones

# フィールド固有の検索
GET /api/v1/users?email=alice
```

### スパース フィールドセット

```
# 指定されたフィールドのみを返す（ペイロード削減）
GET /api/v1/users?fields=id,name,email
GET /api/v1/orders?fields=id,total,status&include=customer.name
```

## 認証と認可

### トークン ベース認証

```
# Authorization ヘッダー内のベアラー トークン
GET /api/v1/users
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...

# API キー（サーバー間）
GET /api/v1/data
X-API-Key: sk_live_abc123
```

### 認可パターン

```typescript
// リソース レベル: 所有権を確認
app.get("/api/v1/orders/:id", async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: { code: "not_found" } });
  if (order.userId !== req.user.id) return res.status(403).json({ error: { code: "forbidden" } });
  return res.json({ data: order });
});

// ロール ベース: 権限を確認
app.delete("/api/v1/users/:id", requireRole("admin"), async (req, res) => {
  await User.delete(req.params.id);
  return res.status(204).send();
});
```

## レート制限

### ヘッダー

```
HTTP/1.1 200 OK
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640000000

# 超過した場合
HTTP/1.1 429 Too Many Requests
Retry-After: 60
{
  "error": {
    "code": "rate_limit_exceeded",
    "message": "Rate limit exceeded. Try again in 60 seconds."
  }
}
```

### レート制限ティア

| ティア | 制限 | ウィンドウ | ユースケース |
|-----|-------|--------|----------|
| 匿名 | 30/分 | IP あたり | パブリック エンドポイント |
| 認証済み | 100/分 | ユーザーあたり | 標準 API アクセス |
| プレミアム | 1000/分 | API キーあたり | 有料 API プラン |
| 内部 | 10000/分 | サービスあたり | サービス間通信 |

## バージョン管理

### URL パス バージョン管理（推奨）

```
/api/v1/users
/api/v2/users
```

**長所:** 明示的、ルーティングが簡単、キャッシャブル
**短所:** バージョン間で URL が変更される

### ヘッダー バージョン管理

```
GET /api/users
Accept: application/vnd.myapp.v2+json
```

**長所:** クリーンな URL
**短所:** テストが困難、忘れやすい

### バージョン管理戦略

```
1. /api/v1/ から開始 — 必要になるまでバージョン管理しないでください
2. 最大 2 つのアクティブ バージョンを保守（現在 + 前)
3. 廃止予定のタイムライン:
   - 廃止予定を発表（パブリック API には 6 か月前の通知）
   - Sunset ヘッダーを追加: Sunset: Sat, 01 Jan 2026 00:00:00 GMT
   - 廃止予定日後に 410 Gone を返す
4. 非破壊的な変更はバージョン新規が必要ありません:
   - 応答への新しいフィールドの追加
   - 新しいオプション クエリ パラメーターの追加
   - 新しいエンドポイントの追加
5. 破壊的な変更には新しいバージョンが必要です:
   - フィールドの削除または名前変更
   - フィールド型の変更
   - URL 構造の変更
   - 認証方法の変更
```

## 実装パターン

### TypeScript (Next.js API ルート)

```typescript
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createUserSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({
      error: {
        code: "validation_error",
        message: "Request validation failed",
        details: parsed.error.issues.map(i => ({
          field: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
      },
    }, { status: 422 });
  }

  const user = await createUser(parsed.data);

  return NextResponse.json(
    { data: user },
    {
      status: 201,
      headers: { Location: `/api/v1/users/${user.id}` },
    },
  );
}
```

## API デザイン チェックリスト

新しいエンドポイントを本番環境に配信する前に：

- [ ] リソース URL は命名規則に従う（複数形、ケバブケース、動詞なし）
- [ ] 正しい HTTP メソッドが使用されている（読み取り用 GET、作成用 POST など）
- [ ] 適切なステータス コードが返される（すべてに 200 ではない）
- [ ] 入力がスキーマで検証される（Zod、Pydantic、Bean Validation）
- [ ] エラー応答は標準フォーマットに従う（コードとメッセージ付き）
- [ ] ページネーションはリスト エンドポイントに実装される（カーソルまたはオフセット）
- [ ] 認証が必要（または明示的にパブリックとしてマーク）
- [ ] 認可が確認される（ユーザーは自分のリソースにのみアクセス可能）
- [ ] レート制限が設定される
- [ ] 応答は内部詳細をリークしない（スタック トレース、SQL エラー）
- [ ] 既存のエンドポイントと命名が一貫している（camelCase vs snake_case）
- [ ] ドキュメント化される（OpenAPI/Swagger スペック更新）
