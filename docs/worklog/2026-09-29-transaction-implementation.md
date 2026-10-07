# 서버 트랜잭션 계층 1차 도입

## 구현 범위

Next.js Node API 내부에 Drizzle 0.45.3 + pg 8.23.0을 도입했다. 별도 백엔드나 DB 이전은 없다. Auth, Storage, 기존 조회와 기존 RPC/트리거는 유지한다. 서버 전용 `withTeacherTransaction`이 같은 pg client의 BEGIN/COMMIT/ROLLBACK/release를 관리하고, 내부 서비스에는 그 연결에 바인딩한 Drizzle 객체를 전달한다.

- 기간 생성·수정·삭제·공유 기본 지정: 반 행 잠금 후 한 transaction으로 저장. 공유 기본 지정은 날짜를 바꾸지 않는다. 새 기간 생성 실패 시 이전 날짜/기본값 변경도 복원된다.
- 반 생성: 반 + 초기 주차 + 기본 기간을 함께 저장.
- 수업 추가·연장·sync·재정렬·날짜 수정: 같은 반 행 잠금 규칙 사용. 최대 주차 번호 계산은 잠금 뒤에 수행한다. 연장 주차와 반 종료일도 함께 저장한다.
- 달력 이동: 날짜 PUT 안에서 번호 재정렬까지 완료. 브라우저의 후속 reorder 요청을 제거했다. 기존 reorder HTTP 경로도 같은 서비스로 연결해 호환성을 유지했다.
- 주차 정렬: 날짜 → 기존 번호 → ID로 안정 정렬하고 날짜 없는 주차도 마지막에 보존한다. 기존 음수와 겹치지 않는 임시 번호를 골라 두 번의 배치 UPDATE로 정렬한다.
- 오류: 날짜/입력 검증, 권한/누락/충돌 응답을 구분하고 SQL·파라미터·접속 문자열을 오류 응답/로그에 출력하지 않는다. 연결 장애 시 비원자적 HTTP 저장으로 fallback하지 않는다.
- 재시도: 자동 재시도 없음. COMMIT 응답 유실 시 실제 저장 여부가 불명확하므로 연결을 폐기하고 새로고침으로 결과를 확인하도록 안내한다. 별도 멱등성 키 저장소는 이번 범위에 포함하지 않았다.

Auth.getUser()로 검증된 ID만 transaction-local 사용자 문맥에 넣는다. 해당 교사의 approved 상태를 확인한 후 쓰기 서비스에 진입한다. 새 역할 전용 restrictive RLS도 승인/소유권을 검사한다. 진행 중 승인 철회의 의미는 각 SQL 문이 보는 승인 상태를 기준으로 한다. 이미 완료한 저장을 승인 철회가 소급 취소하지는 않는다.

기간용 manage_class_period RPC안은 개발/운영에 미적용 상태에서 제거했다. 해당 SQL과 구식 검증 스크립트는 더 이상 사용하지 않는다. DB의 유용한 기존 함수/트리거는 삭제하지 않았다.

## 연결·권한

- `DATABASE_URL`: 전용 `edunote_app.<project-ref>` 계정의 Supabase shared transaction pooler, 포트 6543.
- pg Pool은 프로세스에서 재사용하고 max=5, idle=5초, connection timeout=5초로 시작한다. Vercel attachDatabasePool을 연결했다. 인스턴스가 늘면 총 연결 수도 늘어나므로 운영 관찰 후 조정한다.
- TLS 인증서 검증을 유지한다. 필요하면 DATABASE_CA_CERT에 프로젝트 CA PEM을 설정한다. URL query option은 제거해 ssl=false/user=postgres 같은 설정 덮어쓰기를 차단한다.
- SQL statement/idle-in-transaction timeout 10초, lock timeout 3초. named prepared statement는 사용하지 않는다. AI/OCR/SMS/Storage 대기는 transaction 안에 넣지 않는다.
- 실제 업무 쿼리는 새로운 DB 역할로 실행한다. 이 역할은 테이블 소유자/BYPASSRLS/관리자 역할이 아니며, authenticated의 광범위한 권한을 상속하지 않는다. 필요한 네 테이블에만 명시적인 권한을 부여한다.
- 기존 개발 DB의 allow-all 정책은 다른 역할의 동작을 유지하기 위해 삭제하지 않았다. 새 역할에만 restrictive 정책을 붙여 공개 SELECT/allow-all 정책으로도 교사 격리가 풀리지 않게 했다. 이는 개발 DB 전체 보안 정책 정리를 완료했다는 의미가 아니다.
- 운영 카탈로그에서 확인한 PUBLIC SECURITY DEFINER 함수는 소유권 확인 함수 두 개와 문항 수 트리거 함수였다. 전용 계정 비밀번호는 서버 비밀이다. 서버가 사용자 문맥을 지정할 수 있으므로 브라우저에 이 계정/URL을 노출하면 안 된다.

## 적용 순서 — 아직 실행하지 않음

AGENTS.md의 DB 마이그레이션 규칙에 따라 실제 개발/운영 SQL 적용은 사용자가 수행한다. 아래 준비 전에는 새 저장 API를 배포하지 않는다. DATABASE_URL이 없으면 해당 쓰기 API는 503을 반환한다.

1. 개발/운영 양쪽 SQL Editor에서 `supabase/migrations/20260929101449_server_transaction_role.sql`을 각각 적용한다. 업무 데이터는 변경하지 않고 역할·권한·역할 전용 정책을 준비한다. 기존 권한이 예상보다 넓으면 검사에서 중단한다. 오류를 무시하고 다음 단계로 넘어가지 않는다.
2. 각 환경에서 서로 다른 강한 비밀번호로 `edunote_app`의 LOGIN과 PASSWORD를 설정한다. 비밀번호가 포함된 SQL은 Git/이 문서에 저장하지 않는다. 마이그레이션은 비밀번호 없이 NOLOGIN으로 생성한다.
3. Supabase Connect 화면에서 실제 transaction pooler 주소를 확인한다. username을 `edunote_app.<project-ref>`로 하고 해당 역할 비밀번호를 URL 인코딩하여 사용한다. DB 관리자 postgres 비밀번호나 service_role API 키를 대신 사용하지 않는다.
4. `.env.local`은 개발 연결, Vercel Preview는 개발/검증 연결, Production은 운영 연결로 DATABASE_URL을 각각 설정한다. 필요시 CA PEM도 설정한다. 앱의 NEXT_PUBLIC_SUPABASE_URL과 같은 프로젝트인지 확인한다.
5. 개발 배포에서 실제 pooler의 TLS/사용자 문맥, 다른 교사 접근 차단, 저장 후 새로고침을 검증한다. 운영 적용 전 실제 pooler 지연/연결 수/잠금 대기를 확인한다. 로컬 PostgreSQL 검증은 Supavisor 실접속 검증을 대신하지 않는다.
6. 검증된 앱을 배포한다. 장애 시 검증된 이전 배포로 되돌리거나 해당 쓰기를 중단한다. 미설치 manage_class_period RPC를 호출하던 중간 작업 상태로 되돌리지 않는다. 추가한 역할 정책은 기존 앱 역할에 적용되지 않으므로 앱 rollback을 위해 즉시 삭제할 필요는 없다.

환경별 비밀번호/연결 정보는 생성하거나 변경하지 않았다. 이번 변경은 커밋·푸시·배포하지 않았다.

## 검증 방법

실행 결과: 전체 check 통과(53개 파일, 677개 테스트; lint 0 errors / 기존 23 warnings), Next production build 통과. 별도 PostgreSQL 18.4 + 실제 pg Pool의 동시성/롤백 테스트 4개도 통과했다. Supabase 운영 DB의 PostgreSQL 17 및 실제 Supavisor/TLS 접속은 아직 검증하지 않았다. 공유 화면·인쇄 등 다른 작업의 변경은 이번 트랜잭션 구현에서 수정하지 않았다.

- `npm run check -- --maxWorkers=2 --minWorkers=1`: 타입체크 + lint + 전체 unit/component 테스트. 새 PGlite 검증은 실제 PostgreSQL 엔진에서 합성 데이터만 사용한다. 과금되는 test:parse는 실행하지 않는다.
- `npm run build`: Next.js production 빌드. 드라이버는 서버에만 포함되고 build 시 DB 접속을 요구하지 않는다.
- `tests/unit/transaction-services.test.ts`: DB 중간 실패를 주입한 롤백, 날짜 보존, 기본 기간 삭제 방지, 음수/NULL 날짜 재정렬, 개발/운영 형태 정책의 교사 격리, TRUNCATE/DDL/교사 승인 변경 거절.
- `tests/unit/transaction-boundary.test.ts`: 같은 연결의 commit/rollback/release, 승인 거절, rollback 실패 연결 폐기, COMMIT 응답 유실 시 미재시도.
- `tests/unit/db-pool-config.test.ts`: 전용 역할/포트 제한과 TLS 덮어쓰기 차단.
- `tests/database/class-transactions.test.ts`: 별도 로컬 PostgreSQL의 실제 pg Pool로 동시 추가, 이동+sync+연장, 기본 기간 동시 변경, 롤백과 연결 재사용의 사용자 문맥 격리를 검증한다. 기본 npm run check에는 포함하지 않는다.

로컬 다중 연결 검증 도구는 `scripts/verify-transactions-local.mjs`이며 `.env`를 읽지 않는다. 루프백 전용 임시 클러스터와 `edunote_tx_test` DB만 생성하고 검사 뒤 프로세스를 종료한다. 임시 설치/데이터는 `tmp/transaction-pg`에 격리한다. 실행법은 스크립트 상단에 적었다. 운영·개발 Supabase에 fixture를 적용하면 안 된다.

## 다음 전환 범위

단어 세팅 교체 → 단어시험 교체 → 모의고사 답안/점수 → 채점 집계 → 학생 등록/퇴원은 아직 기존 저장 방식을 사용한다. 이번 변경은 공통 계층과 기간/반/주차의 첫 도입이다. 후속 전환에서는 해당 테이블 권한·타입을 추가하고 AI 계산과 짧은 저장 transaction을 분리한다. SMS 발송은 외부 부작용이므로 별도 멱등성/outbox 설계가 필요하다.
