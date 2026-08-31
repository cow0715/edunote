-- 학부모 공유 링크(student.share_token) 정기 회전 + 유예 기간
--
-- share_token 은 학생당 하나뿐이고 만료가 없어서 한 번 나간 링크가 영구히 살아 있었다.
-- 퇴원한 학생은 별도로 막았지만(lib/share-access), 재학생 링크가 오래된 문자·바꾼 폰에
-- 남아 도는 건 그대로다. 분기마다 새로 발급해 옛 링크의 수명에 상한을 둔다.
--
-- 유예 기간을 두는 이유: 새 링크는 주차 SMS 를 타고 나간다. 회전 즉시 옛 링크를 죽이면
-- 다음 문자가 갈 때까지(방학이 끼면 몇 주) 학부모가 못 본다. 옛 토큰을 28일 더 살려둔다.
--
-- share_token 이 uuid 라서 두 컬럼도 uuid 로 맞춘다
-- (초기 스키마 파일에는 text 로 적혀 있으나 실제 DB 는 uuid).

alter table public.student
  add column if not exists previous_share_token uuid,
  add column if not exists previous_share_token_expires_at timestamptz;

comment on column public.student.previous_share_token is
  '직전 share_token — 회전 후 유예 기간 동안만 유효. 지나면 만료 안내(410)를 돌려준다.';
comment on column public.student.previous_share_token_expires_at is
  '옛 토큰이 죽는 시각.';

-- 옛 토큰도 학생을 특정해야 하므로 현재 토큰과 같은 유일성이 필요하다
create unique index if not exists student_previous_share_token_key
  on public.student (previous_share_token)
  where previous_share_token is not null;

-- 회전 함수.
--
-- REST 로 한 번에 update 하면 모든 학생이 같은 값이 돼 unique 제약에 걸린다.
-- gen_random_uuid() 를 행마다 평가시키려면 SQL 안에서 돌려야 한다.
--
-- 유예가 아직 안 끝난 학생은 건너뛴다 — cron 재시도나 손으로 두 번 호출해도
-- 방금 발급한 링크를 다시 갈아엎지 않게 하는 안전장치다.
create or replace function public.rotate_share_tokens(grace_days integer default 28)
returns integer
language sql
volatile
as $$
  with rotated as (
    update public.student
       set previous_share_token = share_token,
           previous_share_token_expires_at = now() + make_interval(days => grace_days),
           share_token = gen_random_uuid()
     where share_token is not null
       and (previous_share_token_expires_at is null
            or previous_share_token_expires_at <= now())
    returning 1
  )
  select coalesce(count(*), 0)::integer from rotated;
$$;

comment on function public.rotate_share_tokens(integer) is
  '모든 학생의 share_token 을 새로 발급하고 직전 토큰을 grace_days 만큼 살려둔다. 유예 중인 학생은 건너뛴다.';
