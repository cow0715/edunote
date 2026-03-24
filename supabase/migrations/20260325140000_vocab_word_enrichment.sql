-- vocab_word 단어 뜻/유의어/반의어 컬럼 추가
alter table vocab_word
  add column if not exists correct_answer text,
  add column if not exists synonyms text[],
  add column if not exists antonyms text[];

-- student_vocab_answer share 페이지 공개 읽기
create policy "sva_public_read" on student_vocab_answer for select using (true);

-- week_score에 단어 시험지 사진 경로 추가
alter table week_score
  add column if not exists vocab_photo_path text;

-- vocab-photos Storage 버킷 정책 (인증된 사용자만 업로드/조회)
create policy "vocab_photos_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'vocab-photos');

create policy "vocab_photos_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'vocab-photos');

create policy "vocab_photos_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'vocab-photos');
