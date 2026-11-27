---
description: 선호하는 패키지 매니저(npm/pnpm/yarn/bun) 설정
disable-model-invocation: true
---

# 패키지 매니저 설정

프로젝트 또는 전역으로 선호하는 패키지 매니저를 설정합니다.

## 사용법

```bash
# 현재 패키지 매니저 감지
node scripts/setup-package-manager.js --detect

# 전역 설정
node scripts/setup-package-manager.js --global pnpm

# 프로젝트 설정
node scripts/setup-package-manager.js --project bun

# 사용 가능한 패키지 매니저 목록
node scripts/setup-package-manager.js --list
```

## 감지 우선순위

패키지 매니저를 결정할 때 다음 순서로 확인합니다:

1. **환경 변수**: `CLAUDE_PACKAGE_MANAGER`
2. **프로젝트 설정**: `.claude/package-manager.json`
3. **package.json**: `packageManager` 필드
4. **락 파일**: package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb의 존재 여부
5. **전역 설정**: `~/.claude/package-manager.json`
6. **폴백**: `npm`

## 설정 파일

### 전역 설정
```json
// ~/.claude/package-manager.json
{
  "packageManager": "pnpm"
}
```

### 프로젝트 설정
```json
// .claude/package-manager.json
{
  "packageManager": "bun"
}
```

### package.json
```json
{
  "packageManager": "pnpm@8.6.0"
}
```

## 환경 변수

`CLAUDE_PACKAGE_MANAGER`를 설정하면 다른 모든 감지 방법을 무시합니다:

```bash
# Windows (PowerShell)
$env:CLAUDE_PACKAGE_MANAGER = "pnpm"

# macOS/Linux
export CLAUDE_PACKAGE_MANAGER=pnpm
```

## 감지 실행

현재 패키지 매니저 감지 결과를 확인하려면 다음을 실행하세요:

```bash
node scripts/setup-package-manager.js --detect
```
