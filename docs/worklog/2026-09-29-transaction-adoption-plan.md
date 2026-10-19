# 서버 트랜잭션 계층 도입 상세 검토

2026-09-29. 앞선 `2026-09-29-transaction-architecture-audit.md`의 저장 경로 감사에 이어, 실제 개발/운영 DB의 정책·제약·권한과 첫 전환 범위를 확인했다. 이번 작업은 읽기 전용 조사와 문서 작성이다. 앱 코드·의존성·DB·배포 설정은 변경하지 않았다.

## 판단

**Next.js Node 서버 안에 Drizzle + pg + Supabase transaction pooler를 점진 도입하는 것이 적절하다.** 별도 서버나 DB 이전은 필요하지 않다. Auth·Storage·기존 조회는 supabase-js를 유지하고, 여러 저장이 함께 성공해야 하는 업무를 서버 서비스의 한 transaction으로 묶는다. 기존 유용한 RPC와 트리거는 유지한다.

단순 연결 라이브러리 설치로 완료되는 작업은 아니다. 사용자 권한 전달, 최소 권한 DB 계정, 서로 경쟁하는 저장 경로의 잠금 규칙, 운영과 같은 정책으로 수행하는 통합 테스트가 함께 필요하다. 도입 타당성은 확인했지만 실제 드라이버 접속·부하·운영 배포 검증을 완료한 상태는 아니다.

## 추가 확인한 사실

### 개발/운영의 RLS가 다르다

시스템 카탈로그 SELECT로 teacher/class/class_period/week를 비교했다. 양쪽 모두 RLS는 켜져 있고 주요 제약·인덱스는 일치한다. 그러나 정책은 다르다.

| 대상 | 운영 | 개발 |
|---|---|---|
| teacher | auth.uid()와 auth_id 비교 | `allow all`, USING/WITH CHECK true |
| class | my_teacher_id()로 쓰기 소유권 검사, 공개 SELECT 정책도 존재 | `allow all` 및 공개 SELECT |
| week | my_teacher_id()로 쓰기 소유권 검사, 공개 SELECT 정책도 존재 | `allow all` |
| class_period | 교사→반 소유권 검사 | 동일한 소유권 검사 |
| my_teacher_id() | SECURITY DEFINER 함수 존재 | 없음 |

따라서 개발 DB에서 성공했다는 사실만으로 운영의 RLS 호환성과 교사 간 격리를 증명할 수 없다. 실제 운영 정책을 재현한 격리 PostgreSQL 환경에서 먼저 테스트하고, 개발 정책도 변경 영향을 확인해 정합성을 맞추는 것이 필요하다. 개발 DB 전체를 운영 스키마로 덮어쓰는 방식은 사용하지 않는다.

운영 소유권 정책의 해당 조건은 교사 승인 상태까지 검사하지 않는다. 현재 `src/lib/api.ts`의 getTeacherId가 approved 여부를 검사하므로 새 서비스에서도 이 검사를 유지한다. class/week의 공개 SELECT 정책 때문에 RLS가 켜져 있어도 SELECT 결과만으로 소유권을 인정하면 안 된다. 서버에서 teacher_id를 명시적으로 확인한다.

### DB 드라이버 계정은 별도로 제한해야 한다

운영에서 위 네 테이블의 authenticated/anon에는 SELECT/INSERT/UPDATE/DELETE 외에 TRUNCATE/REFERENCES/TRIGGER 권한도 부여되어 있다. 이는 HTTP API가 해당 작업을 모두 제공한다는 뜻은 아니다. 하지만 직접 SQL을 실행하는 새 계정에 이 권한을 그대로 상속시키는 것은 피해야 한다. TRUNCATE는 RLS 보호 대상이 아니다.

앞선 감사의 ‘authenticated 역할로 전환하는 방식 우선 검토’를 구체화한 결과, **전용 NOBYPASSRLS·비소유자 로그인 역할에 필요한 권한만 직접 부여**하는 방식을 우선 추천한다. authenticated 역할의 포괄 상속/SET ROLE은 기본안에서 제외한다. 첫 대상 정책은 PUBLIC에 적용되므로 사용자 문맥이 올바르면 기존 정책을 활용할 수 있다. 이후 대상 테이블에 역할 한정 정책이 있으면 별도로 검토한다.

전용 역할은 임의 스키마 생성·DDL·TRUNCATE·역할 변경을 허용하지 않는다. PUBLIC에서 물려받는 schema/function 권한과 SECURITY DEFINER 함수 실행 권한도 확인해야 하며, NOBYPASSRLS만 설정했다고 최소 권한 검증이 끝나는 것은 아니다. 교사 테이블은 첫 범위에서 조회 권한만 필요하다. 조회 공개 범위를 더 줄이려면 전용 역할에만 적용되는 restrictive 정책을 검토한다. 기존 공유 화면 정책을 무작정 변경하지 않는다.

### 동시에 전환해야 하는 주차 변경 경로가 있다

- `src/hooks/use-weeks.ts`의 날짜 이동은 PUT 후 reorder POST를 호출한다. 한 서버 작업으로 합쳐야 한다.
- `classes/[id]/weeks/route.ts`는 최대 번호를 읽고 +1로 INSERT한다. 동시 추가가 같은 번호를 계산할 수 있다.
- `weeks/extend`는 주차 INSERT 후 class.end_date를 UPDATE한다. 둘을 한 transaction으로 묶어야 한다.
- `weeks/sync`, `weeks/reorder`는 기존 번호를 임시 음수로 바꾼 뒤 최종 번호를 쓴다.
- `weeks/[id]` PUT도 날짜를 수정할 수 있다. 새 이동 API만 잠그고 이 경로를 그대로 두면 동일 규칙을 우회한다.

기존 UNIQUE(class_id, week_number)와 반당 is_current 한 개의 partial unique index는 양쪽 DB에 존재한다. 유지한다. 반 행을 먼저 잠그고 최신 상태를 조회·계산·저장하도록 관련 경로를 통일한다. unique 충돌을 피하는 두 단계 재번호 부여는 같은 tx 안에서 수행할 수 있다. 같은 날짜의 정렬 기준, 날짜 없는 주차 포함, 기존 비정상 음수 번호 충돌 처리를 함께 명세한다. 잠금은 참여하는 모든 경로가 같은 규칙을 사용할 때 의미가 있다.

### 지역 차이가 있어 지연은 측정해야 한다

저장소 vercel.json은 icn1(서울)을 지정한다. 연결된 프로젝트 메타데이터상 운영 DB는 싱가포르, 개발 DB는 도쿄다. 실제 배포의 함수 위치·네트워크 지연을 측정한 것은 아니다. SQL 왕복 횟수가 늘면 지연이 커질 수 있으므로 반복 UPDATE를 배치하고, pilot에서 기존 HTTP 경로와 p50/p95 및 잠금 대기를 비교한다. 이번 도입 때문에 DB 지역을 즉시 이전할 필요는 없다.

## 권장 구조와 경계

`Next API 인증/입력 검증 → withTeacherTransaction(user.id, tx => 업무 서비스) → Supabase PostgreSQL`

1. Auth.getUser()로 확인한 ID만 사용자 문맥으로 받는다. body의 teacher_id/user_id나 미검증 JWT 내용을 신뢰하지 않는다.
2. 전용 역할의 pg 연결로 transaction을 시작한다. request.jwt.claims 등 auth.uid()에 필요한 문맥을 parameter binding + transaction-local set_config로 설정한다. 문맥 설정 없이 업무 SQL을 실행할 수 없도록 래퍼를 좁힌다. 역할명·테이블명은 사용자 입력으로 조립하지 않는다.
3. 같은 tx에서 승인된 교사와 반 소유권을 확인하고 필요한 반 행을 잠근다. 승인 철회와 진행 중 저장의 경계도 테스트/명세한다. 단순 재조회만으로 모든 승인 변경 경쟁이 해결된다고 보지 않는다.
4. 내부 서비스는 tx를 명시적으로 받는다. 내부에서 새로운 transaction이나 supabase-js 쓰기를 시작하지 않는다. Drizzle tx callback에서 오류를 삼키고 성공을 반환하지 않도록 한다. 0행 UPDATE/DELETE도 필요한 경우 충돌·권한 오류로 판정한다.
5. commit/rollback 후 사용자 문맥은 남지 않아야 한다. 같은 풀 연결을 다른 사용자가 재사용하는 경우까지 테스트한다. DB 비밀번호를 가진 서버는 사용자 문맥을 설정할 수 있으므로 이 계층은 신뢰 경계다. 문맥 설정 자체가 DB의 JWT 서명 검증을 대신하는 것은 아니다.

제안 파일 경계: `src/lib/db/{pool,schema,transaction}.ts`, `src/lib/services/{class-periods,class-weeks}.ts`. 이름은 구현 때 확정한다. schema.ts는 우선 네 테이블의 실제 타입·날짜·nullable/default를 매핑하며, DB 변경의 원본은 기존 supabase/migrations SQL이다. drizzle-kit push/자동 synchronize는 사용하지 않는다.

Node runtime, 서버 전용 모듈, 서버 전용 DATABASE_URL을 사용한다. 개발/Preview/운영 연결을 분리한다. 공유 transaction pooler의 실제 Connect 문자열을 사용하고 호스트를 추측하지 않는다. pg Pool을 모듈 단위로 재사용하고 Vercel attachDatabasePool 적용을 검토한다. 인스턴스당 작은 풀로 시작하되 전체 연결 예산과 부하 결과로 수치를 정한다. named prepared statements/Drizzle prepare 사용을 피하고 TLS 인증서를 검증한다. 연결·statement·lock·idle-in-transaction 타임아웃은 함수 실행 제한보다 짧게 설정한다.

## 전환 순서

1. **기반과 권한 검증:** 운영 정책을 재현한 테스트 DB, 전용 역할/권한 SQL, 연결·tx 래퍼, 타입 매핑. 역할 비밀번호는 SQL 파일/Git에 넣지 않고 환경별 비밀로 관리한다. DB 함수 대신 드라이버를 사용해도 초기 역할·권한 설정 SQL은 필요하다. 개발/운영 적용은 프로젝트 규칙대로 사용자가 수행한다.
2. **기간 관리:** 생성·수정·기본 기간 선택·삭제를 tx 서비스로 이전한다. 아직 양쪽 DB에 설치하지 않은 manage_class_period RPC 의존성과 SQL은 API 전환과 함께 정리한다. 날짜와 공유 기본 기간을 분리한 현재 UI 동작은 보존한다.
3. **주차 변경 묶음:** 수업 추가·연장·sync·날짜 수정·재정렬을 동일 잠금 규칙으로 전환한다. 반 생성의 초기 주차·기본 기간 생성도 한 tx로 정리한다. 기존 클라이언트의 이동 PUT+reorder 두 요청은 단일 작업으로 바꾼다.
4. **데이터 손실 우선:** 단어 세팅 교체 → 단어시험 교체 → 모의고사 답안/점수 → 채점 집계 → 학생 등록/퇴원. 각 단계별 실패 테스트와 배포 관찰을 거친다. AI/OCR 계산은 밖에서 마치고 데이터 버전을 확인한 뒤 짧게 저장한다.

SMS/Storage/LLM을 기다리는 동안 tx를 유지하지 않는다. SMS는 outbox/멱등성 등 별도 작업으로 다룬다. ‘전체 앱 전환 완료’와 ‘첫 기능 도입 완료’를 구분한다.

## 배포 통과 기준

- 각 저장 단계에 실패를 넣어 기존 데이터·기본 기간·주차 번호가 모두 복원되는지 실제 PostgreSQL로 검증한다. mock 테스트만으로 tx를 검증하지 않는다.
- 다른 교사/미승인/차단/로그아웃 및 다른 사용자로 연결 재사용을 검사한다. 원하지 않는 DDL/TRUNCATE/역할 전환이 거절되는지도 격리 DB에서 확인한다.
- 같은 반의 추가+추가, 이동+sync, 기간 기본값 변경+변경을 동시 실행해 중복 번호·갱신 유실·교착 처리를 확인한다. DB 오류를 그대로 사용자에게 노출하지 않는다.
- 재시도는 rollback이 확실한 deadlock/serialization 실패에 한정해 설계한다. commit 응답이 유실되면 성공 여부가 불명확하므로 생성/연장 요청을 무조건 재실행하지 않는다. 중복 방지 키 또는 결과 조회 절차를 정의한다.
- 날짜 문자열/시간대, 응답 형식, React Query 무효화, 기존 공유 기본 기간 동작을 회귀 검증한다.
- 코드 변경 후 npm run check, build 및 격리 통합 테스트. 개발 배포에서 실제 pooler/TLS/역할 문맥까지 확인한 뒤 운영 반영한다.
- DB 역할/환경변수 준비 없이 새 코드를 먼저 배포하지 않는다. 드라이버 장애 시 기존 비원자적 HTTP 저장으로 자동 fallback하지 않는다. 초기에는 전환 범위를 작게 유지하고 쓰기 기능 중단 또는 검증된 이전 배포로 복귀하는 운영 절차를 둔다. 기존 미설치 RPC 코드로 되돌리는 것을 안전한 rollback으로 보지 않는다.

## 확인 범위와 참고

이번 추가 검토는 정책·역할 속성·제약·인덱스·운영 테이블 grants의 읽기 전용 조회와 소스 추적이다. 업무 데이터 조회/변경, 역할 생성, 의존성 설치, 실제 SQL 드라이버 연결, 부하 테스트, UI 조작, 배포는 수행하지 않았다. 문서만 추가했으므로 앱 테스트를 다시 실행하지 않았다. 앞선 감사의 격리 오류 재현 결과를 실제 운영 장애 이력으로 해석하지 않는다.

- [Supabase 연결 방식과 pooler 제한](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Vercel pg 연결 풀 관리](https://vercel.com/kb/guide/connection-pooling-with-functions)
- [Drizzle transaction API](https://orm.drizzle.team/docs/transactions)
- [PostgreSQL RLS: TRUNCATE 제외와 정책 적용](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
- [Supabase DB 역할](https://supabase.com/docs/guides/database/postgres/roles)
