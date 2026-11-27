---
name: security-review
description: 인증 추가, 사용자 입력 처리, 시크릿 관리, API 엔드포인트 생성, 결제/민감한 기능 구현 시 이 스킬을 사용하세요. 포괄적인 보안 체크리스트와 패턴을 제공합니다.
origin: ECC
---

# 보안 리뷰 스킬

이 스킬은 모든 코드가 보안 모범 사례를 따르고 잠재적 취약점을 식별하도록 보장합니다.

## 활성화 시점

- 인증 또는 권한 부여 구현 시
- 사용자 입력 또는 파일 업로드 처리 시
- 새로운 API 엔드포인트 생성 시
- 시크릿 또는 자격 증명 작업 시
- 결제 기능 구현 시
- 민감한 데이터 저장 또는 전송 시
- 서드파티 API 통합 시

## 보안 체크리스트

### 1. 시크릿 관리

#### 절대 하지 말아야 할 것
```typescript
const apiKey = "sk-proj-xxxxx"  // Hardcoded secret
const dbPassword = "password123" // In source code
```

#### 반드시 해야 할 것
```typescript
const apiKey = process.env.OPENAI_API_KEY
const dbUrl = process.env.DATABASE_URL

// Verify secrets exist
if (!apiKey) {
  throw new Error('OPENAI_API_KEY not configured')
}
```

#### 확인 단계
- [ ] 하드코딩된 API 키, 토큰, 비밀번호 없음
- [ ] 모든 시크릿이 환경 변수에 저장됨
- [ ] `.env.local`이 .gitignore에 포함됨
- [ ] git 히스토리에 시크릿 없음
- [ ] 프로덕션 시크릿이 호스팅 플랫폼(Vercel, Railway)에 저장됨

### 2. 입력 유효성 검사

#### 항상 사용자 입력을 검증할 것
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

#### 파일 업로드 유효성 검사
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

#### 확인 단계
- [ ] 모든 사용자 입력이 스키마로 검증됨
- [ ] 파일 업로드가 제한됨 (크기, 타입, 확장자)
- [ ] 사용자 입력이 쿼리에 직접 사용되지 않음
- [ ] 화이트리스트 검증 사용 (블랙리스트가 아닌)
- [ ] 에러 메시지가 민감한 정보를 노출하지 않음

### 3. SQL Injection 방지

#### 절대 SQL을 연결하지 말 것
```typescript
// DANGEROUS - SQL Injection vulnerability
const query = `SELECT * FROM users WHERE email = '${userEmail}'`
await db.query(query)
```

#### 반드시 파라미터화된 쿼리를 사용할 것
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

#### 확인 단계
- [ ] 모든 데이터베이스 쿼리가 파라미터화된 쿼리 사용
- [ ] SQL에서 문자열 연결 없음
- [ ] ORM/쿼리 빌더가 올바르게 사용됨
- [ ] Supabase 쿼리가 적절히 새니타이징됨

### 4. 인증 및 권한 부여

#### JWT 토큰 처리
```typescript
// FAIL: WRONG: localStorage (vulnerable to XSS)
localStorage.setItem('token', token)

// PASS: CORRECT: httpOnly cookies
res.setHeader('Set-Cookie',
  `token=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`)
```

#### 권한 부여 확인
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

#### Row Level Security (Supabase)
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

#### 확인 단계
- [ ] 토큰이 httpOnly 쿠키에 저장됨 (localStorage가 아닌)
- [ ] 민감한 작업 전에 권한 부여 확인
- [ ] Supabase에서 Row Level Security 활성화됨
- [ ] 역할 기반 접근 제어 구현됨
- [ ] 세션 관리가 안전함

### 5. XSS 방지

#### HTML 새니타이징
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

#### Content Security Policy
```typescript
// next.config.js
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: `
      default-src 'self';
      script-src 'self' 'nonce-{nonce}';
      style-src 'self' 'nonce-{nonce}';
      img-src 'self' data: https:;
      font-src 'self';
      connect-src 'self' https://api.example.com;
    `.replace(/\s{2,}/g, ' ').trim()
  }
]
```

`{nonce}`는 요청마다 새로 생성하고, 헤더와 인라인 `<script>`/`<style>` 태그에 동일하게 주입해야 합니다.

#### 확인 단계
- [ ] 사용자 제공 HTML이 새니타이징됨
- [ ] CSP 헤더가 구성됨
- [ ] 검증되지 않은 동적 콘텐츠 렌더링 없음
- [ ] React의 내장 XSS 보호가 사용됨

### 6. CSRF 보호

#### CSRF 토큰
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

#### SameSite 쿠키
```typescript
res.setHeader('Set-Cookie',
  `session=${sessionId}; HttpOnly; Secure; SameSite=Strict`)
```

#### 확인 단계
- [ ] 상태 변경 작업에 CSRF 토큰 적용
- [ ] 모든 쿠키에 SameSite=Strict 설정
- [ ] Double-submit 쿠키 패턴 구현

### 7. 속도 제한

#### API 속도 제한
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

#### 비용이 높은 작업
```typescript
// Aggressive rate limiting for searches
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: 'Too many search requests'
})

app.use('/api/search', searchLimiter)
```

#### 확인 단계
- [ ] 모든 API 엔드포인트에 속도 제한 적용
- [ ] 비용이 높은 작업에 더 엄격한 제한
- [ ] IP 기반 속도 제한
- [ ] 사용자 기반 속도 제한 (인증된 사용자)

### 8. 민감한 데이터 노출

#### 로깅
```typescript
// FAIL: WRONG: Logging sensitive data
console.log('User login:', { email, password })
console.log('Payment:', { cardNumber, cvv })

// PASS: CORRECT: Redact sensitive data
console.log('User login:', { email, userId })
console.log('Payment:', { last4: card.last4, userId })
```

#### 에러 메시지
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

#### 확인 단계
- [ ] 로그에 비밀번호, 토큰, 시크릿 없음
- [ ] 사용자에게 표시되는 에러 메시지가 일반적임
- [ ] 상세 에러는 서버 로그에만 기록
- [ ] 사용자에게 스택 트레이스가 노출되지 않음

### 9. 블록체인 보안 (Solana)

#### 지갑 검증
```typescript
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { PublicKey } from '@solana/web3.js'

async function verifyWalletOwnership(
  publicKey: string,
  signature: string,
  message: string
) {
  try {
    const publicKeyBytes = new PublicKey(publicKey).toBytes()
    const signatureBytes = bs58.decode(signature)
    const messageBytes = new TextEncoder().encode(message)

    return nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKeyBytes
    )
  } catch (error) {
    return false
  }
}
```

참고: Solana 공개 키와 서명은 일반적으로 base64가 아니라 base58로 인코딩됩니다.

#### 트랜잭션 검증
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

#### 확인 단계
- [ ] 지갑 서명 검증됨
- [ ] 트랜잭션 세부 정보 유효성 검사됨
- [ ] 트랜잭션 전 잔액 확인
- [ ] 블라인드 트랜잭션 서명 없음

### 10. 의존성 보안

#### 정기 업데이트
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

#### 잠금 파일
```bash
# ALWAYS commit lock files
git add package-lock.json

# Use in CI/CD for reproducible builds
npm ci  # Instead of npm install
```

#### 확인 단계
- [ ] 의존성이 최신 상태
- [ ] 알려진 취약점 없음 (npm audit 클린)
- [ ] 잠금 파일 커밋됨
- [ ] GitHub에서 Dependabot 활성화됨
- [ ] 정기적인 보안 업데이트

## 보안 테스트

### 자동화된 보안 테스트
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

## 배포 전 보안 체크리스트

모든 프로덕션 배포 전:

- [ ] **시크릿**: 하드코딩된 시크릿 없음, 모두 환경 변수에 저장
- [ ] **입력 유효성 검사**: 모든 사용자 입력 검증됨
- [ ] **SQL Injection**: 모든 쿼리 파라미터화됨
- [ ] **XSS**: 사용자 콘텐츠 새니타이징됨
- [ ] **CSRF**: 보호 활성화됨
- [ ] **인증**: 적절한 토큰 처리
- [ ] **권한 부여**: 역할 확인 적용됨
- [ ] **속도 제한**: 모든 엔드포인트에서 활성화됨
- [ ] **HTTPS**: 프로덕션에서 강제 적용
- [ ] **보안 헤더**: CSP, X-Frame-Options 구성됨
- [ ] **에러 처리**: 에러에 민감한 데이터 없음
- [ ] **로깅**: 민감한 데이터가 로그에 없음
- [ ] **의존성**: 최신 상태, 취약점 없음
- [ ] **Row Level Security**: Supabase에서 활성화됨
- [ ] **CORS**: 적절히 구성됨
- [ ] **파일 업로드**: 유효성 검사됨 (크기, 타입)
- [ ] **지갑 서명**: 검증됨 (블록체인인 경우)

## 참고 자료

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Next.js Security](https://nextjs.org/docs/security)
- [Supabase Security](https://supabase.com/docs/guides/auth)
- [Web Security Academy](https://portswigger.net/web-security)

---

**기억하세요**: 보안은 선택 사항이 아닙니다. 하나의 취약점이 전체 플랫폼을 침해할 수 있습니다. 의심스러울 때는 보수적으로 대응하세요.
