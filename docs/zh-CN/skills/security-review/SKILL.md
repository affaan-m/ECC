---
name: security-review
description: 在添加身份验证、处理用户输入、处理机密信息、创建API端点或实现支付/敏感功能时使用此技能。提供全面的安全检查清单和模式。
origin: ECC
---

# 安全审查技能

此技能确保所有代码遵循安全最佳实践，并识别潜在漏洞。

## 何时激活

* 实现身份验证或授权时
* 处理用户输入或文件上传时
* 创建新的 API 端点时
* 处理密钥或凭据时
* 实现支付功能时
* 存储或传输敏感数据时
* 集成第三方 API 时

## 安全检查清单

### 1. 密钥管理

#### FAIL: 绝对不要这样做

```typescript
const apiKey = "sk-proj-xxxxx"  // Hardcoded secret
const dbPassword = "password123" // In source code
```

#### PASS: 始终这样做

```typescript
const apiKey = process.env.OPENAI_API_KEY
const dbUrl = process.env.DATABASE_URL

// Verify secrets exist
if (!apiKey) {
  throw new Error('OPENAI_API_KEY not configured')
}
```

#### 验证步骤

* \[ ] 没有硬编码的 API 密钥、令牌或密码
* \[ ] 所有密钥都存储在环境变量中
* \[ ] `.env` 文件在 .gitignore 中
* \[ ] git 历史记录中没有密钥
* \[ ] 生产环境密钥存储在托管平台中（Vercel, Railway）

### 2. 输入验证

#### 始终验证用户输入

```typescript
import { z } from 'zod'

// Define validation schema
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  age: z.number().int().min(0).max(150)
})

// Validate before processing
export async function createUser(input: unknown) {
  try {
    const validated = CreateUserSchema.parse(input)
    return await db.users.create(validated)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, errors: error.errors }
    }
    throw error
  }
}
```

#### 文件上传验证

```typescript
function validateFileUpload(file: File) {
  // Size check (5MB max)
  const maxSize = 5 * 1024 * 1024
  if (file.size > maxSize) {
    throw new Error('File too large (max 5MB)')
  }

  // Type check
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif']
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Invalid file type')
  }

  // Extension check
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif']
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0]
  if (!extension || !allowedExtensions.includes(extension)) {
    throw new Error('Invalid file extension')
  }

  return true
}
```

#### 验证步骤

* \[ ] 所有用户输入都使用模式进行了验证
* \[ ] 文件上传受到限制（大小、类型、扩展名）
* \[ ] 查询中没有直接使用用户输入
* \[ ] 使用白名单验证（而非黑名单）
* \[ ] 错误消息不会泄露敏感信息

### 3. SQL 注入防护

#### FAIL: 绝对不要拼接 SQL

```typescript
// DANGEROUS - SQL Injection vulnerability
const query = `SELECT * FROM users WHERE email = '${userEmail}'`
await db.query(query)
```

#### PASS: 始终使用参数化查询

```typescript
// Safe - parameterized query
const { data } = await supabase
  .from('users')
  .select('*')
  .eq('email', userEmail)

// Or with raw SQL
await db.query(
  'SELECT * FROM users WHERE email = $1',
  [userEmail]
)
```

#### 验证步骤

* \[ ] 所有数据库查询都使用参数化查询
* \[ ] SQL 中没有字符串拼接
* \[ ] 正确使用 ORM/查询构建器
* \[ ] Supabase 查询已正确清理

### 4. 身份验证与授权

#### JWT 令牌处理

```typescript
// FAIL: WRONG: localStorage (vulnerable to XSS)
localStorage.setItem('token', token)

// PASS: CORRECT: httpOnly cookies
res.setHeader('Set-Cookie',
  `token=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`)
```

#### 授权检查

```typescript
export async function deleteUser(userId: string, requesterId: string) {
  // ALWAYS verify authorization first
  const requester = await db.users.findUnique({
    where: { id: requesterId }
  })

  if (requester.role !== 'admin') {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 403 }
    )
  }

  // Proceed with deletion
  await db.users.delete({ where: { id: userId } })
}
```

#### 行级安全（Supabase）

```sql
-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users can only view their own data
CREATE POLICY "Users view own data"
  ON users FOR SELECT
  USING (auth.uid() = id);

-- Users can only update their own data
CREATE POLICY "Users update own data"
  ON users FOR UPDATE
  USING (auth.uid() = id);
```

#### 验证步骤

* \[ ] 令牌存储在 httpOnly cookie 中（而非 localStorage）
* \[ ] 执行敏感操作前进行授权检查
* \[ ] Supabase 中启用了行级安全
* \[ ] 实现了基于角色的访问控制
* \[ ] 会话管理安全

### 5. XSS 防护

#### 清理 HTML

```typescript
import DOMPurify from 'isomorphic-dompurify'

// ALWAYS sanitize user-provided HTML
function renderUserContent(html: string) {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p'],
    ALLOWED_ATTR: []
  })
  return <div dangerouslySetInnerHTML={{ __html: clean }} />
}
```

#### 内容安全策略

```typescript
// next.config.js
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: `
      default-src 'self';
      script-src 'self' 'unsafe-eval' 'unsafe-inline';
      style-src 'self' 'unsafe-inline';
      img-src 'self' data: https:;
      font-src 'self';
      connect-src 'self' https://api.example.com;
    `.replace(/\s{2,}/g, ' ').trim()
  }
]
```

#### 验证步骤

* \[ ] 用户提供的 HTML 已被清理
* \[ ] 已配置 CSP 头部
* \[ ] 没有渲染未经验证的动态内容
* \[ ] 使用了 React 内置的 XSS 防护

### 6. CSRF 防护

#### CSRF 令牌

```typescript
import { csrf } from '@/lib/csrf'

export async function POST(request: Request) {
  const token = request.headers.get('X-CSRF-Token')

  if (!csrf.verify(token)) {
    return NextResponse.json(
      { error: 'Invalid CSRF token' },
      { status: 403 }
    )
  }

  // Process request
}
```

#### SameSite Cookie

```typescript
res.setHeader('Set-Cookie',
  `session=${sessionId}; HttpOnly; Secure; SameSite=Strict`)
```

#### 验证步骤

* \[ ] 状态变更操作上使用了 CSRF 令牌
* \[ ] 所有 Cookie 都设置了 SameSite=Strict
* \[ ] 实现了双重提交 Cookie 模式

### 7. 速率限制

#### API 速率限制

```typescript
import rateLimit from 'express-rate-limit'

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many requests'
})

// Apply to routes
app.use('/api/', limiter)
```

#### 昂贵操作

```typescript
// Aggressive rate limiting for searches
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: 'Too many search requests'
})

app.use('/api/search', searchLimiter)
```

#### 验证步骤

* \[ ] 所有 API 端点都实施了速率限制
* \[ ] 对昂贵操作有更严格的限制
* \[ ] 基于 IP 的速率限制
* \[ ] 基于用户的速率限制（已认证）

### 8. 敏感数据泄露

#### 日志记录

```typescript
// FAIL: WRONG: Logging sensitive data
console.log('User login:', { email, password })
console.log('Payment:', { cardNumber, cvv })

// PASS: CORRECT: Redact sensitive data
console.log('User login:', { email, userId })
console.log('Payment:', { last4: card.last4, userId })
```

#### 错误消息

```typescript
// FAIL: WRONG: Exposing internal details
catch (error) {
  return NextResponse.json(
    { error: error.message, stack: error.stack },
    { status: 500 }
  )
}

// PASS: CORRECT: Generic error messages
catch (error) {
  console.error('Internal error:', error)
  return NextResponse.json(
    { error: 'An error occurred. Please try again.' },
    { status: 500 }
  )
}
```

#### 验证步骤

* \[ ] 日志中没有密码、令牌或密钥
* \[ ] 对用户显示通用错误消息
* \[ ] 详细错误信息仅在服务器日志中
* \[ ] 没有向用户暴露堆栈跟踪

### 9. 区块链安全（Solana）

#### 钱包验证

```typescript
import { verify } from '@solana/web3.js'

async function verifyWalletOwnership(
  publicKey: string,
  signature: string,
  message: string
) {
  try {
    const isValid = verify(
      Buffer.from(message),
      Buffer.from(signature, 'base64'),
      Buffer.from(publicKey, 'base64')
    )
    return isValid
  } catch (error) {
    return false
  }
}
```

#### 交易验证

```typescript
async function verifyTransaction(transaction: Transaction) {
  // Verify recipient
  if (transaction.to !== expectedRecipient) {
    throw new Error('Invalid recipient')
  }

  // Verify amount
  if (transaction.amount > maxAmount) {
    throw new Error('Amount exceeds limit')
  }

  // Verify user has sufficient balance
  const balance = await getBalance(transaction.from)
  if (balance < transaction.amount) {
    throw new Error('Insufficient balance')
  }

  return true
}
```

#### 验证步骤

* \[ ] 已验证钱包签名
* \[ ] 已验证交易详情
* \[ ] 交易前检查余额
* \[ ] 没有盲签名交易

### 10. 依赖项安全

#### 定期更新

```bash
# Check for vulnerabilities
npm audit

# Fix automatically fixable issues
npm audit fix

# Update dependencies
npm update

# Check for outdated packages
npm outdated
```

#### 锁定文件

```bash
# ALWAYS commit lock files
git add package-lock.json

# Use in CI/CD for reproducible builds
npm ci  # Instead of npm install
```

#### 验证步骤

* \[ ] 依赖项是最新的
* \[ ] 没有已知漏洞（npm audit 检查通过）
* \[ ] 提交了锁定文件
* \[ ] GitHub 上启用了 Dependabot
* \[ ] 定期进行安全更新

## 安全测试

### 自动化安全测试

```typescript
// Test authentication
test('requires authentication', async () => {
  const response = await fetch('/api/protected')
  expect(response.status).toBe(401)
})

// Test authorization
test('requires admin role', async () => {
  const response = await fetch('/api/admin', {
    headers: { Authorization: `Bearer ${userToken}` }
  })
  expect(response.status).toBe(403)
})

// Test input validation
test('rejects invalid input', async () => {
  const response = await fetch('/api/users', {
    method: 'POST',
    body: JSON.stringify({ email: 'not-an-email' })
  })
  expect(response.status).toBe(400)
})

// Test rate limiting
test('enforces rate limits', async () => {
  const requests = Array(101).fill(null).map(() =>
    fetch('/api/endpoint')
  )

  const responses = await Promise.all(requests)
  const tooManyRequests = responses.filter(r => r.status === 429)

  expect(tooManyRequests.length).toBeGreaterThan(0)
})
```

## 部署前安全检查清单

在任何生产环境部署前：

* \[ ] **密钥**：没有硬编码的密钥，全部在环境变量中
* \[ ] **输入验证**：所有用户输入都已验证
* \[ ] **SQL 注入**：所有查询都已参数化
* \[ ] **XSS**：用户内容已被清理
* \[ ] **CSRF**：已启用防护
* \[ ] **身份验证**：正确处理令牌
* \[ ] **授权**：已实施角色检查
* \[ ] **速率限制**：所有端点都已启用
* \[ ] **HTTPS**：在生产环境中强制执行
* \[ ] **安全头部**：已配置 CSP、X-Frame-Options
* \[ ] **错误处理**：错误中不包含敏感数据
* \[ ] **日志记录**：日志中不包含敏感数据
* \[ ] **依赖项**：已更新，无漏洞
* \[ ] **行级安全**：Supabase 中已启用
* \[ ] **CORS**：已正确配置
* \[ ] **文件上传**：已验证（大小、类型）
* \[ ] **钱包签名**：已验证（如果涉及区块链）

## 资源

* [OWASP Top 10](https://owasp.org/www-project-top-ten/)
* [Next.js 安全](https://nextjs.org/docs/security)
* [Supabase 安全](https://supabase.com/docs/guides/auth)
* [Web 安全学院](https://portswigger.net/web-security)

***

**请记住**：安全不是可选项。一个漏洞就可能危及整个平台。如有疑问，请谨慎行事。
