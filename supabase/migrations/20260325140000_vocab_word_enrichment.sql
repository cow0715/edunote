-- vocab_word 단어 뜻/유의어/반의어 컬럼 추가
alter table vocab_word
  add column if not exists correct_answer text,
  add column if not exists synonyms text[],
  add column if not exists antonyms text[];

-- student_vocab_answer share 페이지 공개 읽기
create policy "sva_public_read" on student_vocab_answer for select using (true);
