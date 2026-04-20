-- exam_bank.question_count 캐싱 컬럼 + 트리거
-- 시험 목록 조회 시 매번 count(*) aggregate 도는 비용 제거

alter table exam_bank
  add column if not exists question_count int not null default 0;

-- 기존 데이터 백필
update exam_bank eb
set question_count = sub.cnt
from (
  select exam_bank_id, count(*)::int as cnt
  from exam_bank_question
  group by exam_bank_id
) sub
where eb.id = sub.exam_bank_id;

-- 트리거: insert/delete 시 카운트 갱신
create or replace function exam_bank_question_count_sync()
returns trigger
language plpgsql
security definer
as $$
begin
  if (tg_op = 'INSERT') then
    update exam_bank set question_count = question_count + 1 where id = new.exam_bank_id;
  elsif (tg_op = 'DELETE') then
    update exam_bank set question_count = greatest(question_count - 1, 0) where id = old.exam_bank_id;
  elsif (tg_op = 'UPDATE') and new.exam_bank_id is distinct from old.exam_bank_id then
    update exam_bank set question_count = greatest(question_count - 1, 0) where id = old.exam_bank_id;
    update exam_bank set question_count = question_count + 1 where id = new.exam_bank_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_exam_bank_question_count_sync on exam_bank_question;
create trigger trg_exam_bank_question_count_sync
after insert or update or delete on exam_bank_question
for each row execute function exam_bank_question_count_sync();
