---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# TypeScript/JavaScript コーディングスタイル

> このファイルは [common/coding-style.md](../common/coding-style.md) を TypeScript/JavaScript 固有のコンテンツで拡張します。

## 型とインターフェース

パブリック API、共有モデル、コンポーネント props を明示的、可読的、再利用可能にするために型を使用する。

### パブリック API

- エクスポートされる関数、共有ユーティリティ、パブリッククラスメソッドにパラメータ型と戻り値型を追加する
- 明白なローカル変数の型は TypeScript に推論させる
- 繰り返されるインラインオブジェクトシェイプは名前付き型またはインターフェースに抽出する

```typescript
// 間違い: 明示的な型のないエクスポート関数
export function formatUser(user) {
  return `${user.firstName} ${user.lastName}`
}

// 正しい: パブリック API での明示的な型
interface User {
  firstName: string
  lastName: string
}

export function formatUser(user: User): string {
  return `${user.firstName} ${user.lastName}`
}
```

### インターフェース vs 型エイリアス

- 拡張または実装される可能性のあるオブジェクトシェイプには `interface` を使用する
- ユニオン、インターセクション、タプル、マップ型、ユーティリティ型には `type` を使用する
- 相互運用性のために `enum` が必要でない限り、`enum` よりも文字列リテラルユニオンを優先する

```typescript
interface User {
  id: string
  email: string
}

type UserRole = 'admin' | 'member'
type UserWithRole = User & {
  role: UserRole
}
```

### `any` の回避

- アプリケーションコードで `any` を避ける
- 外部または信頼されない入力には `unknown` を使用し、安全にナローイングする
- 値の型が呼び出し側に依存する場合はジェネリクスを使用する

```typescript
// 間違い: any は型安全性を除去する
function getErrorMessage(error: any) {
  return error.message
}

// 正しい: unknown は安全なナローイングを強制する
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unexpected error'
}
```

### React Props

- コンポーネント props は名前付き `interface` または `type` で定義する
- コールバック props は明示的に型付けする
- 特定の理由がない限り `React.FC` を使用しない

```typescript
interface User {
  id: string
  email: string
}

interface UserCardProps {
  user: User
  onSelect: (id: string) => void
}

function UserCard({ user, onSelect }: UserCardProps) {
  return <button onClick={() => onSelect(user.id)}>{user.email}</button>
}
```

### JavaScript ファイル

- `.js` および `.jsx` ファイルでは、型が明確さを向上させ TypeScript への移行が実用的でない場合に JSDoc を使用する
- JSDoc をランタイム動作と整合させる

```javascript
/**
 * @param {{ firstName: string, lastName: string }} user
 * @returns {string}
 */
export function formatUser(user) {
  return `${user.firstName} ${user.lastName}`
}
```

## 不変性

不変な更新にはスプレッド演算子を使用する:

```typescript
interface User {
  id: string
  name: string
}

// 間違い: ミューテーション
function updateUser(user: User, name: string): User {
  user.name = name // ミューテーション！
  return user
}

// 正しい: 不変性
function updateUser(user: Readonly<User>, name: string): User {
  return {
    ...user,
    name
  }
}
```

## エラーハンドリング

async/await と try-catch を使用し、unknown エラーを安全にナローイングする:

```typescript
interface User {
  id: string
  email: string
}

declare function riskyOperation(userId: string): Promise<User>

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unexpected error'
}

const logger = {
  error: (message: string, error: unknown) => {
    // 本番用ロガー（例: pino や winston）に置き換えてください。
  }
}

async function loadUser(userId: string): Promise<User> {
  try {
    const result = await riskyOperation(userId)
    return result
  } catch (error: unknown) {
    logger.error('Operation failed', error)
    throw new Error(getErrorMessage(error))
  }
}
```

## 入力バリデーション

スキーマベースのバリデーションには Zod を使用し、スキーマから型を推論する:

```typescript
import { z } from 'zod'

const userSchema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0).max(150)
})

type UserInput = z.infer<typeof userSchema>

const validated: UserInput = userSchema.parse(input)
```

## Console.log

- 本番コードに `console.log` 文を残さない
- 代わりに適切なロギングライブラリを使用する
- 自動検出についてはフックを参照
