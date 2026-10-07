# 다른 PC에서 이어가기 — 2026-10-07 WIP 체크포인트

이 문서는 다른 PC의 새 Codex 대화가 현재 작업을 이어갈 수 있도록 남긴 인계 기록이다. 완료 보고가 아니다. 이 대화에서 현재 체크포인트의 전체 `npm run check` 통과를 확인하지 못했으며, 배포 또는 운영 반영도 하지 않았다.

- 저장소: `https://github.com/cow0715/edunote.git`
- 인계 브랜치: `codex/wip-handoff-2026-10-07`
- 출발 브랜치: `share-home-report`, 기준 커밋 `2bc622e`
- 범위: 현재 작업 폴더의 미커밋 변경 전체. Share 작업뿐 아니라 기존 관리자 화면·기간/주차 트랜잭션·업로드/테마·LLM 라우팅 변경도 함께 보존한다. 각 영역은 별도 작업에서 작성된 변경이며, 이번 인계를 위해 기능을 추가하거나 섞어 재작성하지 않았다.
- 사용자 요청: 미완료 작업을 새 브랜치에 푸시해 다른 PC에서 계속 작업하고, 지금까지의 대화 맥락도 이어갈 수 있게 준비.

## 다른 PC 준비

이미 저장소가 있다면 기존 로컬 변경을 보존한 상태에서 다음을 실행한다.

```sh
git fetch origin
git switch --track origin/codex/wip-handoff-2026-10-07
npm ci
```

처음 받는다면 다음과 같이 시작한다.

```sh
git clone --branch codex/wip-handoff-2026-10-07 https://github.com/cow0715/edunote.git
cd edunote
npm ci
```

`.env.local`은 Git에 들어가지 않는다. 기존 개발 환경 설정을 별도로 준비한다. `.env.example`은 필요한 변수 이름을 확인하는 용도다. `.env.local`은 개발 Supabase DB, Vercel 변수는 별도 운영 DB다. 키/연결 문자열을 인계 문서나 커밋에 추가하지 않는다. `node_modules`, `.next`, 로컬 PostgreSQL 임시 클러스터, 개인 에이전트 설정 역시 새 PC에서 재생성한다.

샘플 갤러리도 proxy 초기화 때문에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 설정이 필요하다. 실제 학생 Share API에는 `SUPABASE_SERVICE_ROLE_KEY`, LLM 호출에는 `ANTHROPIC_API_KEY`가 필요하다. 트랜잭션을 쓰는 반/기간/주차 저장에는 개발 DB의 전용 역할 연결 `DATABASE_URL`이 필요하며, 없으면 해당 쓰기는 503을 반환한다. 마이그레이션 적용·전용 `edunote_app` 역할의 LOGIN/비밀번호·동일 프로젝트의 transaction pooler 6543·실제 TLS/Supavisor 접속은 기존 문서상 후속 설정/검증 항목이다. 다른 PC에서 운영 DB를 개발 DB 대신 사용하지 않는다.

읽기 전용 인계 점검에서 현재 미커밋 소스 131개의 상대/`@` import를 확인했으며, 누락된 소스 import·ignored 파일에 대한 import·소스 내 PC 절대 경로는 발견하지 않았다. 패키지와 lock 파일, 신규 `src/lib/db/`, `src/lib/services/`, `src/lib/llm/`, 마이그레이션 및 테스트를 함께 받아야 한다. `design-data/`의 학생 실명 데이터와 과금 파싱 검증용 학교 자료는 제외 상태를 유지한다.

Node.js와 npm이 있는 환경에서 실행한다. 원래 PC에서 사용한 Node는 v24.19.0이다. 이 PC에만 존재하는 Codex 런타임/npm 절대 경로를 새 PC에서 그대로 사용하지 않는다.

```sh
npm run dev -- --port 3109
# http://localhost:3109/dev/share-design

npm run check -- --maxWorkers=2 --minWorkers=1
```

단독 분석 시안은 `node scripts/preview-share-analysis.mjs`로 열 수 있다. 새 개발자 갤러리가 실제 Share 컴포넌트를 재사용하는 주 진입점이다. 원래 PC의 실행 중 서버/브라우저 탭은 Git으로 이동하지 않는다.

새 Codex 대화의 첫 메시지:

> AGENTS.md, design.md와 docs/worklog/2026-10-07-pc-handoff.md를 먼저 읽고 미완료 Share 분석/디자인 갤러리 작업을 이어가줘. 기존 관리자·DB·LLM 변경도 같은 WIP 브랜치에 보존되어 있으니 덮어쓰지 말고, 전체 npm run check가 통과하기 전 완료로 보고하지 마. 아래의 검증 실패부터 현재 코드 기준으로 확인해줘.

## 사용자 의도와 합의된 방향

Share의 가장 중요한 화면은 분석 탭이다. 데이터 나열을 줄이고 학생이 무엇에 약하며 무엇부터 보완해야 하는지 한눈에 알 수 있어야 한다. 유형이 많아도 난잡하지 않게 정리하고, 분석 근거와 실제 오답 복습으로 연결한다. 차트는 금지된 것이 아니라 필요와 효과를 판단해 기존 라이브러리를 쓰기로 했다.

이 대화의 요청 순서:

1. 분석 탭이 계산/해석 없이 데이터를 나열하는 느낌이라는 지적.
2. UI가 난잡하며 적절한 그래프/시각화가 도움이 되는지 검토 요청.
3. 많은 유형을 정돈하고 학생의 약점·집중 보완 대상을 보여 달라는 요청.
4. 분석 탭 전체 시안을 실제로 보고 UI를 더 깔끔하게 해 달라는 요청.
5. 분석이 누적 오답인지 최근 2주 기준인지 확인, 2회는 표본이 적다는 피드백.
6. 그래프를 쓰지 않기로 했는지 질문 후, 직관성을 높이는 적절한 차트를 판단해서 시안 요청.
7. 영역별 요약의 레이더 적합성 검토와 우측 상단 기록 선택의 항목/텍스트 정리 요청.
8. 기존 개발자 화면에 Share 전용 디자인 이력 탭을 만들고 여러 시안을 실제 화면처럼 바꿔 보고 싶다는 요청.
9. 미완료 상태 그대로 브랜치에 푸시해 다른 PC에서 이어가고 대화 맥락도 유지할 수 있는지 질문.

현재 디자인은 보완 유형 최대 3개의 가로 막대(Recharts), 전체 유형의 상태별 개수·검색·필터, 기본 접힌 최근 추이, 독립적으로 펼치는 영역/회차/계산 근거다. 영역 요약은 영역 수가 가변이고 문항 분모가 달라 레이더 대신 영역명·정답률·실제 문항 수를 비교할 수 있는 가로 막대를 유지했다. 레이더 라이브러리가 의존성에 존재하더라도 레이더 사용이 최종 합의된 것은 아니다.

## 분석 계산의 현재 기준

`src/lib/share-analysis.ts`와 `src/app/share/[token]/use-share-model.ts`가 기준이다.

- 약점 분류와 목록 정답률: 선택 기간의 모든 실제 출제 문항을 합산한다. 오답만 모은 분모 또는 최근 2주 전용 계산이 아니다. 정답과 오답을 모두 사용한다.
- 유형별 최소 3회 출제·10문항일 때 분류한다. 그 미만은 기록 부족으로 판정을 보류한다.
- 기간 누적 정답률의 60%·80% 경계로 우선 보완/복습 권장/안정 상태를 구분한다. 제품의 복습 안내 기준이며 통계적 확신을 뜻하지 않는다.
- 최근 흐름은 유형이 실제 출제된 최근 최대 4회와 그 이전 최대 4회를 비교한다. 양쪽 각각 3회·10문항을 충족할 때만 변화량을 표시한다.
- 최근 안정적으로 회복한 유형은 현재 보완 추천에서 제외하며, 누적이 안정적이어도 충분한 최근 기록에서 약해진 유형은 최근 확인 대상으로 추천한다.
- 최근 선그래프는 실제 최근 최대 6개 점을 사용한다. 비출제 회차를 0점으로 채우지 않는다.
- 가로 비교 막대는 실제 오답/문항 수로 계산한 기간 누적 오답률 0–100%를 사용하고 표시만 반올림한다. 전체 유형 목록은 정답률을 표시한다.

이전 분석 작업의 상세 기록과 과거 통과 결과: `docs/worklog/2026-10-01-share-analysis-insights.md`. 과거 749개 테스트 통과 기록을 현재 전체 작업 트리의 통과 결과로 재사용하면 안 된다.

## Share 디자인 이력 구현 상태

진입점은 `/dev`의 ‘Share 디자인’ 탭과 `/dev/share-design`이다. 별도 프레임은 `/dev/share-design/frame`.

| 위치 | 역할 |
| --- | --- |
| `src/components/dev/share-design-registry.ts` | 목록 중심·추이 중심·현재 보완 중심의 3개 시안 등록, 링크/토큰 파싱, 프레임 URL과 기간/탭 메시지 검증 |
| `src/components/dev/share-design-gallery.tsx` | 시안 선택·실제 학생 Share 링크 입력·학습 상황·320/375/430px·라이트/다크·별도 화면 열기 |
| `src/components/dev/share-design-samples.ts` | 3개 기간·5개 학습 상황의 재현용 전체 ShareData |
| `src/components/dev/share-analysis-versions.tsx` | 과거 목록/추이 중심 분석 레이아웃, 현재와 동일한 계산 모델 및 오답 연결 |
| `src/app/dev/share-design/frame/share-design-frame.tsx` | 재현 기록 또는 실제 Share API 데이터로 실제 리포트 렌더링 |
| `src/app/share/[token]/share-client.tsx` | 실제 5탭 셸 `ShareReport`, 데이터 로더 `useShareData`, 로딩/오류 상태 재사용 |
| `src/app/share/[token]/tabs/score-tab.tsx` | 전체 기간 오답 행의 기간 ID 전달과 샘플 전체 기간 데이터 주입 |
| `src/components/providers/theme-provider.tsx` | 프레임 테마 저장 키 분리 |

- 현재 시안은 실제 `AnalysisTab`을 사용한다. 과거 시안은 분석 레이아웃을 재현하며 현재 계산을 함께 적용한다. 과거 커밋의 앱 전체를 checkout하는 시스템은 아니다.
- 헤더·기간 선택·고정 5탭·홈·기록·독해 오답·단어·드로어·개인 복습은 실제 운영 컴포넌트를 재사용한다.
- 시안/테마를 바꾸거나 별도 화면을 열어도 프레임에서 선택한 기간·탭을 보존한다. 메시지는 동일 출처·현재 iframe window·허용된 형식을 검사한다.
- 실제 링크/토큰 입력은 현재 앱의 기존 Share API로 조회한다. 외부 URL의 host를 API 대상으로 사용하지 않는다.
- 샘플은 학생·지문·5선지·해설·답안·단어 예문·성적·출결·클리닉·숙제·코멘트를 포함한다. 샘플 재시험은 실제 링크 사용 안내이며 운영 제출이 아니다.
- 전체 기간 기록의 다른 기간 오답을 누르면 해당 기간으로 이동해 독해/단어와 해당 회차를 연다. 조회 중 컴포넌트 상태는 보존하지만 이전 기간 수치는 숨긴다.
- 개발 환경에서만 `/dev/share-design` 미리보기 접근 예외가 있다. 운영의 개발자 페이지 인증은 유지한다.
- 갤러리에서 시안을 고르는 행동은 학생들이 보는 일반 Share 화면의 디자인을 바꾸지 않는다.
- 스크린샷: `docs/qa/share-design/gallery-light.jpg`. 이전 분석 시안 증거는 `docs/qa/share-analysis/`.

## 검증 현황과 다음 작업

이 대화의 마지막 **전체 검증은 실패**했다. 실행 중/이후에 다른 작업에서 파일을 변경했으므로 인계 체크포인트의 최종 검증 결과로 확정할 수 없다. 사용자 요청에 따라 현재 코드를 WIP 브랜치로 보존하고, 새 PC에서 전체 검사를 다시 확인한다.

Share 갤러리 신규 테스트는 이력 UI 9개, ShareReport 9개, 레지스트리/기록 40개, 갤러리 26개로 총 84개다. 개별 실행 및 이전 전체 실행에서 신규 테스트가 통과한 기록이 있다. 실제 브라우저에서는 3개 시안, 프레임 너비/테마, 오답 원문/해설, 기간 시트 키보드 조작, 기간 변경에 따른 재계산, 시안 변경 시 기간·탭 보존을 확인했다. 실제 학생 데이터/재시험 제출의 운영 E2E는 수행하지 않았다.

가장 마지막 전체 명령은 `npm run check -- --maxWorkers=1 --minWorkers=1`. 타입체크·린트를 거쳐 테스트에서 실패했다. lint 오류 0, 경고 21개(이전 22개보다 감소)였지만 현재 상태는 다시 확인해야 한다. 로컬 로그 `edunote-share-design-check-current.log`에는 다음이 기록됐다.

- 65개 테스트 파일 중 54개 통과·11개 실패. 실행된 778개 테스트 중 777개 통과·1개 실패, 추가 unhandled error 1개.
- 여러 기존 및 신규 LLM 관련 suite에서 `server-only` 모듈이 Client Component로 import되었다는 오류. `dev-compare-route`, `exam-bank-ranged`, `llm-routing`, `ranged-core`, `source-image-render`, `split-objective-collapse`, `underline-markup`, `vocab-xlsx` 등.
- `llm-vocab-routing`, `llm-workflow-routing`에서 mock factory 오류. 원인 체인의 `server-only` 경계를 먼저 확인한다.
- 기존 `share-reading-flow.test.tsx`의 ‘다음 문항의 선택을 초기화하고 OX 및 오답만 재복습’ 테스트 5초 제한 초과.
- Vitest worker `onTaskUpdate` RPC timeout. 로그 실행 시간이 약 74,222초여서 PC 정지/대기 영향이 의심되지만 원인은 확정하지 않았다. 서버 전용 모듈 오류까지 시간 초과로 설명하면 안 된다.

LLM 관련 파일과 `vitest.config.ts`는 갤러리 작업과 동시에 다른 작업에서 변경됐다. 이 인계에서는 수정하지 않았다. 스테이징 직전 LLM 설계 문서는 ‘1~4단계 구현 및 검증 완료’로 갱신되어 있었으므로 해당 작업의 최신 기록을 함께 읽는다. 이 대화의 이전 실패를 최신 코드에서도 그대로 발생하는 결함으로 단정하지 않는다. 새 PC의 최신 코드로 전체 결과를 확인하고, 필요하면 모듈 경계/mock 구성을 검토한다. 실패를 숨기기 위해 suite를 제외하거나 테스트를 무조건 늘리지 않는다.

우선순위:

1. 브랜치/환경을 복원하고 `AGENTS.md`, `design.md`, 이 문서를 읽는다.
2. LLM 리팩터링의 서버 전용 import와 테스트 mock 실패를 확인한다. 해당 작업 설계 문서와 기준을 보존한다.
3. Share reading 흐름 시간 초과를 단독 재현해 실제 실패인지 머신 정지 영향인지 확인한다.
4. 전체 `npm run check`를 초록불로 만든다. 새 lint warning을 늘리지 않는다.
5. `/dev`의 새 탭과 `/dev/share-design`에서 실제 5탭 흐름 및 기간/시안 변경을 다시 확인한다. 실제 학생 링크/재시험 E2E는 아직 미확인이다.
6. 새 시안을 추가하려면 registry 항목과 frame 분석 렌더러를 연결한다. 사용자에게 실제 화면을 보여주고 후속 디자인 피드백을 반영한다.

## 함께 보존한 다른 작업

- 관리자 기간/주차 UX: `docs/worklog/2026-09-29-class-period-workspace-implementation.md`, `2026-09-29-backoffice-class-period-ux-audit.md`.
- DB 트랜잭션: `src/lib/db/`, `src/lib/services/`, 관련 API·테스트·`vitest.database.config.ts`와 `docs/worklog/2026-09-29-transaction-implementation.md`. 마이그레이션 `supabase/migrations/20260929101449_server_transaction_role.sql`도 함께 보존한다. 실제 개발/운영 DB 적용 여부를 추측하지 말고 환경별로 확인한다. 사용자가 양쪽 SQL Editor에서 직접 적용하는 규칙을 따른다.
- 업로드/테마: `src/components/ui/file-upload.tsx`, 관리자/채점/시험은행 업로드 UI, 공통 테마 토큰과 설정, `scripts/preview-upload-ui.mjs`, `tests/fixtures/upload-ui-preview.tsx`, 관련 테스트/QA 이미지.
- LLM 라우팅: `docs/llm-model-routing-design.md`, `src/lib/llm/{client,models,tasks,types,json,errors}.ts`, `providers/anthropic.ts`, 관련 호출부와 신규 라우팅 테스트. 최신 문서상 1~4단계 구현 및 검증 완료이며 실제 모델 품질 비교와 5~6단계는 후속이다. 이 대화의 전체 검사 실패와 구분해 최종 체크포인트를 재검증한다. 유료 호출을 임의로 실행하지 않는다.

## 작업 규칙과 대화 보존의 한계

`AGENTS.md`가 원본 규칙이다. UI는 `design.md`와 `학습 리포트 디자인 벤치마킹/design_handoff_share_report/README.md`를 따른다. `src/lib/`의 순수 로직 변경에는 유닛테스트가 필요하다. `npm run test:parse`는 실제 LLM 과금이므로 사용자 요청 없이 실행하지 않는다. DB 스키마 변경에는 migration SQL이 필요하며 개발/운영 DB가 분리돼 있다.

2026-10-07 사용자는 이번 인계를 위한 새 브랜치 생성·커밋·푸시를 명시적으로 요청했다. 이후 추가 커밋/푸시/배포는 새로운 요청 범위를 확인한다. 이번 작업은 운영 배포나 PR 머지를 포함하지 않는다.

이 문서는 대화의 결정사항과 작업 상태를 정리한 것이며 대화 원문 전체의 자동 동기화/모델 기억을 보장하지 않는다. Git 브랜치만 받으면 코드/문서가 이동한다. 같은 대화 이력을 유지하려면 지원되는 두 PC를 앱의 Connections에서 연결하고, 같은 저장소 프로젝트를 등록한 뒤 기존 대화의 실행 위치에서 Handoff를 사용한다. 현재 대화에서 확인 가능한 연결 대상은 Local뿐이므로 실제 다른 PC로의 Handoff는 수행하지 않았다.

공식 안내: https://learn.chatgpt.com/docs/remote-connections#hand-off-a-chat-between-hosts
