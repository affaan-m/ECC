# Git 워크플로우

## 커밋 메시지 형식
```
<type>: <description>

<선택적 본문>
```

타입: feat, fix, refactor, docs, test, chore, perf, ci

참고: ECC가 관리하는 설치는 `~/.claude/settings.json`에 `"includeCoAuthoredBy": false`를 설정하므로 커밋에 기본적으로 `Co-Authored-By`가 붙지 않습니다. Claude 표기를 유지하려면 `"includeCoAuthoredBy": true`를 설정하거나 `attribution`을 구성하세요. ECC는 명시적인 선택을 덮어쓰지 않습니다.

## Pull Request 워크플로우

PR을 만들 때:
1. 전체 커밋 히스토리를 분석 (최신 커밋만이 아닌)
2. `git diff [base-branch]...HEAD`로 모든 변경사항 확인
3. 포괄적인 PR 요약 작성
4. TODO가 포함된 테스트 계획 포함
5. 새 브랜치인 경우 `-u` 플래그와 함께 push

> git 작업 전 전체 개발 프로세스(계획, TDD, 코드 리뷰)는
> [development-workflow.md](./development-workflow.md)를 참고하세요.
