---
name: migration
description: DB 스키마 변경(테이블/컬럼/인덱스/RLS 추가·변경)이 필요할 때 migration SQL 파일을 규칙에 맞게 만들고, 개발/운영 양쪽 적용 체크리스트를 출력한다. 스키마를 건드리는 코드를 짜기 전·후 반드시 사용.
argument-hint: <변경 내용 설명>
---

# DB 마이그레이션 생성

EduNote 는 개발 DB(.env.local)와 운영 DB(Vercel)가 분리되어 있고, 마이그레이션은
**사용자가 양쪽 SQL Editor 에 직접 붙여넣어** 적용한다. 이 스킬은 그 워크플로를 강제한다.

## 절차

1. **현재 스키마 확인.** `supabase/migrations/` 가 공유 기록의 원본이다 —
   초기 스키마(`20260323160235_remote_schema.sql`)와 이후 파일들에서 대상 테이블의
   현재 모습(컬럼, RLS 정책)을 확인한다. 개발 DB 실물이 궁금하면
   `mcp__supabase__list_tables` 로 검증할 수 있다 (개발 DB 기준일 뿐, 운영 DB 상태의
   근거가 아님에 주의).

2. **파일 생성.** `supabase/migrations/YYYYMMDD00000N_영문_snake_case.sql`
   - 날짜는 오늘, 시퀀스는 같은 날짜의 기존 파일 다음 번호 (예: `20260807000001_...`).
   - 설명은 영문 snake_case (기존 파일들과 통일).

3. **SQL 은 멱등하게 쓴다.** 사용자가 실수로 두 번 붙여넣어도 안전해야 한다.
   - `create table if not exists`, `alter table ... add column if not exists`,
     `create index if not exists`
   - 정책 교체는 `drop policy if exists ...; create policy ...` 패턴
   - **새 테이블은 반드시 `enable row level security` + 정책까지 포함한다.**
     정책 모양은 remote_schema.sql 이나 최근 마이그레이션의 같은 성격 테이블을 따라 쓴다.

4. **직접 적용 금지.** `mcp__supabase__apply_migration` / `execute_sql` 로 DB 에
   적용하지 않는다. 적용은 사용자 몫이다.

5. **코드도 같은 변경에 포함.** `src/lib/types.ts` 타입과 해당 스키마를 쓰는 코드를
   같이 갱신한다 (마이그레이션 파일만 만들고 끝내지 않는다).

## 마무리 보고 형식

작업 보고에 반드시 포함:

- 생성한 파일 경로
- 복사용 SQL 전문 (```sql 블록)
- 적용 체크리스트:
  - [ ] 개발 DB (`.env.local` 의 Supabase 프로젝트) SQL Editor 에 적용
  - [ ] 운영 DB (Vercel 프로젝트) SQL Editor 에 적용
- 마이그레이션 적용 전에는 새 코드가 동작하지 않는다는 점을 명시
