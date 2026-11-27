# 검증 커맨드

현재 코드베이스 상태에 대한 포괄적인 검증을 실행합니다.

## 지시사항

정확히 이 순서로 검증을 실행하세요:

1. **Build 검사**
   - 이 프로젝트의 build 커맨드 실행
   - 실패 시 에러를 보고하고 중단

2. **타입 검사**
   - TypeScript/타입 체커 실행
   - 모든 에러를 파일:줄번호로 보고

3. **Lint 검사**
   - 린터 실행
   - 경고와 에러 보고

4. **테스트 실행**
   - 모든 테스트 실행
   - 통과/실패 수 보고
   - 커버리지 비율 보고

5. **시크릿 스캔**
   - 소스 파일에서 API 키, 토큰, 비밀값 패턴 검색
   - 발견 위치 보고

6. **Console.log 감사**
   - 소스 파일에서 console.log 검색
   - 위치 보고

7. **Git 상태**
   - 커밋되지 않은 변경사항 표시
   - 마지막 커밋 이후 수정된 파일 표시

## 출력

간결한 검증 보고서를 생성합니다:

```
VERIFICATION: [PASS/FAIL]

Build:    [OK/FAIL]
Types:    [OK/X errors]
Lint:     [OK/X issues]
Tests:    [X/Y passed, Z% coverage]
Secrets:  [OK/X found]
Logs:     [OK/X console.logs]

Ready for PR: [YES/NO]
```

치명적 이슈가 있으면 수정 제안과 함께 목록화합니다.

## 인자

$ARGUMENTS:
- `quick` - build + 타입만
- `full` - 모든 검사 (기본값)
- `pre-commit` - 커밋에 관련된 검사
- `pre-pr` - 전체 검사 + 보안 스캔
