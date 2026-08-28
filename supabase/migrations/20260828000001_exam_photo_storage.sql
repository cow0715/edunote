-- 진단평가 답안지 사진 보관 — 원본 확인·재판독용 (vocab-photos 와 동일 패턴)
-- 사진이 없으면 OCR 이 틀렸을 때 재촬영 말고는 복구 수단이 없다.
-- 경로는 exam-photos/{weekId}/{studentId} (확장자 없음 — vocab 과 동일 규칙).

alter table week_score
  add column if not exists exam_photo_path text;

-- 버킷 (비공개). 이미 있으면 무시.
insert into storage.buckets (id, name, public)
values ('exam-photos', 'exam-photos', false)
on conflict (id) do nothing;

-- 정책: 인증된 사용자만 업로드/조회/갱신 (vocab_photos_* 와 동일 모양)
drop policy if exists "exam_photos_insert" on storage.objects;
create policy "exam_photos_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'exam-photos');

drop policy if exists "exam_photos_select" on storage.objects;
create policy "exam_photos_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'exam-photos');

drop policy if exists "exam_photos_update" on storage.objects;
create policy "exam_photos_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'exam-photos');

-- 정리 cron(/api/cron/cleanup) 이 service role 로 삭제하므로 delete 정책은 두지 않는다 (vocab 과 동일)
