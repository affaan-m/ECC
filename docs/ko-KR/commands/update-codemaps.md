# 코드맵 업데이트

코드베이스 구조를 분석하고 토큰 효율적인 아키텍처 문서를 생성합니다.

## 1단계: 프로젝트 구조 스캔

1. 프로젝트 유형 식별 (모노레포, 단일 앱, 라이브러리, 마이크로서비스)
2. 모든 소스 디렉토리 찾기 (src/, lib/, app/, packages/)
3. 엔트리 포인트 매핑 (main.ts, index.ts, app.py, main.go 등)

## 2단계: 코드맵 생성

`docs/CODEMAPS/`에 코드맵 생성 또는 업데이트:

| 파일 | 내용 |
|------|------|
| `INDEX.md` | 전체 코드베이스 개요와 영역별 링크 |
| `backend.md` | API 라우트, 미들웨어 체인, 서비스 → 리포지토리 매핑 |
| `frontend.md` | 페이지 트리, 컴포넌트 계층, 상태 관리 흐름 |
| `database.md` | 데이터베이스 스키마, 마이그레이션, 저장소 계층 |
| `integrations.md` | 외부 서비스, 서드파티 통합, 어댑터 |
| `workers.md` | 백그라운드 작업, 큐, 스케줄러 |

### 코드맵 형식

각 코드맵은 토큰 효율적이어야 합니다 — AI 컨텍스트 소비에 최적화:

```markdown
# Backend 아키텍처

## 라우트
POST /api/users → UserController.create → UserService.create → UserRepo.insert
GET  /api/users/:id → UserController.get → UserService.findById → UserRepo.findById

## 주요 파일
src/services/user.ts (비즈니스 로직, 120줄)
src/repos/user.ts (데이터베이스 접근, 80줄)

## 의존성
- PostgreSQL (주 데이터 저장소)
- Redis (세션 캐시, 속도 제한)
- Stripe (결제 처리)
```

## 3단계: 영역 분류

생성기는 파일 경로 패턴을 기반으로 영역을 자동 분류합니다:

1. 프론트엔드: `app/`, `pages/`, `components/`, `hooks/`, `.tsx`, `.jsx`
2. 백엔드: `api/`, `routes/`, `controllers/`, `services/`, `.route.ts`
3. 데이터베이스: `db/`, `migrations/`, `prisma/`, `repositories/`
4. 통합: `integrations/`, `adapters/`, `connectors/`, `plugins/`
5. 워커: `workers/`, `jobs/`, `queues/`, `tasks/`, `cron/`

## 4단계: 메타데이터 추가

각 코드맵에 최신 정보 헤더를 추가합니다:

```markdown
**Last Updated:** 2026-03-12
**Total Files:** 42
**Total Lines:** 1875
```

## 5단계: 인덱스와 영역 문서 동기화

`INDEX.md`는 생성된 영역 문서를 링크하고 요약해야 합니다:
- 각 영역의 파일 수와 총 라인 수
- 감지된 엔트리 포인트
- 저장소 트리의 간단한 ASCII 개요
- 영역별 세부 문서 링크

## 팁

- **구현 세부사항이 아닌 상위 구조**에 집중
- 전체 코드 블록 대신 **파일 경로와 함수 시그니처** 사용
- 효율적인 컨텍스트 로딩을 위해 각 코드맵을 **1000 토큰 미만**으로 유지
- 장황한 설명 대신 데이터 흐름에 ASCII 다이어그램 사용
- 주요 기능 추가 또는 리팩토링 세션 후 `npx tsx scripts/codemaps/generate.ts` 실행
