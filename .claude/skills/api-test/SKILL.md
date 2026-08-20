---
name: api-test
description: API 하네스(tests/api)를 실행한다. 개발 서버(:3000)와 개발 DB가 살아있어야 하는 통합 테스트 — 서버 확인/기동, 실행, 사전조건·실패 요약까지. API 라우트를 고친 뒤 검증할 때 사용.
---

# API 하네스 실행

`tests/api` 는 실제 개발 서버와 개발 DB를 두드리는 통합 테스트다.
`npm run check` 게이트에는 포함되지 않으므로 (vitest.api.config.ts 참고)
API 라우트를 고쳤으면 이 스킬로 따로 돌린다.

## 절차

1. **서버 확인.**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login
   ```
   HTTP 응답(200/3xx)이 오면 떠 있는 것이다. `000` 이면 죽어 있는 것.

2. **죽어 있으면 기동.** `mcp__Claude_Browser__preview_start` 에 `{name: "Next.js Dev Server"}`
   (.claude/launch.json). Bash 로 dev 서버를 띄우지 않는다.
   첫 요청은 라우트 컴파일 때문에 느리다 — 1번 curl 을 응답이 올 때까지 재시도한다 (최대 60초).

3. **실행.**
   ```bash
   npm run test:api
   ```
   Bash timeout 은 180초 이상으로. 첫 실행은 라우트 컴파일 때문에 오래 걸린다.
   파일 간 병렬이 꺼져 있으니 (같은 DB/서버 공유) 동시에 두 번 돌리지 않는다.

4. **사전 조건을 먼저 읽는다.** 하네스가 출력하는 "사전 조건" 목록에서
   개발 DB 접속·공유 토큰·발행된 성적표 등 fixture 가 없으면 해당 테스트는
   조용히 skip 된다. **skip 이 많은 초록불을 "전부 통과"로 보고하지 않는다** —
   어떤 사전 조건이 빠졌고 그래서 뭐가 검증되지 않았는지 명시한다.

5. **결과 보고.** 통과/실패/스킵 수, 실패는 테스트 이름 + 응답 본문 요약,
   빠진 사전 조건과 그 영향.

## 테스트를 추가할 때

- **읽기(GET)만.** 쓰기·문자발송·cron 라우트는 실제 부수효과가 있어 하네스에서 제외한다.
- fixture 의존은 `it.skipIf` + `announcePrerequisites` 패턴을 따른다
  (tests/api/public-routes.test.ts, tests/api/_harness.ts 참고).
