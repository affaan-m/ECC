**언어:** [English](../../README.md) | [Português (Brasil)](../pt-BR/README.md) | [简体中文](../../README.zh-CN.md) | [繁體中文](../zh-TW/README.md) | [日本語](../ja-JP/README.md) | 한국어 | [Türkçe](../tr/README.md) | [Русский](../ru/README.md) | [Tiếng Việt](../vi-VN/README.md) | [ไทย](../th/README.md)

# Everything Claude Code

[![Stars](https://img.shields.io/github/stars/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/stargazers)
[![Forks](https://img.shields.io/github/forks/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/network/members)
[![Contributors](https://img.shields.io/github/contributors/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/graphs/contributors)
[![npm ecc-universal](https://img.shields.io/npm/dw/ecc-universal?label=ecc-universal%20weekly%20downloads&logo=npm)](https://www.npmjs.com/package/ecc-universal)
[![npm ecc-agentshield](https://img.shields.io/npm/dw/ecc-agentshield?label=ecc-agentshield%20weekly%20downloads&logo=npm)](https://www.npmjs.com/package/ecc-agentshield)
[![GitHub App Install](https://img.shields.io/badge/GitHub%20App-150%20installs-2ea44f?logo=github)](https://github.com/marketplace/ecc-tools)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
![Shell](https://img.shields.io/badge/-Shell-4EAA25?logo=gnu-bash&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white)
![Go](https://img.shields.io/badge/-Go-00ADD8?logo=go&logoColor=white)
![Java](https://img.shields.io/badge/-Java-ED8B00?logo=openjdk&logoColor=white)
![Markdown](https://img.shields.io/badge/-Markdown-000000?logo=markdown&logoColor=white)

> **140K+ stars** | **21K+ forks** | **170+ contributors** | **12+ language ecosystems** | **Anthropic 해커톤 우승**

---

<div align="center">

**Language / 语言 / 語言 / 언어 / Dil / Язык / Ngôn ngữ**

[**English**](../../README.md) | [Português (Brasil)](../pt-BR/README.md) | [简体中文](../../README.zh-CN.md) | [繁體中文](../zh-TW/README.md) | [日本語](../ja-JP/README.md) | [한국어](README.md) | [Türkçe](../tr/README.md) | [Русский](../ru/README.md) | [Tiếng Việt](../vi-VN/README.md) | [ไทย](../th/README.md)

</div>

---

**AI 에이전트 하네스를 위한 성능 최적화 시스템. Anthropic 해커톤 우승자가 만들었습니다.**

단순한 설정 파일 모음이 아닙니다. 스킬, 직관(Instinct), 메모리 최적화, 지속적 학습, 보안 스캐닝, 리서치 우선 개발을 아우르는 완전한 시스템입니다. 10개월 이상 실제 프로덕트를 만들며 매일 집중적으로 사용해 발전시킨 프로덕션 레벨의 에이전트, 훅, 커맨드, 룰, MCP 설정이 포함되어 있습니다.

**Claude Code**, **Codex**, **Cursor**, **OpenCode**, **Gemini** 등 다양한 AI 에이전트 하네스에서 사용할 수 있습니다.

---

## 가이드

이 저장소는 코드만 포함하고 있습니다. 가이드에서 모든 것을 설명합니다.

<table>
<tr>
<td width="50%">
<a href="https://x.com/affaanmustafa/status/2012378465664745795">
<img src="https://github.com/user-attachments/assets/1a471488-59cc-425b-8345-5245c7efbcef" alt="The Shorthand Guide to Everything Claude Code" />
</a>
</td>
<td width="50%">
<a href="https://x.com/affaanmustafa/status/2014040193557471352">
<img src="https://github.com/user-attachments/assets/c9ca43bc-b149-427f-b551-af6840c368f0" alt="The Longform Guide to Everything Claude Code" />
</a>
</td>
</tr>
<tr>
<td align="center"><b>요약 가이드</b><br/>설정, 기초, 철학. <b>이것부터 읽으세요.</b></td>
<td align="center"><b>상세 가이드</b><br/>토큰 최적화, 메모리 영속성, 평가, 병렬 처리.</td>
</tr>
</table>

| 주제 | 배울 수 있는 것 |
|------|----------------|
| 토큰 최적화 | 모델 선택, 시스템 프롬프트 최적화, 백그라운드 프로세스 |
| 메모리 영속성 | 세션 간 컨텍스트를 자동으로 저장/불러오는 훅 |
| 지속적 학습 | 세션에서 패턴을 자동 추출하여 재사용 가능한 스킬로 변환 |
| 검증 루프 | 체크포인트 vs 연속 평가, 채점 유형, pass@k 메트릭 |
| 병렬 처리 | Git worktree, 캐스케이드 방식, 인스턴스 확장 시점 |
| 서브에이전트 오케스트레이션 | 컨텍스트 문제, 반복 검색 패턴 |

---

## 새로운 소식

### v1.8.0 — 하네스 성능 시스템 (2026년 3월)

- **하네스 중심 릴리스** — ECC는 이제 단순 설정 모음이 아닌, 에이전트 하네스 성능 시스템으로 명시됩니다.
- **훅 안정성 개선** — SessionStart 루트 폴백, Stop 단계 세션 요약, 취약한 인라인 원라이너를 스크립트 기반 훅으로 교체.
- **훅 런타임 제어** — `ECC_HOOK_PROFILE=minimal|standard|strict`와 `ECC_DISABLED_HOOKS=...`로 훅 파일 수정 없이 런타임 제어.
- **새 하네스 커맨드** — `/harness-audit`, `/loop-start`, `/loop-status`, `/quality-gate`, `/model-route`.
- **NanoClaw v2** — 모델 라우팅, 스킬 핫로드, 세션 분기/검색/내보내기/압축/메트릭.
- **크로스 하네스 호환성** — Claude Code, Cursor, OpenCode, Codex 간 동작 일관성 강화.
- **997개 내부 테스트 통과** — 훅/런타임 리팩토링 및 호환성 업데이트 후 전체 테스트 통과.

### v1.7.0 — 크로스 플랫폼 확장 & 프레젠테이션 빌더 (2026년 2월)

- **Codex 앱 + CLI 지원** — AGENTS.md 기반의 직접적인 Codex 지원
- **`frontend-slides` 스킬** — 의존성 없는 HTML 프레젠테이션 빌더
- **5개 신규 비즈니스/콘텐츠 스킬** — `article-writing`, `content-engine`, `market-research`, `investor-materials`, `investor-outreach`
- **992개 내부 테스트** — 확장된 검증 및 회귀 테스트 범위

### v1.6.0 — Codex CLI, AgentShield & 마켓플레이스 (2026년 2월)

- **Codex CLI 지원** — OpenAI Codex CLI 호환성을 위한 `/codex-setup` 커맨드
- **7개 신규 스킬** — `search-first`, `swift-actor-persistence`, `swift-protocol-di-testing` 등
- **AgentShield 통합** — `/security-scan`으로 Claude Code에서 직접 AgentShield 실행; 1282개 테스트, 102개 규칙
- **GitHub 마켓플레이스** — [github.com/marketplace/ecc-tools](https://github.com/marketplace/ecc-tools)에서 무료/프로/엔터프라이즈 티어 제공
- **30명 이상의 커뮤니티 기여** — 6개 언어에 걸친 30명의 기여자
- **978개 내부 테스트** — 에이전트, 스킬, 커맨드, 훅, 룰 전반에 걸친 검증

전체 변경 내역은 [Releases](https://github.com/affaan-m/everything-claude-code/releases)에서 확인하세요.

---

## 빠른 시작

2분 안에 설정 완료:

### 1단계: 플러그인 설치

```bash
# 마켓플레이스 추가
/plugin marketplace add https://github.com/affaan-m/everything-claude-code

# 플러그인 설치
/plugin install ecc@ecc
```

### 2단계: 룰 설치 (필수)

> WARNING: **중요:** Claude Code 플러그인은 `rules`를 자동으로 배포할 수 없습니다. 수동으로 설치해야 합니다:

```bash
# 먼저 저장소 클론
git clone https://github.com/affaan-m/everything-claude-code.git
cd everything-claude-code

# 권장: 설치 스크립트 사용 (common + 언어별 룰을 안전하게 처리)
./install.sh typescript    # 또는 python, golang
# 여러 언어를 한번에 설치할 수 있습니다:
# ./install.sh typescript python golang
# Cursor를 대상으로 설치:
# ./install.sh --target cursor typescript
```

수동 설치 방법은 `rules/` 폴더의 README를 참고하세요.

### 3단계: 사용 시작

```bash
# 커맨드 실행 (플러그인 설치 시 네임스페이스 형태 사용)
/ecc:plan "사용자 인증 추가"

# 수동 설치(옵션 2) 시에는 짧은 형태를 사용:
# /plan "사용자 인증 추가"

# 사용 가능한 커맨드 확인
/plugin list ecc@ecc
```

**끝!** 이제 16개 에이전트, 65개 스킬, 40개 커맨드를 사용할 수 있습니다.

---

## 크로스 플랫폼 지원

이 플러그인은 **Windows, macOS, Linux**를 완벽하게 지원하며, 주요 IDE(Cursor, OpenCode, Antigravity) 및 CLI 하네스와 긴밀하게 통합됩니다. 모든 훅과 스크립트는 최대 호환성을 위해 Node.js로 작성되었습니다.

### 패키지 매니저 감지

플러그인이 선호하는 패키지 매니저(npm, pnpm, yarn, bun)를 자동으로 감지합니다:

1. **환경 변수**: `CLAUDE_PACKAGE_MANAGER`
2. **프로젝트 설정**: `.claude/package-manager.json`
3. **package.json**: `packageManager` 필드
4. **락 파일**: package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb에서 감지
5. **글로벌 설정**: `~/.claude/package-manager.json`
6. **폴백**: `npm`

패키지 매니저 설정 방법:

```bash
# 환경 변수로 설정
export CLAUDE_PACKAGE_MANAGER=pnpm

# 글로벌 설정
node scripts/setup-package-manager.js --global pnpm

# 프로젝트 설정
node scripts/setup-package-manager.js --project bun

# 현재 설정 확인
node scripts/setup-package-manager.js --detect
```

또는 Claude Code에서 `/setup-pm` 커맨드를 사용하세요.

### 훅 런타임 제어

런타임 플래그로 엄격도를 조절하거나 특정 훅을 임시로 비활성화할 수 있습니다:

```bash
# 훅 엄격도 프로필 (기본값: standard)
export ECC_HOOK_PROFILE=standard

# 비활성화할 훅 ID (쉼표로 구분)
export ECC_DISABLED_HOOKS="pre:bash:tmux-reminder,post:edit:typecheck"
```

---

## 구성 요소

이 저장소는 **Claude Code 플러그인**입니다 - 직접 설치하거나 컴포넌트를 수동으로 복사할 수 있습니다.

```
everything-claude-code/
|-- .claude-plugin/   # 플러그인 및 마켓플레이스 매니페스트
|   |-- plugin.json         # 플러그인 메타데이터와 컴포넌트 경로
|   |-- marketplace.json    # /plugin marketplace add용 마켓플레이스 카탈로그
|
|-- agents/           # 위임을 위한 전문 서브에이전트
|   |-- planner.md           # 기능 구현 계획
|   |-- architect.md         # 시스템 설계 의사결정
|   |-- tdd-guide.md         # 테스트 주도 개발
|   |-- code-reviewer.md     # 품질 및 보안 리뷰
|   |-- security-reviewer.md # 취약점 분석
|   |-- build-error-resolver.md
|   |-- e2e-runner.md        # Playwright E2E 테스팅
|   |-- refactor-cleaner.md  # 사용하지 않는 코드 정리
|   |-- doc-updater.md       # 문서 동기화
|   |-- go-reviewer.md       # Go 코드 리뷰
|   |-- go-build-resolver.md # Go 빌드 에러 해결
|   |-- python-reviewer.md   # Python 코드 리뷰
|   |-- database-reviewer.md # 데이터베이스/Supabase 리뷰
|
|-- skills/           # 워크플로우 정의와 도메인 지식
|   |-- coding-standards/           # 언어 모범 사례
|   |-- backend-patterns/           # API, 데이터베이스, 캐싱 패턴
|   |-- frontend-patterns/          # React, Next.js 패턴
|   |-- continuous-learning/        # 세션에서 패턴 자동 추출
|   |-- continuous-learning-v2/     # 신뢰도 점수가 있는 직관 기반 학습
|   |-- tdd-workflow/               # TDD 방법론
|   |-- security-review/            # 보안 체크리스트
|   |-- 그 외 다수...
|
|-- commands/         # 빠른 실행을 위한 슬래시 커맨드
|   |-- tdd.md              # /tdd - 테스트 주도 개발
|   |-- plan.md             # /plan - 구현 계획
|   |-- e2e.md              # /e2e - E2E 테스트 생성
|   |-- code-review.md      # /code-review - 품질 리뷰
|   |-- build-fix.md        # /build-fix - 빌드 에러 수정
|   |-- 그 외 다수...
|
|-- rules/            # 항상 따르는 가이드라인 (~/.claude/rules/에 복사)
|   |-- common/              # 언어 무관 원칙
|   |-- typescript/          # TypeScript/JavaScript 전용
|   |-- python/              # Python 전용
|   |-- golang/              # Go 전용
|
|-- hooks/            # 트리거 기반 자동화
|   |-- hooks.json                # 모든 훅 설정
|   |-- memory-persistence/       # 세션 라이프사이클 훅
|
|-- scripts/          # 크로스 플랫폼 Node.js 스크립트
|-- tests/            # 테스트 모음
|-- contexts/         # 동적 시스템 프롬프트 주입 컨텍스트
|-- examples/         # 예제 설정 및 세션
|-- mcp-configs/      # MCP 서버 설정
```

---

## 에코시스템 도구

### Skill Creator

저장소에서 Claude Code 스킬을 생성하는 두 가지 방법:

#### 옵션 A: 로컬 분석 (내장)

외부 서비스 없이 로컬에서 분석하려면 `/skill-create` 커맨드를 사용하세요:

```bash
/skill-create                    # 현재 저장소 분석
/skill-create --instincts        # 직관(instincts)도 함께 생성
```

git 히스토리를 로컬에서 분석하여 SKILL.md 파일을 생성합니다.

#### 옵션 B: GitHub 앱 (고급)

고급 기능(10k+ 커밋, 자동 PR, 팀 공유)이 필요한 경우:

[GitHub 앱 설치](https://github.com/apps/skill-creator) | [ecc.tools](https://ecc.tools)

### AgentShield — 보안 감사 도구

> Claude Code 해커톤(Cerebral Valley x Anthropic, 2026년 2월)에서 개발. 1282개 테스트, 98% 커버리지, 102개 정적 분석 규칙.

Claude Code 설정에서 취약점, 잘못된 구성, 인젝션 위험을 스캔합니다.

```bash
# 빠른 스캔 (설치 불필요)
npx ecc-agentshield scan

# 안전한 문제 자동 수정
npx ecc-agentshield scan --fix

# 3개의 Opus 4.6 에이전트로 정밀 분석
npx ecc-agentshield scan --opus --stream

# 안전한 설정을 처음부터 생성
npx ecc-agentshield init
```

**스캔 대상:** CLAUDE.md, settings.json, MCP 설정, 훅, 에이전트 정의, 스킬 — 시크릿 감지(14개 패턴), 권한 감사, 훅 인젝션 분석, MCP 서버 위험 프로파일링, 에이전트 설정 검토의 5가지 카테고리.

**`--opus` 플래그**는 레드팀/블루팀/감사관 파이프라인으로 3개의 Claude Opus 4.6 에이전트를 실행합니다. 공격자가 익스플로잇 체인을 찾고, 방어자가 보호 조치를 평가하며, 감사관이 양쪽의 결과를 종합하여 우선순위가 매겨진 위험 평가를 작성합니다.

Claude Code에서 `/security-scan`을 사용하거나, [GitHub Action](https://github.com/affaan-m/agentshield)으로 CI에 추가하세요.

[GitHub](https://github.com/affaan-m/agentshield) | [npm](https://www.npmjs.com/package/ecc-agentshield)

### 지속적 학습 v2

직관(Instinct) 기반 학습 시스템이 여러분의 패턴을 자동으로 학습합니다:

```bash
/instinct-status        # 학습된 직관과 신뢰도 확인
/instinct-import <file> # 다른 사람의 직관 가져오기
/instinct-export        # 내 직관 내보내기
/evolve                 # 관련 직관을 스킬로 클러스터링
```

자세한 내용은 `skills/continuous-learning-v2/`를 참고하세요.

---

## 요구 사항

### Claude Code CLI 버전

**최소 버전: v2.1.0 이상**

이 플러그인은 훅 시스템 변경으로 인해 Claude Code CLI v2.1.0 이상이 필요합니다.

버전 확인:
```bash
claude --version
```

### 중요: 훅 자동 로딩 동작

> WARNING: **기여자 참고:** `.claude-plugin/plugin.json`에 `"hooks"` 필드를 추가하지 **마세요**. 회귀 테스트로 이를 강제합니다.

Claude Code v2.1+는 설치된 플러그인의 `hooks/hooks.json`을 **자동으로 로드**합니다. 명시적으로 선언하면 중복 감지 오류가 발생합니다.

---

## 설치

### 옵션 1: 플러그인으로 설치 (권장)

```bash
# 마켓플레이스 추가
/plugin marketplace add https://github.com/affaan-m/everything-claude-code

# 플러그인 설치
/plugin install ecc@ecc
```

또는 `~/.claude/settings.json`에 직접 추가:

```json
{
  "extraKnownMarketplaces": {
    "ecc": {
      "source": {
        "source": "github",
        "repo": "affaan-m/everything-claude-code"
      }
    }
  },
  "enabledPlugins": {
    "ecc@ecc": true
  }
}
```

> **참고:** Claude Code 플러그인 시스템은 `rules`를 플러그인으로 배포하는 것을 지원하지 않습니다. 룰은 수동으로 설치해야 합니다:
>
> ```bash
> git clone https://github.com/affaan-m/everything-claude-code.git
>
> # 옵션 A: 사용자 레벨 룰 (모든 프로젝트에 적용)
> mkdir -p ~/.claude/rules
> cp -r everything-claude-code/rules/common ~/.claude/rules/common
> cp -r everything-claude-code/rules/typescript ~/.claude/rules/typescript   # 사용하는 스택 선택
>
> # 옵션 B: 프로젝트 레벨 룰 (현재 프로젝트에만 적용)
> mkdir -p .claude/rules
> cp -r everything-claude-code/rules/common .claude/rules/common
> ```

---

### 옵션 2: 수동 설치

설치할 항목을 직접 선택하고 싶다면:

```bash
# 저장소 클론
git clone https://github.com/affaan-m/everything-claude-code.git

# 에이전트 복사
cp everything-claude-code/agents/*.md ~/.claude/agents/

# 룰 복사 (common + 언어별)
cp -r everything-claude-code/rules/common ~/.claude/rules/common
cp -r everything-claude-code/rules/typescript ~/.claude/rules/typescript   # 사용하는 스택 선택

# 커맨드 복사
cp everything-claude-code/commands/*.md ~/.claude/commands/

# 스킬 복사
cp -r everything-claude-code/skills/* ~/.claude/skills/
cp -r everything-claude-code/skills/search-first ~/.claude/skills/
```

---

## 핵심 개념

### 에이전트

서브에이전트가 제한된 범위 내에서 위임된 작업을 처리합니다. 예시:

```markdown
---
name: code-reviewer
description: 코드의 품질, 보안, 유지보수성을 리뷰합니다
tools: ["Read", "Grep", "Glob", "Bash"]
model: opus
---

당신은 시니어 코드 리뷰어입니다...
```

### 스킬

스킬은 커맨드나 에이전트에 의해 호출되는 워크플로우 정의입니다:

```markdown
# TDD 워크플로우

1. 인터페이스를 먼저 정의
2. 실패하는 테스트 작성 (RED)
3. 최소한의 코드 구현 (GREEN)
4. 리팩토링 (IMPROVE)
5. 80% 이상 커버리지 확인
```

### 훅

훅은 도구 이벤트에 반응하여 실행됩니다. 예시 - console.log 경고:

```json
{
  "matcher": "tool == \"Edit\" && tool_input.file_path matches \"\\\\.(ts|tsx|js|jsx)$\"",
  "hooks": [{
    "type": "command",
    "command": "#!/bin/bash\ngrep -n 'console\\.log' \"$file_path\" && echo '[Hook] console.log를 제거하세요' >&2"
  }]
}
```

### 룰

룰은 항상 따라야 하는 가이드라인으로, `common/`(언어 무관) + 언어별 디렉토리로 구성됩니다:

```
rules/
  common/          # 보편적 원칙 (항상 설치)
  typescript/      # TS/JS 전용 패턴과 도구
  python/          # Python 전용 패턴과 도구
  golang/          # Go 전용 패턴과 도구
```

자세한 내용은 [`rules/README.md`](../../rules/README.md)를 참고하세요.

---

## 어떤 에이전트를 사용해야 할까?

어디서 시작해야 할지 모르겠다면 이 참고표를 보세요:

| 하고 싶은 것 | 사용할 커맨드 | 사용되는 에이전트 |
|-------------|-------------|-----------------|
| 새 기능 계획하기 | `/ecc:plan "인증 추가"` | planner |
| 시스템 아키텍처 설계 | `/ecc:plan` + architect 에이전트 | architect |
| 테스트를 먼저 작성하며 코딩 | `/tdd` | tdd-guide |
| 방금 작성한 코드 리뷰 | `/code-review` | code-reviewer |
| 빌드 실패 수정 | `/build-fix` | build-error-resolver |
| E2E 테스트 실행 | `/e2e` | e2e-runner |
| 보안 취약점 찾기 | `/security-scan` | security-reviewer |
| 사용하지 않는 코드 제거 | `/refactor-clean` | refactor-cleaner |
| 문서 업데이트 | `/update-docs` | doc-updater |
| Go 빌드 실패 수정 | `/go-build` | go-build-resolver |
| Go 코드 리뷰 | `/go-review` | go-reviewer |
| 데이터베이스 스키마/쿼리 리뷰 | `/code-review` + database-reviewer 에이전트 | database-reviewer |
| Python 코드 리뷰 | `/python-review` | python-reviewer |

### 일반적인 워크플로우

**새로운 기능 시작:**
```
/ecc:plan "OAuth를 사용한 사용자 인증 추가"
                                              → planner가 구현 청사진 작성
/tdd                                          → tdd-guide가 테스트 먼저 작성 강제
/code-review                                  → code-reviewer가 코드 검토
```

**버그 수정:**
```
/tdd                                          → tdd-guide: 버그를 재현하는 실패 테스트 작성
                                              → 수정 구현, 테스트 통과 확인
/code-review                                  → code-reviewer: 회귀 검사
```

**프로덕션 준비:**
```
/security-scan                                → security-reviewer: OWASP Top 10 감사
/e2e                                          → e2e-runner: 핵심 사용자 흐름 테스트
/test-coverage                                → 80% 이상 커버리지 확인
```

---

## FAQ

<details>
<summary><b>설치된 에이전트/커맨드 확인은 어떻게 하나요?</b></summary>

```bash
/plugin list ecc@ecc
```

플러그인에서 사용할 수 있는 모든 에이전트, 커맨드, 스킬을 보여줍니다.
</details>

<details>
<summary><b>훅이 작동하지 않거나 "Duplicate hooks file" 오류가 보여요</b></summary>

가장 흔한 문제입니다. `.claude-plugin/plugin.json`에 `"hooks"` 필드를 **추가하지 마세요.** Claude Code v2.1+는 설치된 플러그인의 `hooks/hooks.json`을 자동으로 로드합니다.
</details>

<details>
<summary><b>컨텍스트 윈도우가 줄어들어요 / Claude가 컨텍스트가 부족해요</b></summary>

MCP 서버가 너무 많으면 컨텍스트를 잡아먹습니다. 각 MCP 도구 설명이 200k 윈도우에서 토큰을 소비하여 ~70k까지 줄어들 수 있습니다.

**해결:** 프로젝트별로 사용하지 않는 MCP를 비활성화하세요:
```json
// 프로젝트의 .claude/settings.json에서
{
  "disabledMcpServers": ["supabase", "railway", "vercel"]
}
```

10개 미만의 MCP와 80개 미만의 도구를 활성화 상태로 유지하세요.
</details>

<details>
<summary><b>일부 컴포넌트만 사용할 수 있나요? (예: 에이전트만)</b></summary>

네. 옵션 2(수동 설치)를 사용하여 필요한 것만 복사하세요:

```bash
# 에이전트만
cp everything-claude-code/agents/*.md ~/.claude/agents/

# 룰만
cp -r everything-claude-code/rules/common ~/.claude/rules/common
```

각 컴포넌트는 완전히 독립적입니다.
</details>

<details>
<summary><b>Cursor / OpenCode / Codex / Antigravity에서도 작동하나요?</b></summary>

네. ECC는 크로스 플랫폼입니다:
- **Cursor**: `.cursor/`에 변환된 설정 제공
- **OpenCode**: `.opencode/`에 전체 플러그인 지원
- **Codex**: macOS 앱과 CLI 모두 퍼스트클래스 지원
- **Antigravity**: `.agent/`에 워크플로우, 스킬, 평탄화된 룰 통합
- **Claude Code**: 네이티브 — 이것이 주 타겟입니다
</details>

<details>
<summary><b>새 스킬이나 에이전트를 기여하고 싶어요</b></summary>

[CONTRIBUTING.md](../../CONTRIBUTING.md)를 참고하세요. 간단히 말하면:
1. 저장소를 포크
2. `skills/your-skill-name/SKILL.md`에 스킬 생성 (YAML frontmatter 포함)
3. 또는 `agents/your-agent.md`에 에이전트 생성
4. 명확한 설명과 함께 PR 제출
</details>

---

## 테스트 실행

```bash
# 모든 테스트 실행
node tests/run-all.js

# 개별 테스트 파일 실행
node tests/lib/utils.test.js
node tests/lib/package-manager.test.js
node tests/hooks/hooks.test.js
```

---

## 기여하기

**기여를 환영합니다.**

이 저장소는 커뮤니티 리소스로 만들어졌습니다. 가지고 계신 것이 있다면:
- 유용한 에이전트나 스킬
- 멋진 훅
- 더 나은 MCP 설정
- 개선된 룰

기여해 주세요! 가이드라인은 [CONTRIBUTING.md](../../CONTRIBUTING.md)를 참고하세요.

### 기여 아이디어

- 언어별 스킬 (Rust, C#, Swift, Kotlin) — Go, Python, Java는 이미 포함
- 프레임워크별 설정 (Rails, Laravel, FastAPI) — Django, NestJS, Spring Boot는 이미 포함
- DevOps 에이전트 (Kubernetes, Terraform, AWS, Docker)
- 테스팅 전략 (다양한 프레임워크, 비주얼 리그레션)
- 도메인별 지식 (ML, 데이터 엔지니어링, 모바일)

---

## 토큰 최적화

Claude Code 사용 비용이 부담된다면 토큰 소비를 관리해야 합니다. 이 설정으로 품질 저하 없이 비용을 크게 줄일 수 있습니다.

### 권장 설정

`~/.claude/settings.json`에 추가:

```json
{
  "model": "sonnet",
  "env": {
    "MAX_THINKING_TOKENS": "10000",
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "50"
  }
}
```

| 설정 | 기본값 | 권장값 | 효과 |
|------|--------|--------|------|
| `model` | opus | **sonnet** | ~60% 비용 절감; 80% 이상의 코딩 작업 처리 가능 |
| `MAX_THINKING_TOKENS` | 31,999 | **10,000** | 요청당 숨겨진 사고 비용 ~70% 절감 |
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | 95 | **50** | 더 일찍 압축 — 긴 세션에서 더 나은 품질 |

깊은 아키텍처 추론이 필요할 때만 Opus로 전환:
```
/model opus
```

### 일상 워크플로우 커맨드

| 커맨드 | 사용 시점 |
|--------|----------|
| `/model sonnet` | 대부분의 작업에서 기본값 |
| `/model opus` | 복잡한 아키텍처, 디버깅, 깊은 추론 |
| `/clear` | 관련 없는 작업 사이 (무료, 즉시 초기화) |
| `/compact` | 논리적 작업 전환 시점 (리서치 완료, 마일스톤 달성) |
| `/cost` | 세션 중 토큰 지출 모니터링 |

### 컨텍스트 윈도우 관리

**중요:** 모든 MCP를 한꺼번에 활성화하지 마세요. 각 MCP 도구 설명이 200k 윈도우에서 토큰을 소비하여 ~70k까지 줄어들 수 있습니다.

- 프로젝트당 10개 미만의 MCP 활성화
- 80개 미만의 도구 활성화 유지
- 프로젝트 설정에서 `disabledMcpServers`로 사용하지 않는 것 비활성화

---

## WARNING: 중요 참고 사항

### 커스터마이징

이 설정은 제 워크플로우에 맞게 만들어졌습니다. 여러분은:
1. 공감되는 것부터 시작하세요
2. 여러분의 스택에 맞게 수정하세요
3. 사용하지 않는 것은 제거하세요
4. 여러분만의 패턴을 추가하세요

---

## 스폰서

이 프로젝트는 무료 오픈소스입니다. 스폰서의 지원으로 유지보수와 성장이 이루어집니다.

[**스폰서 되기**](https://github.com/sponsors/affaan-m) | [스폰서 티어](../../SPONSORS.md) | [스폰서십 프로그램](../../SPONSORING.md)

---

## Star 히스토리

[![Star History Chart](https://api.star-history.com/svg?repos=affaan-m/everything-claude-code&type=Date)](https://star-history.com/#affaan-m/everything-claude-code&Date)

---

## 링크

- **요약 가이드 (여기서 시작):** [The Shorthand Guide to Everything Claude Code](https://x.com/affaanmustafa/status/2012378465664745795)
- **상세 가이드 (고급):** [The Longform Guide to Everything Claude Code](https://x.com/affaanmustafa/status/2014040193557471352)
- **팔로우:** [@affaanmustafa](https://x.com/affaanmustafa)
- **zenith.chat:** [zenith.chat](https://zenith.chat)

---

## 라이선스

MIT - 자유롭게 사용하고, 필요에 따라 수정하고, 가능하다면 기여해 주세요.

---

**이 저장소가 도움이 되었다면 Star를 눌러주세요. 두 가이드를 모두 읽어보세요. 멋진 것을 만드세요.**
