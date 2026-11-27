# SaaS 애플리케이션 — 프로젝트 CLAUDE.md

> Next.js + Supabase + Stripe SaaS 애플리케이션을 위한 실제 사용 예제입니다.
> 프로젝트 루트에 복사한 후 기술 스택에 맞게 커스터마이즈하세요.

## 프로젝트 개요

**기술 스택:** Next.js 15 (App Router), TypeScript, Supabase (인증 + DB), Stripe (결제), Tailwind CSS, Playwright (E2E)

**아키텍처:** 기본적으로 Server Components 사용. Client Components는 상호작용이 필요한 경우에만 사용. API route는 webhook용, Server Action은 mutation용.

## 핵심 규칙

### 데이터베이스

- 모든 쿼리는 RLS가 활성화된 Supabase client 사용 — RLS를 절대 우회하지 않음
- 마이그레이션은 `supabase/migrations/`에 저장 — 데이터베이스를 직접 수정하지 않음
- `select('*')` 대신 명시적 컬럼 목록이 포함된 `select()` 사용
- 모든 사용자 대상 쿼리에는 무제한 결과를 방지하기 위해 `.limit()` 포함 필수

### 인증

- Server Components에서는 `@supabase/ssr`의 `createServerClient()` 사용
- Client Components에서는 `@supabase/ssr`의 `createBrowserClient()` 사용
- 보호된 라우트는 `getUser()`로 확인 — 인증에 `getSession()`만 단독으로 신뢰하지 않음
- `middleware.ts`의 Middleware가 매 요청마다 인증 토큰 갱신

### 결제

- Stripe webhook 핸들러는 `app/api/webhooks/stripe/route.ts`에 위치
- 클라이언트 측 가격 데이터를 절대 신뢰하지 않음 — 항상 서버 측에서 Stripe로부터 조회
- 구독 상태는 webhook에 의해 동기화되는 `subscription_status` 컬럼으로 확인
- 무료 플랜 사용자: 프로젝트 3개, 일일 API 호출 100회

### 코드 스타일

- 코드나 주석에 이모지 사용 금지
- 불변 패턴만 사용 — spread 연산자 사용, 직접 변경 금지
- Server Components: `'use client'` 디렉티브 없음, `useState`/`useEffect` 없음
- Client Components: 파일 상단에 `'use client'` 작성, 최소한으로 유지 — 로직은 hooks로 분리
- 모든 입력 유효성 검사에 Zod 스키마 사용 선호 (API route, 폼, 환경 변수)

## 파일 구조

```
src/
  app/
    (auth)/          # 인증 페이지 (로그인, 회원가입, 비밀번호 찾기)
    (dashboard)/     # 보호된 대시보드 페이지
    api/
      webhooks/      # Stripe, Supabase webhooks
    layout.tsx       # Provider가 포함된 루트 레이아웃
  components/
    ui/              # Shadcn/ui 컴포넌트
    forms/           # 유효성 검사가 포함된 폼 컴포넌트
    dashboard/       # 대시보드 전용 컴포넌트
  hooks/             # 커스텀 React hooks
  lib/
    supabase/        # Supabase client 팩토리
    stripe/          # Stripe client 및 헬퍼
    utils.ts         # 범용 유틸리티
  types/             # 공유 TypeScript 타입
supabase/
  migrations/        # 데이터베이스 마이그레이션
  seed.sql           # 개발용 시드 데이터
```

## 주요 패턴

### API 응답 형식

```typescript
type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string }
```

### Server Action 패턴

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

## 환경 변수

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # 서버 전용, 클라이언트에 절대 노출 금지

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# 앱
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## 테스트 전략

```bash
/tdd                    # 새 기능에 대한 단위 + 통합 테스트
/e2e                    # 인증 흐름, 결제, 대시보드에 대한 Playwright 테스트
/test-coverage          # 80% 이상 커버리지 확인
```

### 핵심 E2E 흐름

1. 회원가입 → 이메일 인증 → 첫 프로젝트 생성
2. 로그인 → 대시보드 → CRUD 작업
3. 플랜 업그레이드 → Stripe checkout → 구독 활성화
4. Webhook: 구독 취소 → 무료 플랜으로 다운그레이드

## ECC 워크플로우

```bash
# 기능 계획 수립
/plan "Add team invitations with email notifications"

# TDD로 개발
/tdd

# 커밋 전
/code-review
/security-scan

# 릴리스 전
/e2e
/test-coverage
```

## Git 워크플로우

- `feat:` 새 기능, `fix:` 버그 수정, `refactor:` 코드 변경
- `main`에서 기능 브랜치 생성, PR 필수
- CI 실행 항목: lint, 타입 체크, 단위 테스트, E2E 테스트
- 배포: PR 시 Vercel 미리보기, `main` 병합 시 프로덕션 배포
