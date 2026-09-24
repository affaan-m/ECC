---
name: error-handling
description: TypeScript、Python、Goにわたる堅牢なエラー処理のパターン。型付きエラー、エラー境界、リトライ、サーキットブレーカー、ユーザー向けエラーメッセージをカバーします。
origin: ECC
---

# エラー処理パターン

本番アプリケーション向けの一貫した堅牢なエラー処理パターン。

## アクティベートするタイミング

- 新しいモジュールやサービスのエラー型や例外階層を設計する場合
- 信頼性の低い外部依存関係に対してリトライロジックやサーキットブレーカーを追加する場合
- APIエンドポイントでエラー処理の欠落をレビューする場合
- ユーザー向けエラーメッセージとフィードバックを実装する場合
- カスケード障害やサイレントなエラー飲み込みをデバッグする場合

## コア原則

1. **早く大きく失敗する** — エラーが発生した境界で表面化させる。埋め込まない
2. **文字列メッセージより型付きエラー** — エラーは構造を持つファーストクラスの値
3. **ユーザーメッセージ ≠ 開発者メッセージ** — ユーザーには親しみやすいテキストを表示し、詳細なコンテキストはサーバー側でログに記録する
4. **エラーをサイレントに飲み込まない** — すべての`catch`ブロックは処理、再スロー、またはログのいずれかを行う必要がある
5. **エラーはAPIコントラクトの一部** — クライアントが受け取る可能性があるすべてのエラーコードをドキュメント化する

## TypeScript / JavaScript

### 型付きエラークラス

```typescript
// ドメインのエラー階層を定義する
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = this.constructor.name
    // トランスパイルされたES5 JavaScriptでプロトタイプチェーンを正しく維持する。
    // 組み込みのErrorクラスを拡張する際に`instanceof`チェック
    // （例: `error instanceof NotFoundError`）が正しく動作するために必要。
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404)
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details: { field: string; message: string }[]) {
    super(message, 'VALIDATION_ERROR', 422, details)
  }
}

export class UnauthorizedError extends AppError {
  constructor(reason = 'Authentication required') {
    super(reason, 'UNAUTHORIZED', 401)
  }
}

export class RateLimitError extends AppError {
  constructor(public readonly retryAfterMs: number) {
    super('Rate limit exceeded', 'RATE_LIMITED', 429)
  }
}
```

### Resultパターン（スロー不使用スタイル）

失敗が想定され一般的な操作（パース、外部呼び出し）向け:

```typescript
type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E }

function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

// 使用例
async function fetchUser(id: string): Promise<Result<User>> {
  try {
    const user = await db.users.findUnique({ where: { id } })
    if (!user) return err(new NotFoundError('User', id))
    return ok(user)
  } catch (e) {
    return err(new AppError('Database error', 'DB_ERROR'))
  }
}

const result = await fetchUser('abc-123')
if (!result.ok) {
  // TypeScriptはここでresult.errorを認識する
  logger.error('Failed to fetch user', { error: result.error })
  return
}
// TypeScriptはここでresult.valueを認識する
console.log(result.value.email)
```

### APIエラーハンドラー（Next.js / Express）

```typescript
import { NextRequest, NextResponse } from 'next/server'

function handleApiError(error: unknown): NextResponse {
  // 既知のアプリケーションエラー
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.statusCode },
    )
  }

  // Zodバリデーションエラー
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.issues.map(i => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        },
      },
      { status: 422 },
    )
  }

  // 予期しないエラー — 詳細をログに記録し、汎用メッセージを返す
  console.error('Unexpected error:', error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
    { status: 500 },
  )
}

export async function POST(req: NextRequest) {
  try {
    // ... ハンドラーロジック
  } catch (error) {
    return handleApiError(error)
  }
}
```

### ReactエラーバウンダリーII

```typescript
import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  fallback: ReactNode
  onError?: (error: Error, info: ErrorInfo) => void
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info)
    console.error('Unhandled React error:', error, info)
  }

  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

// 使用例
<ErrorBoundary fallback={<p>Something went wrong. Please refresh.</p>}>
  <MyComponent />
</ErrorBoundary>
```

## Python

### カスタム例外階層

```python
class AppError(Exception):
    """基底アプリケーションエラー。"""
    def __init__(self, message: str, code: str, status_code: int = 500):
        super().__init__(message)
        self.code = code
        self.status_code = status_code

class NotFoundError(AppError):
    def __init__(self, resource: str, id: str):
        super().__init__(f"{resource} not found: {id}", "NOT_FOUND", 404)

class ValidationError(AppError):
    def __init__(self, message: str, details: list[dict] | None = None):
        super().__init__(message, "VALIDATION_ERROR", 422)
        self.details = details or []
```

### FastAPIグローバル例外ハンドラー

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI()

@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": str(exc)}},
    )

@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception) -> JSONResponse:
    # 詳細をログに記録し、汎用メッセージを返す
    logger.exception("Unexpected error", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred"}},
    )
```

## Go

### センチネルエラーとエラーラッピング

```go
package domain

import "errors"

// 型チェック用センチネルエラー
var (
    ErrNotFound    = errors.New("not found")
    ErrUnauthorized = errors.New("unauthorized")
    ErrConflict     = errors.New("conflict")
)

// コンテキスト付きでエラーをラップする — 元のエラーを失わない
func (r *UserRepository) FindByID(ctx context.Context, id string) (*User, error) {
    user, err := r.db.QueryRow(ctx, "SELECT * FROM users WHERE id = $1", id)
    if errors.Is(err, sql.ErrNoRows) {
        return nil, fmt.Errorf("user %s: %w", id, ErrNotFound)
    }
    if err != nil {
        return nil, fmt.Errorf("querying user %s: %w", id, err)
    }
    return user, nil
}

// ハンドラーレベルでアンラップしてレスポンスを決定する
func (h *Handler) GetUser(w http.ResponseWriter, r *http.Request) {
    user, err := h.service.GetUser(r.Context(), chi.URLParam(r, "id"))
    if err != nil {
        switch {
        case errors.Is(err, domain.ErrNotFound):
            writeError(w, http.StatusNotFound, "not_found", err.Error())
        case errors.Is(err, domain.ErrUnauthorized):
            writeError(w, http.StatusForbidden, "forbidden", "Access denied")
        default:
            slog.Error("unexpected error", "err", err)
            writeError(w, http.StatusInternalServerError, "internal_error", "An unexpected error occurred")
        }
        return
    }
    writeJSON(w, http.StatusOK, user)
}
```

## 指数バックオフ付きリトライ

```typescript
interface RetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  retryIf?: (error: unknown) => boolean
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 10_000,
    retryIf = () => true,
  } = options

  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === maxAttempts || !retryIf(error)) throw error

      const jitter = Math.random() * baseDelayMs
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1) + jitter, maxDelayMs)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

// 使用例: 一時的なネットワークエラーはリトライ、4xxはリトライしない
const data = await withRetry(() => fetch('/api/data').then(r => r.json()), {
  maxAttempts: 3,
  retryIf: (error) => !(error instanceof AppError && error.statusCode < 500),
})
```

## ユーザー向けエラーメッセージ

エラーコードを人間が読めるメッセージにマッピングする。技術的な詳細はユーザーに見えるテキストに含めない。

```typescript
const USER_ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: 'The requested item could not be found.',
  UNAUTHORIZED: 'Please sign in to continue.',
  FORBIDDEN: "You don't have permission to do that.",
  VALIDATION_ERROR: 'Please check your input and try again.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  INTERNAL_ERROR: 'Something went wrong on our end. Please try again later.',
}

export function getUserMessage(code: string): string {
  return USER_ERROR_MESSAGES[code] ?? USER_ERROR_MESSAGES.INTERNAL_ERROR
}
```

## エラー処理チェックリスト

エラー処理に触れるコードをマージする前に:

- [ ] すべての`catch`ブロックが処理、再スロー、またはログを行っている — サイレントな飲み込みなし
- [ ] APIエラーが標準エンベロープ`{ error: { code, message } }`に従っている
- [ ] ユーザー向けメッセージにスタックトレースや内部詳細が含まれていない
- [ ] サーバー側で完全なエラーコンテキストがログに記録されている
- [ ] カスタムエラークラスが`code`フィールドを持つ基底`AppError`を継承している
- [ ] 非同期関数がエラーを呼び出し元に伝播している — フォールバックなしの fire-and-forget なし
- [ ] リトライロジックがリトライ可能なエラーのみをリトライしている（4xxクライアントエラーはリトライしない）
- [ ] Reactコンポーネントがレンダリングエラーのために`ErrorBoundary`でラップされている
