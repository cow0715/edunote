# 트랜잭션 사용 이력·저장 경로 감사와 구조 제안

## 결론

앱 전체에는 반복되는 다중 저장 작업이 충분히 많다. `Next.js(Node runtime) + Drizzle + node-postgres(pg) + Supabase transaction pooler`를 서버 전용 저장 계층으로 점진 도입하는 것을 권장한다. 인증·Storage·기존 단순 조회는 supabase-js를 유지한다. 별도 백엔드 서비스, DB 이전, 모든 API의 일괄 전환은 필요하지 않다.

이번 기간 기능만 독립 배포하는 경우 DB 함수는 이미 검증된 합리적인 최소 변경안이다. 그러나 단어장·시험지·채점·주차 재정렬까지 계속 각각 큰 DB 함수로 옮기기보다, 기존 TypeScript 계산 로직을 재사용하는 공통 트랜잭션 계층이 유지보수에 적합하다. 구조 변경은 별도 구현 범위로 승인받아 단계적으로 수행한다. 이번 감사에서는 앱 코드를 수정하거나 DB 함수를 적용하지 않았다.

## 조사 범위·증거 수준

- API route.ts 99개를 검색했다. insert/update/upsert/delete 호출이 있는 파일 62개, 여러 호출 지점이 있는 파일 37개. 후자는 분기별 별도 단일 저장도 포함하므로 **37개 결함/트랜잭션이라는 의미가 아니다**. lib의 저장 작업도 별도 추적했다.
- 화면 컴포넌트/React Query hook → API → Supabase 호출 경로를 단어 세팅, 단어시험, 모의고사, 반 생성, 달력 이동, 퇴원, 발송에서 추적했다. 운영 화면을 클릭하며 데이터를 변경하는 E2E 테스트는 하지 않았다.
- 현재 의존성·소스에 앱용 SQL 드라이버/ORM과 명시적 transaction/QueryRunner 계층은 발견하지 못했다. Git의 접근 가능한 전체 ref에서 해당 패턴의 변경 이력도 검색했으나 찾지 못했다. 삭제된 모든 외부 브랜치나 실제 과거 호출 로그까지 증명하는 것은 아니다.
- 연결된 `edunote` 운영 DB와 `edunote-dev` 개발 DB의 시스템 카탈로그를 SELECT로 조회했다. 함수 설치 여부와 운영 트리거를 확인했고 업무 데이터는 변경하지 않았다.
- 실제 API 핸들러 3개에 격리된 가짜 Supabase 어댑터로 중간 오류를 주입했다. 3개 재현 테스트 통과. 이는 실패 제어 흐름의 재현이며 실제 운영 장애 발생 증거나 실제 DB 장애 테스트는 아니다. 유료 LLM 호출 없음. 임시 하네스는 실행 후 정리했다.

## 기존에도 트랜잭션·DB 함수가 있었는가

**‘한 번도 없었다’는 설명은 틀리다.** 다만 TypeORM식 앱 트랜잭션 매니저는 확인되지 않았다.

1. PostgREST 요청 하나는 이미 DB 트랜잭션이다. 단일 INSERT/UPDATE, 한 요청의 bulk insert/upsert, 해당 쿼리의 FK cascade와 트리거는 같은 요청의 트랜잭션 범위다.
2. `rotate_share_tokens` RPC: 현재 cron API에서 호출한다(`src/app/api/cron/rotate-share-tokens/route.ts:27`). 이전 토큰 보존·만료일·새 토큰을 한 UPDATE로 처리. 2026-08-31 커밋 `a306b14`. 개발/운영 함수 존재 확인. 함수 설치 및 호출 코드 확인이 과거 cron 실행 성공 로그 확인을 뜻하지는 않는다.
3. `exam_bank_question_count_sync`: 문항 변경과 부모 시험의 문항 수 갱신을 DB 트리거로 처리한다. 운영에서 트리거 활성 상태 확인. 두 테이블 변경이 같은 트랜잭션에 포함되는 기존 사례다.
4. `restore_truncate_tables`: 과거 백업 복원 API에서 RPC로 여러 테이블 DELETE를 묶었다. 다만 뒤따르는 재삽입 전체까지 묶은 것은 아니었다. 2026-08-20 `2cabd18`에서 기능 삭제; 개발/운영에 해당 함수가 없음을 확인했다.
5. `exam_integrity_summary`: 조회용 RPC. 2026-08-31 `5cb14b1`에서 도입, `0b70886`에서 cron 자동 호출 제거. 현재 lib에 호출 함수가 남고 개발/운영 DB에도 존재하지만 앱에서 자동 호출하는 곳은 검색되지 않았다. 다중 쓰기 트랜잭션 사례로 세면 안 된다.
6. 이번 미커밋 `manage_class_period`: 로컬 코드/SQL에만 있다. 개발/운영 양쪽 미설치 확인. 이를 기존 배포 사례로 포함하지 않았다.

## 실제 저장 경로와 우선순위

| 우선순위 | 사용자 작업 / 근거 | 현재 경계와 실패 시 영향 | 개선 단위 |
|---|---|---|---|
| 높음 | 단어 세팅 저장·업로드 — `src/components/grade/vocab-word-setup.tsx:760` → `src/app/api/weeks/[id]/vocab-words/route.ts:228` | 기존 단어 DELETE(cascade 포함) → 새 단어 INSERT → 변형/시험 문항/답안 복원 → 점수 갱신이 별도 요청. INSERT 실패 시 기존 단어가 삭제된 상태로 응답 500. 오류 주입으로 재현. | 단어 세트 및 종속 데이터 교체를 원자적으로 저장. 계산/AI는 미리 끝내고 버전 확인 후 짧은 저장 트랜잭션. 장기적으로 삭제·재삽입 자체도 안정 ID 기반 갱신 검토. |
| 높음 | 달력 수업일 변경 — `src/hooks/use-weeks.ts:53` → 날짜 PUT + reorder POST → `src/app/api/classes/[id]/weeks/reorder/route.ts:29` | 브라우저가 날짜 변경과 번호 재정렬을 따로 호출. 재정렬은 임시 음수 → 최종 번호의 여러 요청. 최종 첫 UPDATE 실패 시 -10000/-10001이 남는 것을 격리 재현. sync 경로도 동일 패턴. | 날짜 이동+전체 재정렬을 한 서버 API/트랜잭션으로 합치고 반 단위 동시 변경 잠금. reorder 내부만 묶으면 날짜 변경과의 틈은 남는다. |
| 높음 | 단어시험 생성/교체 — `src/app/api/weeks/[id]/vocab-tests/route.ts:290` | 기존 시험 비활성화 → 새 시험/문항 저장 → 기존 답안/점수 정리 → 총 문항 수 갱신. 일부 실패는 복원 UPDATE/DELETE로 보상하지만 복원 실패·동시 요청·후반 실패까지 원자성을 보장하지 않는다. | 활성 시험 교체 전체 저장을 한 tx에 포함. 시험 생성 전 enrichment는 밖에서 수행. |
| 높음 | 모의고사 답안 저장 — `src/hooks/use-mock-exams.ts:153` → `src/app/api/mock-exams/[id]/results/route.ts:47` | 총점/등급 결과 upsert 후 문항별 답안 upsert. 뒤가 실패하면 요약과 상세 답안이 불일치할 수 있다. OCR 배치도 같은 저장 패턴. | 학생 한 명의 결과+답안 단위를 원자적으로 저장. 여러 학생 일괄 저장은 전원 롤백 여부를 제품 요구로 정한다. |
| 높음 | 독해/단어 채점·정답 변경 — `src/app/api/weeks/[id]/grade/route.ts:345`, `src/lib/grade-utils.ts:17`, `src/app/api/vocab-answer/route.ts:54` | 답안 판정과 집계 점수가 다른 요청. 일부 오류 객체를 확인하지 않는 저장도 있다. AI 실패 후 객관식 저장을 유지하는 의도된 부분 성공과, DB 저장 도중 불일치를 구분해야 한다. | AI 대기는 밖에 두고 판정 결과+해당 집계 갱신을 같은 tx로 처리. 변경 버전/잠금도 필요. |
| 중간 | 반 생성 — `src/app/api/classes/route.ts:52` | 반 → 주차 → 기본 기간. 기간 생성 실패 시 반이 남는 것을 오류 주입 재현. 주차 INSERT 오류는 현재 무시된다. | 반/초기 주차/기본 기간 생성 tx. |
| 중간 | 학생 등록·반 배정 — `src/app/api/students/route.ts:35` | 학생 INSERT 후 반 배정 upsert; 배정 오류 미확인. 학생만 생성되고 성공으로 보일 수 있다. | 학생+요청된 반 배정 tx. |
| 중간 | 퇴원·보충수업 종료 — `src/app/api/students/[id]/withdraw/route.ts`, `src/lib/clinic.ts:40` | 반 소속 종료 후 보충수업 종료를 따로 저장. 보충수업 여러 건 종료도 반복 UPDATE. | 한 학생의 퇴원 상태 변경 단위 tx. |
| 중간 | 문항 어휘 동기화 — `src/lib/exam-vocabulary.ts:192` | 기존 어휘 삭제 → 새 목록 삽입. 삽입 실패 시 목록 유실 가능. | 동일 문항 어휘 교체 tx. |
| 별도 설계 | 문자·성적표 발송 — `src/app/api/report-cards/[id]/send/route.ts:64` | 공개 상태 저장 → 외부 SMS → 로그 저장. SMS 성공 뒤 DB 로그가 실패해도 이미 발송된 문자는 취소할 수 없다. | 발송 작업/outbox와 멱등성·재시도. DB 트랜잭션으로 외부 발송까지 롤백할 수는 없다. |

트랜잭션은 부분 저장을 막지만 경쟁 요청의 갱신 유실까지 자동 해결하지 않는다. 반/시험 등 적절한 단위의 행 잠금, unique 제약, 필요시 버전 검사/재시도와 함께 설계한다. 기존 불일치 데이터를 자동 복구하는 기능도 별개다.

## 스택 비교와 선택

| 후보 | 이 코드베이스에서의 평가 |
|---|---|
| DB 함수 RPC 유지/확대 | 현재 연결·RLS 흐름을 활용하고 새 DB 비밀번호/풀 설정이 필요 없다. 기간 전환·순위 재정렬 같은 짧고 DB 중심인 작업에 적합. SQL로 검증 가능한 정합성 규칙은 계속 유지할 가치가 있다. 반면 채점/단어 세팅의 큰 TypeScript 흐름까지 SQL 함수마다 옮기면 앱 로직과 배포가 나뉘므로 모든 저장에 적용하는 표준으로는 우선 추천하지 않는다. |
| **Drizzle + pg** | **추천.** tx 객체 전달, 타입 있는 SQL 조립, 기존 TS 순수 계산 함수 재사용. 일부 테이블과 쓰기 경로만 시작할 수 있다. pg Pool은 Vercel의 연결 관리 가이드와 맞추기 쉽다. 기존 DB의 실제 타입/제약/RLS를 읽어 매핑해야 하며, 스키마 정의/마이그레이션의 관리 주체를 명확히 해야 한다. |
| Postgres.js 단독 | 더 작은 도입으로 `sql.begin`과 파라미터 바인딩을 쓸 수 있다. 명시적 SQL을 선호하고 소수 경로만 바꿀 때 좋은 대안. 다수 저장 경로에 타입 있는 공통 모델을 확장하려는 목표에서는 Drizzle을 함께 쓰는 편을 추천한다. Supabase transaction pooler에서는 prepare 설정 확인 필요. |
| pg 단독 | 가장 직접적이고 ORM 불필요. 같은 client에 BEGIN/COMMIT/ROLLBACK/release를 안전하게 감싸는 공통 래퍼와 행 타입 매핑을 직접 관리해야 한다. 충분히 가능하지만 이번 요구의 재사용 가능한 tx 추상화에는 Drizzle 쪽이 편하다. |
| TypeORM | 사용자가 익숙한 EntityManager 패턴을 제공하며 불가능한 조합이 아니다. 그러나 현재 프로젝트에 entity/repository 체계가 없어 이를 새로 도입할 근거가 약하다. 팀 숙련도가 TypeORM에 집중돼 있다면 우선순위가 바뀔 수 있다. 자동 synchronize는 사용하지 않는다. |
| Prisma | 가능한 대안이지만 기존 Supabase SQL/RLS 중심 관리와 모델/클라이언트 체계의 정합성을 새로 관리해야 한다. 이번 목적만으로는 추가 도입 이점이 Drizzle보다 명확하지 않다. |

버전은 구현 시 안정 릴리스를 확인·고정한다. 현재 Drizzle 문서의 RC 설치 예시를 그대로 복사해 운영에 도입하지 않는다. ‘유행’이나 임의의 성능 우열이 아니라 현재 구조와 변경 범위를 기준으로 선택했다.

## 도입 경계

1. 서버 전용 `db`/서비스 모듈: Next API는 인증·요청 검증, 서비스는 tx를 받아 업무 로직 수행. 같은 업무에서 supabase-js 쓰기와 드라이버 쓰기를 혼합하지 않는다.
2. Supabase Auth는 유지. 드라이버 연결에 사용자의 JWT/RLS 문맥은 자동 전달되지 않는다. 기본 postgres 계정을 그대로 앱의 만능 연결로 쓰지 말고 제한된 DB 역할 및 트랜잭션에 한정된 신뢰할 수 있는 사용자 문맥을 설계해 기존 RLS를 유지하는 방식을 우선 검증한다. 실제 사용자 ID는 서버 검증 결과만 사용한다. 별도 권한 모델을 선택해도 모든 소유권 검사가 검증돼야 한다.
3. 서버리스용 Supabase transaction pooler + 작은 재사용 pg Pool. Vercel 인스턴스 증가에 따른 전체 연결 수, idle 수명, 타임아웃, TLS, transaction-pooling 제약을 확인한다. transaction pooler 자체가 여러 HTTP 요청을 묶어주는 것은 아니다.
4. AI/OCR/Storage/SMS는 트랜잭션 밖. 저장 전후 버전 검사, 발송 멱등성 등 필요한 프로토콜을 별도로 둔다.
5. Supabase SQL 마이그레이션을 DB 변경의 원본으로 계속 사용한다. 초기 Drizzle 도입은 기존 스키마 매핑부터 하며, schema push/synchronize로 운영 구조를 자동 덮어쓰지 않는다. 개발·운영 DB 연결도 별도로 설정한다.
6. 첫 적용은 기간 관리 + 달력 날짜 이동/재정렬. 권한·중간 실패·동시 실행·재시도·날짜 경계를 통합 테스트하고, 이어서 위험도가 큰 단어 세팅/시험 교체/결과 저장을 전환한다.
7. 이번 미적용 `manage_class_period` SQL은 드라이버 방식으로 전환을 확정하면 API 교체와 함께 제거한다. 파일만 먼저 지우거나 미설치 상태의 RPC 코드를 배포하면 저장이 실패한다. 급히 UI를 배포해야 한다면 기존 RPC안을 먼저 적용하는 선택도 가능하다.

## 근거 문서

- PostgREST 요청 단위 트랜잭션: https://docs.postgrest.org/en/stable/references/transactions.html
- Supabase 드라이버/풀 연결: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase Drizzle 연결: https://supabase.com/docs/guides/database/drizzle
- Drizzle PostgreSQL 드라이버: https://orm.drizzle.team/docs/get-started-postgresql
- Drizzle 트랜잭션: https://orm.drizzle.team/docs/transactions
- pg의 동일 client 트랜잭션: https://node-postgres.com/features/transactions
- Vercel 연결 풀: https://vercel.com/kb/guide/connection-pooling-with-functions

현재 설치된 함수와 활성 트리거는 2026-09-29 카탈로그 조회 시점 기준이다. 특정 함수의 실제 호출 횟수, 운영 오류율, 연결 수·지연 벤치마크는 이번 감사에서 측정하지 않았다.
