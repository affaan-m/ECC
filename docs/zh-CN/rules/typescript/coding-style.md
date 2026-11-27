---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# TypeScript/JavaScript 编码风格

> 本文件基于 [common/coding-style.md](../common/coding-style.md) 扩展，包含 TypeScript/JavaScript 特定内容。

## 类型与接口

使用类型使公共 API、共享模型和组件属性显式化、可读且可复用。

### 公共 API

* 为导出的函数、共享工具函数和公共类方法添加参数类型和返回类型
* 让 TypeScript 推断明显的局部变量类型
* 将重复的内联对象结构提取为命名类型或接口

```typescript
// WRONG: Exported function without explicit types
export function formatUser(user) {
  return `${user.firstName} ${user.lastName}`
}

// CORRECT: Explicit types on public APIs
interface User {
  firstName: string
  lastName: string
}

export function formatUser(user: User): string {
  return `${user.firstName} ${user.lastName}`
}
```

### 接口与类型别名

* 使用 `interface` 定义可能被扩展或实现的对象结构
* 使用 `type` 定义联合类型、交叉类型、元组、映射类型和工具类型
* 优先使用字符串字面量联合类型而非 `enum`，除非需要 `enum` 以实现互操作性

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

### 避免使用 `any`

* 在应用程序代码中避免使用 `any`
* 对外部或不受信任的输入使用 `unknown`，然后安全地缩小其类型范围
* 当值的类型依赖于调用者时，使用泛型

```typescript
// WRONG: any removes type safety
function getErrorMessage(error: any) {
  return error.message
}

// CORRECT: unknown forces safe narrowing
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unexpected error'
}
```

### React 属性

* 使用命名的 `interface` 或 `type` 定义组件属性
* 显式地定义回调属性类型
* 除非有特定原因，否则不要使用 `React.FC`

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

### JavaScript 文件

* 在 `.js` 和 `.jsx` 文件中，当类型能提高清晰度且迁移到 TypeScript 不可行时，使用 JSDoc
* 保持 JSDoc 与运行时行为一致

```javascript
/**
 * @param {{ firstName: string, lastName: string }} user
 * @returns {string}
 */
export function formatUser(user) {
  return `${user.firstName} ${user.lastName}`
}
```

## 不可变性

使用展开运算符进行不可变更新：

```typescript
interface User {
  id: string
  name: string
}

// WRONG: Mutation
function updateUser(user: User, name: string): User {
  user.name = name // MUTATION!
  return user
}

// CORRECT: Immutability
function updateUser(user: Readonly<User>, name: string): User {
  return {
    ...user,
    name
  }
}
```

## 错误处理

使用 async/await 配合 try-catch 并安全地缩小未知错误类型范围：

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
    // Replace with your production logger (for example, pino or winston).
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

## 输入验证

使用 Zod 进行基于模式的验证，并从模式推断类型：

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

* 生产代码中不允许出现 `console.log` 语句
* 请使用适当的日志库替代
* 查看钩子以进行自动检测
