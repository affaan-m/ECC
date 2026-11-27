---
name: security-review
description: 認証の追加、ユーザー入力の処理、シークレットの操作、APIエンドポイントの作成、支払い/機密機能の実装時にこのスキルを使用します。包括的なセキュリティチェックリストとパターンを提供します。
---

# セキュリティレビュースキル

このスキルは、すべてのコードがセキュリティのベストプラクティスに従い、潜在的な脆弱性を特定することを保証します。

## 有効化するタイミング

- 認証または認可の実装
- ユーザー入力またはファイルアップロードの処理
- 新しいAPIエンドポイントの作成
- シークレットまたは資格情報の操作
- 支払い機能の実装
- 機密データの保存または送信
- サードパーティAPIの統合

## セキュリティチェックリスト

### 1. シークレット管理

#### FAIL: 絶対にしないこと
```typescript
const apiKey = "sk-proj-xxxxx"  // ハードコードされたシークレット
const dbPassword = "password123" // ソースコード内
```

#### PASS: 常にすること
```typescript
const apiKey = process.env.OPENAI_API_KEY
const dbUrl = process.env.DATABASE_URL

// シークレットが存在することを確認
if (!apiKey) {
  throw new Error('OPENAI_API_KEY not configured')
}
```

#### 検証ステップ
- [ ] ハードコードされたAPIキー、トークン、パスワードなし
- [ ] すべてのシークレットを環境変数に
- [ ] `.env.local`を.gitignoreに
- [ ] git履歴にシークレットなし
- [ ] 本番シークレットはホスティングプラットフォーム（Vercel、Railway）に

### 2. 入力検証

#### 常にユーザー入力を検証
```typescript
import { z } from 'zod'

// 検証スキーマを定義
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  age: z.number().int().min(0).max(150)
})

// 処理前に検証
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

#### ファイルアップロード検証
```typescript
function validateFileUpload(file: File) {
  // サイズチェック（最大5MB）
  const maxSize = 5 * 1024 * 1024
  if (file.size > maxSize) {
    throw new Error('File too large (max 5MB)')
  }

  // タイプチェック
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif']
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Invalid file type')
  }

  // 拡張子チェック
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif']
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0]
  if (!extension || !allowedExtensions.includes(extension)) {
    throw new Error('Invalid file extension')
  }

  return true
}
```

#### 検証ステップ
- [ ] すべてのユーザー入力をスキーマで検証
- [ ] ファイルアップロードを制限（サイズ、タイプ、拡張子）
- [ ] クエリでのユーザー入力の直接使用なし
- [ ] ホワイトリスト検証（ブラックリストではなく）
- [ ] エラーメッセージが機密情報を漏らさない

### 3. SQLインジェクション防止

#### FAIL: 絶対にSQLを連結しない
```typescript
// 危険 - SQLインジェクションの脆弱性
const query = `SELECT * FROM users WHERE email = '${userEmail}'`
await db.query(query)
```

#### PASS: 常にパラメータ化されたクエリを使用
```typescript
// 安全 - パラメータ化されたクエリ
const { data } = await supabase
  .from('users')
  .select('*')
  .eq('email', userEmail)

// または生のSQLで
await db.query(
  'SELECT * FROM users WHERE email = $1',
  [userEmail]
)
```

#### 検証ステップ
- [ ] すべてのデータベースクエリがパラメータ化されたクエリを使用
- [ ] SQLでの文字列連結なし
- [ ] ORM/クエリビルダーを正しく使用
- [ ] Supabaseクエリが適切にサニタイズされている

### 4. 認証と認可

#### JWTトークン処理
```typescript
// FAIL: 誤り：localStorage（XSSに脆弱）
localStorage.setItem('token', token)

// PASS: 正解：httpOnly Cookie
res.setHeader('Set-Cookie',
  `token=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`)
```

#### 認可チェック
```typescript
export async function deleteUser(userId: string, requesterId: string) {
  // 常に最初に認可を確認
  const requester = await db.users.findUnique({
    where: { id: requesterId }
  })

  if (requester.role !== 'admin') {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 403 }
    )
  }

  // 削除を続行
  await db.users.delete({ where: { id: userId } })
}
```

#### 行レベルセキュリティ (Supabase)
```sql
-- すべてのテーブルでRLSを有効化
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- ユーザーは自分のデータのみを表示できる
CREATE POLICY "Users view own data"
  ON users FOR SELECT
  USING (auth.uid() = id);

-- ユーザーは自分のデータのみを更新できる
CREATE POLICY "Users update own data"
  ON users FOR UPDATE
  USING (auth.uid() = id);
```

#### 検証ステップ
- [ ] トークンはhttpOnly Cookieに保存（localStorageではなく）
- [ ] 機密操作前の認可チェック
- [ ] SupabaseでRow Level Securityを有効化
- [ ] ロールベースのアクセス制御を実装
- [ ] セッション管理が安全

### 5. XSS防止

#### HTMLをサニタイズ
```typescript
import DOMPurify from 'isomorphic-dompurify'

// 常にユーザー提供のHTMLをサニタイズ
function renderUserContent(html: string) {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p'],
    ALLOWED_ATTR: []
  })
  return <div dangerouslySetInnerHTML={{ __html: clean }} />
}
```

#### コンテンツセキュリティポリシー
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

#### 検証ステップ
- [ ] ユーザー提供のHTMLをサニタイズ
- [ ] CSPヘッダーを設定
- [ ] 検証されていない動的コンテンツのレンダリングなし
- [ ] Reactの組み込みXSS保護を使用

### 6. CSRF保護

#### CSRFトークン
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

  // リクエストを処理
}
```

#### SameSite Cookie
```typescript
res.setHeader('Set-Cookie',
  `session=${sessionId}; HttpOnly; Secure; SameSite=Strict`)
```

#### 検証ステップ
- [ ] 状態変更操作でCSRFトークン
- [ ] すべてのCookieでSameSite=Strict
- [ ] ダブルサブミットCookieパターンを実装

### 7. レート制限

#### APIレート制限
```typescript
import rateLimit from 'express-rate-limit'

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分
  max: 100, // ウィンドウあたり100リクエスト
  message: 'Too many requests'
})

// ルートに適用
app.use('/api/', limiter)
```

#### 高コスト操作
```typescript
// 検索の積極的なレート制限
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分
  max: 10, // 1分あたり10リクエスト
  message: 'Too many search requests'
})

app.use('/api/search', searchLimiter)
```

#### 検証ステップ
- [ ] すべてのAPIエンドポイントでレート制限
- [ ] 高コスト操作でより厳しい制限
- [ ] IPベースのレート制限
- [ ] ユーザーベースのレート制限（認証済み）

### 8. 機密データの露出

#### ロギング
```typescript
// FAIL: 誤り：機密データをログに記録
console.log('User login:', { email, password })
console.log('Payment:', { cardNumber, cvv })

// PASS: 正解：機密データを編集
console.log('User login:', { email, userId })
console.log('Payment:', { last4: card.last4, userId })
```

#### エラーメッセージ
```typescript
// FAIL: 誤り：内部詳細を露出
catch (error) {
  return NextResponse.json(
    { error: error.message, stack: error.stack },
    { status: 500 }
  )
}

// PASS: 正解：一般的なエラーメッセージ
catch (error) {
  console.error('Internal error:', error)
  return NextResponse.json(
    { error: 'An error occurred. Please try again.' },
    { status: 500 }
  )
}
```

#### 検証ステップ
- [ ] ログにパスワード、トークン、シークレットなし
- [ ] ユーザー向けの一般的なエラーメッセージ
- [ ] 詳細なエラーはサーバーログのみ
- [ ] ユーザーにスタックトレースを露出しない

### 9. ブロックチェーンセキュリティ (Solana)

#### ウォレット検証
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

#### トランザクション検証
```typescript
async function verifyTransaction(transaction: Transaction) {
  // 受信者を検証
  if (transaction.to !== expectedRecipient) {
    throw new Error('Invalid recipient')
  }

  // 金額を検証
  if (transaction.amount > maxAmount) {
    throw new Error('Amount exceeds limit')
  }

  // ユーザーに十分な残高があることを確認
  const balance = await getBalance(transaction.from)
  if (balance < transaction.amount) {
    throw new Error('Insufficient balance')
  }

  return true
}
```

#### 検証ステップ
- [ ] ウォレット署名を検証
- [ ] トランザクション詳細を検証
- [ ] トランザクション前の残高チェック
- [ ] ブラインドトランザクション署名なし

### 10. 依存関係セキュリティ

#### 定期的な更新
```bash
# 脆弱性をチェック
npm audit

# 自動修正可能な問題を修正
npm audit fix

# 依存関係を更新
npm update

# 古いパッケージをチェック
npm outdated
```

#### ロックファイル
```bash
# 常にロックファイルをコミット
git add package-lock.json

# CI/CDで再現可能なビルドに使用
npm ci  # npm installの代わりに
```

#### 検証ステップ
- [ ] 依存関係が最新
- [ ] 既知の脆弱性なし（npm auditクリーン）
- [ ] ロックファイルをコミット
- [ ] GitHubでDependabotを有効化
- [ ] 定期的なセキュリティ更新

## セキュリティテスト

### 自動セキュリティテスト
```typescript
// 認証をテスト
test('requires authentication', async () => {
  const response = await fetch('/api/protected')
  expect(response.status).toBe(401)
})

// 認可をテスト
test('requires admin role', async () => {
  const response = await fetch('/api/admin', {
    headers: { Authorization: `Bearer ${userToken}` }
  })
  expect(response.status).toBe(403)
})

// 入力検証をテスト
test('rejects invalid input', async () => {
  const response = await fetch('/api/users', {
    method: 'POST',
    body: JSON.stringify({ email: 'not-an-email' })
  })
  expect(response.status).toBe(400)
})

// レート制限をテスト
test('enforces rate limits', async () => {
  const requests = Array(101).fill(null).map(() =>
    fetch('/api/endpoint')
  )

  const responses = await Promise.all(requests)
  const tooManyRequests = responses.filter(r => r.status === 429)

  expect(tooManyRequests.length).toBeGreaterThan(0)
})
```

## デプロイ前セキュリティチェックリスト

すべての本番デプロイメントの前に：

- [ ] **シークレット**：ハードコードされたシークレットなし、すべて環境変数に
- [ ] **入力検証**：すべてのユーザー入力を検証
- [ ] **SQLインジェクション**：すべてのクエリをパラメータ化
- [ ] **XSS**：ユーザーコンテンツをサニタイズ
- [ ] **CSRF**：保護を有効化
- [ ] **認証**：適切なトークン処理
- [ ] **認可**：ロールチェックを配置
- [ ] **レート制限**：すべてのエンドポイントで有効化
- [ ] **HTTPS**：本番で強制
- [ ] **セキュリティヘッダー**：CSP、X-Frame-Optionsを設定
- [ ] **エラー処理**：エラーに機密データなし
- [ ] **ロギング**：ログに機密データなし
- [ ] **依存関係**：最新、脆弱性なし
- [ ] **Row Level Security**：Supabaseで有効化
- [ ] **CORS**：適切に設定
- [ ] **ファイルアップロード**：検証済み（サイズ、タイプ）
- [ ] **ウォレット署名**：検証済み（ブロックチェーンの場合）

## リソース

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Next.js Security](https://nextjs.org/docs/security)
- [Supabase Security](https://supabase.com/docs/guides/auth)
- [Web Security Academy](https://portswigger.net/web-security)

---

**覚えておいてください**：セキュリティはオプションではありません。1つの脆弱性がプラットフォーム全体を危険にさらす可能性があります。疑わしい場合は、慎重に判断してください。
