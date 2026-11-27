---
name: ai-regression-testing
description: AI 支援開発のためのリグレッションテスト戦略。データベース依存なしのサンドボックスモード API テスト、自動化されたバグチェックワークフロー、同じモデルがコードを書いてレビューする AI のブラインドスポットを捕捉するパターン。
origin: ECC
---

# AI リグレッションテスト

AI 支援開発のために特別に設計されたテストパターン。同じモデルがコードを書いてレビューする場合、自動化されたテストのみが捕捉できる体系的なブラインドスポットが生まれます。

## 起動タイミング

- AI エージェント（Claude Code、Cursor、Codex）が API ルートまたはバックエンドロジックを修正した場合
- バグが見つかり修正された — 再発を防ぐ必要がある
- プロジェクトに DB フリーテストに活用できるサンドボックス/モックモードがある場合
- コード変更後に `/bug-check` または同様のレビューコマンドを実行する場合
- 複数のコードパスが存在する場合（サンドボックス対本番、機能フラグなど）

## コアの問題

AI がコードを書いてその後自分の作業をレビューする場合、両方のステップに同じ前提を持ち込みます。これにより予測可能な障害パターンが生まれます：

```
AI が修正を書く → AI が修正をレビューする → AI が「正しく見える」と言う → バグはまだ存在する
```

**実際の例**（本番で観察された）：

```
修正 1: API レスポンスに notification_settings を追加
  → SELECT クエリに追加するのを忘れた
  → AI がレビューして見逃した（同じブラインドスポット）

修正 2: SELECT クエリに追加
  → TypeScript ビルドエラー（生成された型に列がない）
  → AI が修正 1 をレビューしたが SELECT の問題を捕捉できなかった

修正 3: SELECT * に変更
  → 本番パスを修正、サンドボックスパスを忘れた
  → AI がレビューして再び見逃した（4 回目の発生）

修正 4: テストが最初の実行で即座に捕捉 PASS:
```

パターン：**サンドボックス/本番パスの不一致**が AI が導入するリグレッションの第 1 位。

## サンドボックスモード API テスト

AI フレンドリーなアーキテクチャを持つほとんどのプロジェクトにはサンドボックス/モックモードがあります。これが高速な DB フリー API テストの鍵です。

### セットアップ（Vitest + Next.js App Router）

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["__tests__/**/*.test.ts"],
    setupFiles: ["__tests__/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

```typescript
// __tests__/setup.ts
// サンドボックスモードを強制 — データベース不要
process.env.SANDBOX_MODE = "true";
process.env.NEXT_PUBLIC_SUPABASE_URL = "";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
```

### Next.js API ルート用テストヘルパー

```typescript
// __tests__/helpers.ts
import { NextRequest } from "next/server";

export function createTestRequest(
  url: string,
  options?: {
    method?: string;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    sandboxUserId?: string;
  },
): NextRequest {
  const { method = "GET", body, headers = {}, sandboxUserId } = options || {};
  const fullUrl = url.startsWith("http") ? url : `http://localhost:3000${url}`;
  const reqHeaders: Record<string, string> = { ...headers };

  if (sandboxUserId) {
    reqHeaders["x-sandbox-user-id"] = sandboxUserId;
  }

  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers: reqHeaders,
  };

  if (body) {
    init.body = JSON.stringify(body);
    reqHeaders["content-type"] = "application/json";
  }

  return new NextRequest(fullUrl, init);
}

export async function parseResponse(response: Response) {
  const json = await response.json();
  return { status: response.status, json };
}
```

### リグレッションテストの作成

重要な原則：**機能するコードのためではなく、見つかったバグのためにテストを書く**。

```typescript
// __tests__/api/user/profile.test.ts
import { describe, it, expect } from "vitest";
import { createTestRequest, parseResponse } from "../../helpers";
import { GET, PATCH } from "@/app/api/user/profile/route";

// コントラクトを定義 — レスポンスに必ず存在すべきフィールド
const REQUIRED_FIELDS = [
  "id",
  "email",
  "full_name",
  "phone",
  "role",
  "created_at",
  "avatar_url",
  "notification_settings",  // ← バグで欠落が判明した後に追加
];

describe("GET /api/user/profile", () => {
  it("すべての必須フィールドを返す", async () => {
    const req = createTestRequest("/api/user/profile");
    const res = await GET(req);
    const { status, json } = await parseResponse(res);

    expect(status).toBe(200);
    for (const field of REQUIRED_FIELDS) {
      expect(json.data).toHaveProperty(field);
    }
  });

  // リグレッションテスト — この正確なバグが AI によって 4 回導入された
  it("notification_settings が undefined でない（BUG-R1 リグレッション）", async () => {
    const req = createTestRequest("/api/user/profile");
    const res = await GET(req);
    const { json } = await parseResponse(res);

    expect("notification_settings" in json.data).toBe(true);
    const ns = json.data.notification_settings;
    expect(ns === null || typeof ns === "object").toBe(true);
  });
});
```

### サンドボックス/本番のパリティテスト

最も一般的な AI リグレッション：本番パスを修正してサンドボックスパスを忘れる（またはその逆）。

```typescript
// サンドボックスレスポンスが期待されるコントラクトと一致することをテスト
describe("GET /api/user/messages（会話リスト）", () => {
  it("サンドボックスモードで partner_name を含む", async () => {
    const req = createTestRequest("/api/user/messages", {
      sandboxUserId: "user-001",
    });
    const res = await GET(req);
    const { json } = await parseResponse(res);

    // これは partner_name が本番パスに追加されたが
    // サンドボックスパスに追加されなかったバグを捕捉した
    if (json.data.length > 0) {
      for (const conv of json.data) {
        expect("partner_name" in conv).toBe(true);
      }
    }
  });
});
```

## バグチェックワークフローへのテスト統合

### カスタムコマンド定義

```markdown
<!-- .claude/commands/bug-check.md -->
# バグチェック

## ステップ 1: 自動テスト（必須、スキップ不可）

コードレビューの前に必ずこれらのコマンドを先に実行する：

    npm run test       # Vitest テストスイート
    npm run build      # TypeScript 型チェック + ビルド

- テストが失敗した場合 → 最高優先度のバグとして報告する
- ビルドが失敗した場合 → 型エラーを最高優先度として報告する
- 両方がパスした場合のみステップ 2 に進む

## ステップ 2: コードレビュー（AI レビュー）

1. サンドボックス / 本番パスの一貫性
2. API レスポンスの形状がフロントエンドの期待と一致するか
3. SELECT 句の完全性
4. ロールバック付きのエラー処理
5. オプティミスティックアップデートのレース条件

## ステップ 3: 修正されたバグごとにリグレッションテストを提案する
```

### ワークフロー

```
ユーザー: "バグチェックして" (or "/bug-check")
  │
  ├─ ステップ 1: npm run test
  │   ├─ FAIL → バグが機械的に発見された（AI の判断不要）
  │   └─ PASS → 続行
  │
  ├─ ステップ 2: npm run build
  │   ├─ FAIL → 型エラーが機械的に発見された
  │   └─ PASS → 続行
  │
  ├─ ステップ 3: AI コードレビュー（既知のブラインドスポットを念頭に）
  │   └─ 発見事項が報告される
  │
  └─ ステップ 4: 各修正に対してリグレッションテストを書く
      └─ 次のバグチェックで修正が壊れるか捕捉する
```

## 一般的な AI リグレッションパターン

### パターン 1: サンドボックス/本番パスの不一致

**頻度**: 最も一般的（4 つのリグレッションのうち 3 つで観察）

```typescript
// 失敗: AI が本番パスのみにフィールドを追加する
if (isSandboxMode()) {
  return { data: { id, email, name } };  // 新しいフィールドが欠落
}
// 本番パス
return { data: { id, email, name, notification_settings } };

// 成功: 両方のパスが同じ形状を返す必要がある
if (isSandboxMode()) {
  return { data: { id, email, name, notification_settings: null } };
}
return { data: { id, email, name, notification_settings } };
```

**捕捉するためのテスト**：

```typescript
it("サンドボックスと本番が同じフィールドを返す", async () => {
  // テスト環境では、サンドボックスモードが強制的に ON になる
  const res = await GET(createTestRequest("/api/user/profile"));
  const { json } = await parseResponse(res);

  for (const field of REQUIRED_FIELDS) {
    expect(json.data).toHaveProperty(field);
  }
});
```

### パターン 2: SELECT 句の省略

**頻度**: 新しい列を追加する際の Supabase/Prisma で一般的

```typescript
// 失敗: 新しい列がレスポンスに追加されたが SELECT に含まれていない
const { data } = await supabase
  .from("users")
  .select("id, email, name")  // notification_settings がここにない
  .single();

return { data: { ...data, notification_settings: data.notification_settings } };
// → notification_settings は常に undefined

// 成功: SELECT * を使用するか明示的に新しい列を含める
const { data } = await supabase
  .from("users")
  .select("*")
  .single();
```

### パターン 3: エラー状態の漏洩

**頻度**: 既存のコンポーネントにエラー処理を追加する場合に中程度

```typescript
// 失敗: エラー状態が設定されたが古いデータがクリアされていない
catch (err) {
  setError("Failed to load");
  // reservations は前のタブのデータをまだ表示している！
}

// 成功: エラー時に関連する状態をクリアする
catch (err) {
  setReservations([]);  // 古いデータをクリア
  setError("Failed to load");
}
```

### パターン 4: 適切なロールバックなしのオプティミスティックアップデート

```typescript
// 失敗: 失敗時のロールバックなし
const handleRemove = async (id: string) => {
  setItems(prev => prev.filter(i => i.id !== id));
  await fetch(`/api/items/${id}`, { method: "DELETE" });
  // API が失敗した場合、アイテムは UI から消えるが DB にはまだある
};

// 成功: 前の状態をキャプチャして失敗時にロールバックする
const handleRemove = async (id: string) => {
  const prevItems = [...items];
  setItems(prev => prev.filter(i => i.id !== id));
  try {
    const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("API error");
  } catch {
    setItems(prevItems);  // ロールバック
    alert("削除に失敗しました");
  }
};
```

## 戦略: バグが見つかった場所でテストする

100% カバレッジを目指さない。代わりに：

```
/api/user/profile でバグ発見     → プロファイル API のテストを書く
/api/user/messages でバグ発見    → メッセージ API のテストを書く
/api/user/favorites でバグ発見   → お気に入り API のテストを書く
/api/user/notifications でバグなし → テストを書かない（まだ）
```

**AI 開発でこれが機能する理由：**

1. AI は**同じカテゴリのミス**を繰り返す傾向がある
2. バグは複雑な領域（認証、マルチパスロジック、状態管理）にクラスタリングする
3. 一度テストされると、その正確なリグレッションは**再び発生できない**
4. テスト数はバグ修正とともに有機的に増加する — 無駄な努力なし

## クイックリファレンス

| AI リグレッションパターン | テスト戦略 | 優先度 |
|---|---|---|
| サンドボックス/本番の不一致 | サンドボックスモードで同じレスポンス形状をアサート | 高 |
| SELECT 句の省略 | レスポンス内のすべての必須フィールドをアサート | 高 |
| エラー状態の漏洩 | エラー時の状態クリーンアップをアサート | 中 |
| ロールバック欠如 | API 失敗時に状態が復元されることをアサート | 中 |
| 型キャストが null をマスク | フィールドが undefined でないことをアサート | 中 |

## DO / DON'T

**DO:**
- バグを見つけた後すぐにテストを書く（可能であれば修正前に）
- 実装ではなく API レスポンスの形状をテストする
- すべてのバグチェックの最初のステップとしてテストを実行する
- テストを高速に保つ（サンドボックスモードで合計 1 秒未満）
- 防ぐバグにちなんでテストに名前を付ける（例：「BUG-R1 リグレッション」）

**DON'T:**
- バグが一度もなかったコードのテストを書く
- 自動化されたテストの代替として AI の自己レビューを信頼する
- 「モックデータだから」という理由でサンドボックスパステストをスキップする
- ユニットテストで十分な時に統合テストを書く
- カバレッジのパーセンテージを目指す — リグレッション防止を目指す
