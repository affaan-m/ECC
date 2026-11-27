---
name: continuous-learning-v2
description: 훅을 통해 세션을 관찰하고, 신뢰도 점수가 있는 원자적 본능을 생성하며, 이를 스킬/명령어/에이전트로 진화시키는 본능 기반 학습 시스템. v2.1에서는 프로젝트 간 오염을 방지하기 위한 프로젝트 범위 본능이 추가되었습니다.
origin: ECC
version: 2.1.0
---

# 지속적 학습 v2.1 - 본능 기반 아키텍처

Claude Code 세션을 원자적 "본능(instinct)" -- 신뢰도 점수가 있는 작은 학습된 행동 -- 을 통해 재사용 가능한 지식으로 변환하는 고급 학습 시스템입니다.

**v2.1**에서는 **프로젝트 범위 본능**이 추가되었습니다 -- React 패턴은 React 프로젝트에, Python 규칙은 Python 프로젝트에 유지되며, 범용 패턴(예: "항상 입력 유효성 검사")은 전역으로 공유됩니다.

## 활성화 시점

- Claude Code 세션에서 자동 학습 설정 시
- 훅을 통한 본능 기반 행동 추출 구성 시
- 학습된 행동의 신뢰도 임계값 조정 시
- 본능 라이브러리 검토, 내보내기, 가져오기 시
- 본능을 완전한 스킬, 명령어 또는 에이전트로 진화 시
- 프로젝트 범위 vs 전역 본능 관리 시
- 프로젝트에서 전역 범위로 본능 승격 시

## v2.1의 새로운 기능

| 기능 | v2.0 | v2.1 |
|---------|------|------|
| 저장소 | 전역 (~/.claude/homunculus/) | 프로젝트 범위 (projects/<hash>/) |
| 범위 | 모든 본능이 어디서나 적용 | 프로젝트 범위 + 전역 |
| 감지 | 없음 | git remote URL / 저장소 경로 |
| 승격 | 해당 없음 | 2개 이상 프로젝트에서 확인 시 프로젝트 -> 전역 |
| 명령어 | 4개 (status/evolve/export/import) | 6개 (+promote/projects) |
| 프로젝트 간 | 오염 위험 | 기본적으로 격리 |

## v2의 새로운 기능 (v1 대비)

| 기능 | v1 | v2 |
|---------|----|----|
| 관찰 | Stop 훅 (세션 종료) | PreToolUse/PostToolUse (100% 신뢰성) |
| 분석 | 메인 컨텍스트 | 백그라운드 에이전트 (Haiku) |
| 세분성 | 전체 스킬 | 원자적 "본능" |
| 신뢰도 | 없음 | 0.3-0.9 가중치 |
| 진화 | 직접 스킬로 | 본능 -> 클러스터 -> 스킬/명령어/에이전트 |
| 공유 | 없음 | 본능 내보내기/가져오기 |

## 본능 모델

본능은 작은 학습된 행동입니다:

```yaml
---
id: prefer-functional-style
trigger: "when writing new functions"
confidence: 0.7
domain: "code-style"
source: "session-observation"
scope: project
project_id: "a1b2c3d4e5f6"
project_name: "my-react-app"
---

# Prefer Functional Style

## Action
Use functional patterns over classes when appropriate.

## Evidence
- Observed 5 instances of functional pattern preference
- User corrected class-based approach to functional on 2025-01-15
```

**속성:**
- **원자적** -- 하나의 트리거, 하나의 액션
- **신뢰도 가중치** -- 0.3 = 잠정적, 0.9 = 거의 확실
- **도메인 태그** -- code-style, testing, git, debugging, workflow 등
- **증거 기반** -- 어떤 관찰이 이를 생성했는지 추적
- **범위 인식** -- `project` (기본값) 또는 `global`

## 작동 방식

```
세션 활동 (git 저장소 내)
      |
      | 훅이 프롬프트 + 도구 사용을 캡처 (100% 신뢰성)
      | + 프로젝트 컨텍스트 감지 (git remote / 저장소 경로)
      v
+---------------------------------------------+
|  projects/<project-hash>/observations.jsonl  |
|   (프롬프트, 도구 호출, 결과, 프로젝트)         |
+---------------------------------------------+
      |
      | 관찰자 에이전트가 읽기 (백그라운드, Haiku)
      v
+---------------------------------------------+
|          패턴 감지                             |
|   * 사용자 수정 -> 본능                        |
|   * 에러 해결 -> 본능                          |
|   * 반복 워크플로우 -> 본능                     |
|   * 범위 결정: 프로젝트 또는 전역?              |
+---------------------------------------------+
      |
      | 생성/업데이트
      v
+---------------------------------------------+
|  projects/<project-hash>/instincts/personal/ |
|   * prefer-functional.yaml (0.7) [project]   |
|   * use-react-hooks.yaml (0.9) [project]     |
+---------------------------------------------+
|  instincts/personal/  (전역)                  |
|   * always-validate-input.yaml (0.85) [global]|
|   * grep-before-edit.yaml (0.6) [global]     |
+---------------------------------------------+
      |
      | /evolve 클러스터링 + /promote
      v
+---------------------------------------------+
|  projects/<hash>/evolved/ (프로젝트 범위)      |
|  evolved/ (전역)                              |
|   * commands/new-feature.md                  |
|   * skills/testing-workflow.md               |
|   * agents/refactor-specialist.md            |
+---------------------------------------------+
```

## 프로젝트 감지

시스템이 현재 프로젝트를 자동으로 감지합니다:

1. **`CLAUDE_PROJECT_DIR` 환경 변수** (최우선 순위)
2. **`git remote get-url origin`** -- 이식 가능한 프로젝트 ID를 생성하기 위해 해시됨 (서로 다른 머신에서 같은 저장소는 같은 ID를 가짐)
3. **`git rev-parse --show-toplevel`** -- 저장소 경로를 사용한 폴백 (머신별)
4. **전역 폴백** -- 프로젝트가 감지되지 않으면 본능은 전역 범위로 이동

각 프로젝트는 12자 해시 ID를 받습니다 (예: `a1b2c3d4e5f6`). `~/.claude/homunculus/projects.json`의 레지스트리 파일이 ID를 사람이 읽을 수 있는 이름에 매핑합니다.

## 빠른 시작

### 1. 관찰 훅 활성화

`~/.claude/settings.json`에 추가하세요.

**플러그인으로 설치한 경우** (권장):

`~/.claude/settings.json`에 추가 hook 블록을 넣지 마세요. Claude Code v2.1+가 플러그인의 `hooks/hooks.json`을 자동으로 로드하며, `observe.sh`는 이미 그곳에 등록되어 있습니다.

이전에 `observe.sh`를 `~/.claude/settings.json`에 복사했다면 중복된 `PreToolUse` / `PostToolUse` 블록을 제거하세요. 중복 등록은 이중 실행과 `${CLAUDE_PLUGIN_ROOT}` 해석 오류를 일으킵니다. 이 변수는 플러그인 소유 `hooks/hooks.json` 항목에서만 확장됩니다.

**수동으로 `~/.claude/skills`에 설치한 경우**, 아래 내용을 `~/.claude/settings.json`에 추가하세요:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning-v2/hooks/observe.sh"
      }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning-v2/hooks/observe.sh"
      }]
    }]
  }
}
```

### 2. 디렉터리 구조 초기화

시스템은 첫 사용 시 자동으로 디렉터리를 생성하지만, 수동으로도 생성할 수 있습니다:

```bash
# Global directories
mkdir -p ~/.claude/homunculus/{instincts/{personal,inherited},evolved/{agents,skills,commands},projects}

# Project directories are auto-created when the hook first runs in a git repo
```

### 3. 본능 명령어 사용

```bash
/instinct-status     # 학습된 본능 표시 (프로젝트 + 전역)
/evolve              # 관련 본능을 스킬/명령어로 클러스터링
/instinct-export     # 본능을 파일로 내보내기
/instinct-import     # 다른 사람의 본능 가져오기
/promote             # 프로젝트 본능을 전역 범위로 승격
/projects            # 모든 알려진 프로젝트와 본능 개수 목록
```

## 명령어

| 명령어 | 설명 |
|---------|-------------|
| `/instinct-status` | 모든 본능 (프로젝트 범위 + 전역) 을 신뢰도와 함께 표시 |
| `/evolve` | 관련 본능을 스킬/명령어로 클러스터링, 승격 제안 |
| `/instinct-export` | 본능 내보내기 (범위/도메인으로 필터링 가능) |
| `/instinct-import <file>` | 범위 제어와 함께 본능 가져오기 |
| `/promote [id]` | 프로젝트 본능을 전역 범위로 승격 |
| `/projects` | 모든 알려진 프로젝트와 본능 개수 목록 |

## 구성

백그라운드 관찰자를 제어하려면 `config.json`을 편집하세요:

```json
{
  "version": "2.1",
  "observer": {
    "enabled": false,
    "run_interval_minutes": 5,
    "min_observations_to_analyze": 20
  }
}
```

| 키 | 기본값 | 설명 |
|-----|---------|-------------|
| `observer.enabled` | `false` | 백그라운드 관찰자 에이전트 활성화 |
| `observer.run_interval_minutes` | `5` | 관찰자가 관찰 결과를 분석하는 빈도 |
| `observer.min_observations_to_analyze` | `20` | 분석 실행 전 최소 관찰 횟수 |

기타 동작 (관찰 캡처, 본능 임계값, 프로젝트 범위, 승격 기준)은 `instinct-cli.py`와 `observe.sh`의 코드 기본값으로 구성됩니다.

## 파일 구조

```
~/.claude/homunculus/
+-- identity.json           # 프로필, 기술 수준
+-- projects.json           # 레지스트리: 프로젝트 해시 -> 이름/경로/리모트
+-- observations.jsonl      # 전역 관찰 결과 (폴백)
+-- instincts/
|   +-- personal/           # 전역 자동 학습된 본능
|   +-- inherited/          # 전역 가져온 본능
+-- evolved/
|   +-- agents/             # 전역 생성된 에이전트
|   +-- skills/             # 전역 생성된 스킬
|   +-- commands/           # 전역 생성된 명령어
+-- projects/
    +-- a1b2c3d4e5f6/       # 프로젝트 해시 (git remote URL에서)
    |   +-- observations.jsonl
    |   +-- observations.archive/
    |   +-- instincts/
    |   |   +-- personal/   # 프로젝트별 자동 학습
    |   |   +-- inherited/  # 프로젝트별 가져온 것
    |   +-- evolved/
    |       +-- skills/
    |       +-- commands/
    |       +-- agents/
    +-- f6e5d4c3b2a1/       # 다른 프로젝트
        +-- ...
```

## 범위 결정 가이드

| 패턴 유형 | 범위 | 예시 |
|-------------|-------|---------|
| 언어/프레임워크 규칙 | **project** | "React hooks 사용", "Django REST 패턴 따르기" |
| 파일 구조 선호도 | **project** | "`__tests__`/에 테스트", "src/components/에 컴포넌트" |
| 코드 스타일 | **project** | "함수형 스타일 사용", "dataclasses 선호" |
| 에러 처리 전략 | **project** | "에러에 Result 타입 사용" |
| 보안 관행 | **global** | "사용자 입력 유효성 검사", "SQL 새니타이징" |
| 일반 모범 사례 | **global** | "테스트 먼저 작성", "항상 에러 처리" |
| 도구 워크플로우 선호도 | **global** | "편집 전 Grep", "쓰기 전 Read" |
| Git 관행 | **global** | "Conventional commits", "작고 집중된 커밋" |

## 본능 승격 (프로젝트 -> 전역)

같은 본능이 높은 신뢰도로 여러 프로젝트에 나타나면, 전역 범위로 승격할 후보가 됩니다.

**자동 승격 기준:**
- 2개 이상 프로젝트에서 같은 본능 ID
- 평균 신뢰도 >= 0.8

**승격 방법:**

```bash
# Promote a specific instinct
python3 instinct-cli.py promote prefer-explicit-errors

# Auto-promote all qualifying instincts
python3 instinct-cli.py promote

# Preview without changes
python3 instinct-cli.py promote --dry-run
```

`/evolve` 명령어도 승격 후보를 제안합니다.

## 신뢰도 점수

신뢰도는 시간이 지남에 따라 진화합니다:

| 점수 | 의미 | 동작 |
|-------|---------|----------|
| 0.3 | 잠정적 | 제안되지만 강제되지 않음 |
| 0.5 | 보통 | 관련 시 적용 |
| 0.7 | 강함 | 적용이 자동 승인됨 |
| 0.9 | 거의 확실 | 핵심 행동 |

**신뢰도가 증가하는 경우:**
- 패턴이 반복적으로 관찰됨
- 사용자가 제안된 행동을 수정하지 않음
- 다른 소스의 유사한 본능이 동의함

**신뢰도가 감소하는 경우:**
- 사용자가 행동을 명시적으로 수정함
- 패턴이 오랜 기간 관찰되지 않음
- 모순되는 증거가 나타남

## 왜 관찰에 스킬이 아닌 훅을 사용하나요?

> "v1은 관찰에 스킬을 의존했습니다. 스킬은 확률적입니다 -- Claude의 판단에 따라 약 50-80%의 확률로 실행됩니다."

훅은 **100% 확률로** 결정적으로 실행됩니다. 이는 다음을 의미합니다:
- 모든 도구 호출이 관찰됨
- 패턴이 누락되지 않음
- 학습이 포괄적임

## 하위 호환성

v2.1은 v2.0 및 v1과 완전히 호환됩니다:
- `~/.claude/homunculus/instincts/`의 기존 전역 본능이 전역 본능으로 계속 작동
- v1의 기존 `~/.claude/skills/learned/` 스킬이 계속 작동
- Stop 훅이 여전히 실행됨 (하지만 이제 v2에도 데이터를 공급)
- 점진적 마이그레이션: 둘 다 병렬로 실행 가능

## 개인정보 보호

- 관찰 결과는 사용자의 머신에 **로컬**로 유지
- 프로젝트 범위 본능은 프로젝트별로 격리됨
- **본능**(패턴)만 내보낼 수 있음 -- 원시 관찰 결과는 아님
- 실제 코드나 대화 내용은 공유되지 않음
- 내보내기와 승격 대상을 사용자가 제어

## 관련 자료

- [Skill Creator](https://skill-creator.app) - 저장소 히스토리에서 본능 생성
- Homunculus - v2 본능 기반 아키텍처에 영감을 준 커뮤니티 프로젝트 (원자적 관찰, 신뢰도 점수, 본능 진화 파이프라인)
- [The Longform Guide](https://x.com/affaanmustafa/status/2014040193557471352) - 지속적 학습 섹션

---

*본능 기반 학습: Claude에게 당신의 패턴을 가르치기, 한 번에 하나의 프로젝트씩.*
