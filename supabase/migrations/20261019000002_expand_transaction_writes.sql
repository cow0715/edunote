-- Apply manually to BOTH development and production before deploying these APIs.
-- Extends the existing dedicated NOBYPASSRLS role. No role inheritance or DDL privileges,
-- no changes to existing application policies, functions, or triggers.
begin;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='edunote_app') then
    raise exception 'Apply 20260929101449_server_transaction_role.sql first';
  end if;
  if exists(select 1 from pg_roles where rolname='edunote_app' and
    (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication))
    or exists(select 1 from pg_auth_members where member='edunote_app'::regrole)
    or exists(select 1 from pg_class where relowner='edunote_app'::regrole) then
    raise exception 'edunote_app must remain an unprivileged non-owner role';
  end if;
end $$;

alter table public.student enable row level security;
revoke all on public.student from edunote_app;
grant select, insert, update, delete on public.student to edunote_app;
drop policy if exists edunote_app_write_allow on public.student;
create policy edunote_app_write_allow on public.student for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.student;
create policy edunote_app_write_scope on public.student as restrictive for all to edunote_app
  using (teacher_id in (select id from public.teacher where approval_status='approved')) with check (teacher_id in (select id from public.teacher where approval_status='approved'));

alter table public.class_student enable row level security;
revoke all on public.class_student from edunote_app;
grant select, insert, update, delete on public.class_student to edunote_app;
drop policy if exists edunote_app_write_allow on public.class_student;
create policy edunote_app_write_allow on public.class_student for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.class_student;
create policy edunote_app_write_scope on public.class_student as restrictive for all to edunote_app
  using (class_id in (select id from public.class) and student_id in (select id from public.student)) with check (class_id in (select id from public.class) and student_id in (select id from public.student));

alter table public.clinic_slot enable row level security;
revoke all on public.clinic_slot from edunote_app;
grant select on public.clinic_slot to edunote_app;
drop policy if exists edunote_app_write_allow on public.clinic_slot;
create policy edunote_app_write_allow on public.clinic_slot for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.clinic_slot;
create policy edunote_app_write_scope on public.clinic_slot as restrictive for all to edunote_app
  using (teacher_id in (select id from public.teacher where approval_status='approved')) with check (teacher_id in (select id from public.teacher where approval_status='approved'));

alter table public.clinic_enrollment enable row level security;
revoke all on public.clinic_enrollment from edunote_app;
grant select, update on public.clinic_enrollment to edunote_app;
drop policy if exists edunote_app_write_allow on public.clinic_enrollment;
create policy edunote_app_write_allow on public.clinic_enrollment for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.clinic_enrollment;
create policy edunote_app_write_scope on public.clinic_enrollment as restrictive for all to edunote_app
  using (teacher_id in (select id from public.teacher where approval_status='approved') and student_id in (select id from public.student) and clinic_slot_id in (select id from public.clinic_slot)) with check (teacher_id in (select id from public.teacher where approval_status='approved') and student_id in (select id from public.student) and clinic_slot_id in (select id from public.clinic_slot));

alter table public.exam_question enable row level security;
revoke all on public.exam_question from edunote_app;
grant select, insert, update, delete on public.exam_question to edunote_app;
drop policy if exists edunote_app_write_allow on public.exam_question;
create policy edunote_app_write_allow on public.exam_question for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.exam_question;
create policy edunote_app_write_scope on public.exam_question as restrictive for all to edunote_app
  using (week_id in (select id from public.week)) with check (week_id in (select id from public.week));

alter table public.vocab_word enable row level security;
revoke all on public.vocab_word from edunote_app;
grant select, insert, update, delete on public.vocab_word to edunote_app;
drop policy if exists edunote_app_write_allow on public.vocab_word;
create policy edunote_app_write_allow on public.vocab_word for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.vocab_word;
create policy edunote_app_write_scope on public.vocab_word as restrictive for all to edunote_app
  using (week_id in (select id from public.week)) with check (week_id in (select id from public.week));

alter table public.vocab_word_variant enable row level security;
revoke all on public.vocab_word_variant from edunote_app;
grant select, insert, update, delete on public.vocab_word_variant to edunote_app;
drop policy if exists edunote_app_write_allow on public.vocab_word_variant;
create policy edunote_app_write_allow on public.vocab_word_variant for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.vocab_word_variant;
create policy edunote_app_write_scope on public.vocab_word_variant as restrictive for all to edunote_app
  using (vocab_word_id in (select id from public.vocab_word)) with check (vocab_word_id in (select id from public.vocab_word));

alter table public.vocab_test enable row level security;
revoke all on public.vocab_test from edunote_app;
grant select, insert, update, delete on public.vocab_test to edunote_app;
drop policy if exists edunote_app_write_allow on public.vocab_test;
create policy edunote_app_write_allow on public.vocab_test for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.vocab_test;
create policy edunote_app_write_scope on public.vocab_test as restrictive for all to edunote_app
  using (week_id in (select id from public.week)) with check (week_id in (select id from public.week));

alter table public.vocab_test_item enable row level security;
revoke all on public.vocab_test_item from edunote_app;
grant select, insert, update, delete on public.vocab_test_item to edunote_app;
drop policy if exists edunote_app_write_allow on public.vocab_test_item;
create policy edunote_app_write_allow on public.vocab_test_item for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.vocab_test_item;
create policy edunote_app_write_scope on public.vocab_test_item as restrictive for all to edunote_app
  using (exists(select 1 from public.vocab_test t join public.vocab_word w on w.week_id=t.week_id where t.id=vocab_test_item.vocab_test_id and w.id=vocab_test_item.vocab_word_id) and (vocab_word_variant_id is null or exists(select 1 from public.vocab_word_variant v where v.id=vocab_test_item.vocab_word_variant_id and v.vocab_word_id=vocab_test_item.vocab_word_id))) with check (exists(select 1 from public.vocab_test t join public.vocab_word w on w.week_id=t.week_id where t.id=vocab_test_item.vocab_test_id and w.id=vocab_test_item.vocab_word_id) and (vocab_word_variant_id is null or exists(select 1 from public.vocab_word_variant v where v.id=vocab_test_item.vocab_word_variant_id and v.vocab_word_id=vocab_test_item.vocab_word_id)));

alter table public.week_score enable row level security;
revoke all on public.week_score from edunote_app;
grant select, insert, update, delete on public.week_score to edunote_app;
drop policy if exists edunote_app_write_allow on public.week_score;
create policy edunote_app_write_allow on public.week_score for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.week_score;
create policy edunote_app_write_scope on public.week_score as restrictive for all to edunote_app
  using (week_id in (select id from public.week) and student_id in (select id from public.student)) with check (week_id in (select id from public.week) and student_id in (select id from public.student));

alter table public.student_answer enable row level security;
revoke all on public.student_answer from edunote_app;
grant select, insert, update, delete on public.student_answer to edunote_app;
drop policy if exists edunote_app_write_allow on public.student_answer;
create policy edunote_app_write_allow on public.student_answer for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.student_answer;
create policy edunote_app_write_scope on public.student_answer as restrictive for all to edunote_app
  using (exists(select 1 from public.week_score s join public.exam_question q on q.week_id=s.week_id where s.id=student_answer.week_score_id and q.id=student_answer.exam_question_id)) with check (exists(select 1 from public.week_score s join public.exam_question q on q.week_id=s.week_id where s.id=student_answer.week_score_id and q.id=student_answer.exam_question_id));

alter table public.student_vocab_answer enable row level security;
revoke all on public.student_vocab_answer from edunote_app;
grant select, insert, update, delete on public.student_vocab_answer to edunote_app;
drop policy if exists edunote_app_write_allow on public.student_vocab_answer;
create policy edunote_app_write_allow on public.student_vocab_answer for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.student_vocab_answer;
create policy edunote_app_write_scope on public.student_vocab_answer as restrictive for all to edunote_app
  using (exists(select 1 from public.week_score s join public.vocab_word w on w.week_id=s.week_id where s.id=student_vocab_answer.week_score_id and w.id=student_vocab_answer.vocab_word_id) and (vocab_word_variant_id is null or exists(select 1 from public.vocab_word_variant v where v.id=student_vocab_answer.vocab_word_variant_id and v.vocab_word_id=student_vocab_answer.vocab_word_id))) with check (exists(select 1 from public.week_score s join public.vocab_word w on w.week_id=s.week_id where s.id=student_vocab_answer.week_score_id and w.id=student_vocab_answer.vocab_word_id) and (vocab_word_variant_id is null or exists(select 1 from public.vocab_word_variant v where v.id=student_vocab_answer.vocab_word_variant_id and v.vocab_word_id=student_vocab_answer.vocab_word_id)));

alter table public.mock_exam enable row level security;
revoke all on public.mock_exam from edunote_app;
grant select, insert, update, delete on public.mock_exam to edunote_app;
drop policy if exists edunote_app_write_allow on public.mock_exam;
create policy edunote_app_write_allow on public.mock_exam for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.mock_exam;
create policy edunote_app_write_scope on public.mock_exam as restrictive for all to edunote_app
  using (teacher_id in (select id from public.teacher where approval_status='approved') and (class_id is null or class_id in (select id from public.class))) with check (teacher_id in (select id from public.teacher where approval_status='approved') and (class_id is null or class_id in (select id from public.class)));

alter table public.mock_exam_question enable row level security;
revoke all on public.mock_exam_question from edunote_app;
grant select, insert, update, delete on public.mock_exam_question to edunote_app;
drop policy if exists edunote_app_write_allow on public.mock_exam_question;
create policy edunote_app_write_allow on public.mock_exam_question for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.mock_exam_question;
create policy edunote_app_write_scope on public.mock_exam_question as restrictive for all to edunote_app
  using (mock_exam_id in (select id from public.mock_exam)) with check (mock_exam_id in (select id from public.mock_exam));

alter table public.mock_exam_result enable row level security;
revoke all on public.mock_exam_result from edunote_app;
grant select, insert, update, delete on public.mock_exam_result to edunote_app;
drop policy if exists edunote_app_write_allow on public.mock_exam_result;
create policy edunote_app_write_allow on public.mock_exam_result for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.mock_exam_result;
create policy edunote_app_write_scope on public.mock_exam_result as restrictive for all to edunote_app
  using (mock_exam_id in (select id from public.mock_exam) and student_id in (select id from public.student)) with check (mock_exam_id in (select id from public.mock_exam) and student_id in (select id from public.student));

alter table public.mock_exam_report enable row level security;
revoke all on public.mock_exam_report from edunote_app;
grant select, insert, update, delete on public.mock_exam_report to edunote_app;
drop policy if exists edunote_app_write_allow on public.mock_exam_report;
create policy edunote_app_write_allow on public.mock_exam_report for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.mock_exam_report;
create policy edunote_app_write_scope on public.mock_exam_report as restrictive for all to edunote_app
  using (mock_exam_result_id in (select id from public.mock_exam_result)) with check (mock_exam_result_id in (select id from public.mock_exam_result));

alter table public.concept_tag enable row level security;
revoke all on public.concept_tag from edunote_app;
grant select on public.concept_tag to edunote_app;
drop policy if exists edunote_app_write_allow on public.concept_tag;
create policy edunote_app_write_allow on public.concept_tag for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.concept_tag;
create policy edunote_app_write_scope on public.concept_tag as restrictive for all to edunote_app
  using (teacher_id in (select id from public.teacher where approval_status='approved')) with check (teacher_id in (select id from public.teacher where approval_status='approved'));

alter table public.exam_question_tag enable row level security;
revoke all on public.exam_question_tag from edunote_app;
grant select, insert, update, delete on public.exam_question_tag to edunote_app;
drop policy if exists edunote_app_write_allow on public.exam_question_tag;
create policy edunote_app_write_allow on public.exam_question_tag for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.exam_question_tag;
create policy edunote_app_write_scope on public.exam_question_tag as restrictive for all to edunote_app
  using (exam_question_id in (select id from public.exam_question) and concept_tag_id in (select id from public.concept_tag)) with check (exam_question_id in (select id from public.exam_question) and concept_tag_id in (select id from public.concept_tag));

alter table public.mock_exam_student_answer enable row level security;
revoke all on public.mock_exam_student_answer from edunote_app;
grant select, insert, update, delete on public.mock_exam_student_answer to edunote_app;
drop policy if exists edunote_app_write_allow on public.mock_exam_student_answer;
create policy edunote_app_write_allow on public.mock_exam_student_answer for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_write_scope on public.mock_exam_student_answer;
create policy edunote_app_write_scope on public.mock_exam_student_answer as restrictive for all to edunote_app
  using (exists(select 1 from public.mock_exam_result r join public.mock_exam_question q on q.mock_exam_id=r.mock_exam_id where r.id=mock_exam_student_answer.mock_exam_result_id and q.id=mock_exam_student_answer.mock_exam_question_id)) with check (exists(select 1 from public.mock_exam_result r join public.mock_exam_question q on q.mock_exam_id=r.mock_exam_id where r.id=mock_exam_student_answer.mock_exam_result_id and q.id=mock_exam_student_answer.mock_exam_question_id));

-- Fail atomically if PUBLIC privileges would defeat the dedicated role's limits.
do $$ declare t text; begin
  foreach t in array array['student','class_student','clinic_slot','clinic_enrollment','exam_question','vocab_word','vocab_word_variant','vocab_test','vocab_test_item','week_score','student_answer','student_vocab_answer','mock_exam','mock_exam_question','mock_exam_result','mock_exam_report','concept_tag','exam_question_tag','mock_exam_student_answer'] loop
    if has_table_privilege('edunote_app','public.'||t,'TRUNCATE')
      or has_table_privilege('edunote_app','public.'||t,'TRIGGER') then
      raise exception 'Unexpected PUBLIC privileges on %', t;
    end if;
  end loop;
end $$;
commit;
