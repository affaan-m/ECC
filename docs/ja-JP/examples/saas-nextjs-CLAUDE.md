# SaaSアプリケーション — プロジェクト CLAUDE.md

> Next.js + Supabase + Stripe SaaSアプリケーションの実世界サンプル。
> これをプロジェクトのルートにコピーしてスタックに合わせてカスタマイズしてください。

## プロジェクト概要

**スタック:** Next.js 15（App Router）, TypeScript, Supabase（認証 + DB）, Stripe（課金）, Tailwind CSS, Playwright（E2E）

**アーキテクチャ:** デフォルトでサーバーコンポーネント。クライアントコンポーネントはインタラクティビティのみ。ウェブフックにはAPIルート、ミューテーションにはサーバーアクションを使用。

## 重要なルール

### データベース

- すべてのクエリはRLSを有効にしたSupabaseクライアントを使用 — RLSを決してバイパスしない
- マイグレーションは `supabase/migrations/` に記述 — データベースを直接変更しない
- `select('*')` ではなく明示的なカラムリストで `select()` を使用する
- すべてのユーザー向けクエリには `.limit()` を含めて無制限の結果を防ぐ

### 認証

- サーバーコンポーネントでは `@supabase/ssr` の `createServerClient()` を使用
- クライアントコンポーネントでは `@supabase/ssr` の `createBrowserClient()` を使用
- 保護されたルートは `getUser()` を確認 — 認証に `getSession()` のみを信頼しない
- `middleware.ts` のミドルウェアはすべてのリクエストで認証トークンを更新する

### 課金

- Stripeウェブフックハンドラーは `app/api/webhooks/stripe/route.ts` に配置
- クライアントサイドの価格データを信頼しない — 常にStripeサーバーサイドから取得する
- サブスクリプションステータスはウェブフックにより同期される `subscription_status` カラムで確認
- 無料ティアユーザー: プロジェクト3件、APIコール100件/日

### コードスタイル

- コードやコメントに絵文字を使用しない
- イミュータブルパターンのみ — スプレッド演算子を使用し、変更しない
- サーバーコンポーネント: `'use client'` ディレクティブなし、`useState`/`useEffect` なし
- クライアントコンポーネント: 先頭に `'use client'`、最小限に保つ — ロジックはフックに抽出する
- APIルート、フォーム、環境変数のすべての入力バリデーションにZodスキーマを優先する

## ファイル構成

```
src/
  app/
    (auth)/          # 認証ページ（ログイン、サインアップ、パスワード忘れ）
    (dashboard)/     # 保護されたダッシュボードページ
    api/
      webhooks/      # Stripe、Supabaseウェブフック
    layout.tsx       # プロバイダー付きルートレイアウト
  components/
    ui/              # Shadcn/uiコンポーネント
    forms/           # バリデーション付きフォームコンポーネント
    dashboard/       # ダッシュボード固有のコンポーネント
  hooks/             # カスタム Reactフック
  lib/
    supabase/        # Supabaseクライアントファクトリー
    stripe/          # Stripeクライアントとヘルパー
    utils.ts         # 汎用ユーティリティ
  types/             # 共有TypeScript型
supabase/
  migrations/        # データベースマイグレーション
  seed.sql           # 開発用シードデータ
```

## 主要なパターン

### APIレスポンス形式

```typescript
type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string }
```

### サーバーアクションパターン

```typescript
'use server'

import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'

const schema = z.object({
  name: z.string().min(1).max(100),
})

export async function createProject(formData: FormData) {
  const parsed = schema.safeParse({ name: formData.get('name') })
  if (!parsed.success) {
    return { success: false, error: parsed.error.flatten() }
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Unauthorized' }

  const { data, error } = await supabase
    .from('projects')
    .insert({ name: parsed.data.name, user_id: user.id })
    .select('id, name, created_at')
    .single()

  if (error) return { success: false, error: 'Failed to create project' }
  return { success: true, data }
}
```

## 環境変数

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # サーバーのみ、クライアントに公開しない

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# アプリ
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## テスト戦略

```bash
/tdd                    # 新機能のユニット + 統合テスト
/e2e                    # 認証フロー、課金、ダッシュボードのPlaywrightテスト
/test-coverage          # 80%以上のカバレッジを確認
```

### 重要なE2Eフロー

1. サインアップ → メール認証 → 最初のプロジェクト作成
2. ログイン → ダッシュボード → CRUD操作
3. プランのアップグレード → Stripeチェックアウト → サブスクリプション有効
4. ウェブフック: サブスクリプションのキャンセル → 無料ティアへのダウングレード

## ECCワークフロー

```bash
# 機能の計画
/plan "Add team invitations with email notifications"

# TDDによる開発
/tdd

# コミット前
/code-review
/security-scan

# リリース前
/e2e
/test-coverage
```

## Git ワークフロー

- `feat:` 新機能、`fix:` バグ修正、`refactor:` コード変更
- `main` からフィーチャーブランチを切り、PRが必要
- CIで実行: リント、型チェック、ユニットテスト、E2Eテスト
- デプロイ: PRのVercelプレビュー、`main` へのマージで本番環境
