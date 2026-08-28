-- 예문 선택형([ A / B ]) 오답 후보 저장
--
-- 지금은 오답을 코드(vocab-choice-distractor)가 같은 단어장에서 철자·품사 유사도로 고른다.
-- 품사 정보가 없는 단어(주로 구)는 품사 축이 꺼져 문법이 안 되는 보기가 붙었고
-- ("Let's [ take a break / impressive ] and grab coffee"), 그런 문항은 뜻을 몰라도 맞힌다.
--
-- 문맥상 그럴듯한 오답은 문장 의미를 알아야 고를 수 있어 코드로는 한계가 있다.
-- 예문을 만들 때 이미 AI 를 부르므로, 그 호출에서 오답 후보까지 같이 받아 저장한다 (추가 호출 0).
alter table vocab_word
  add column if not exists example_distractor text;

comment on column vocab_word.example_distractor is
  '예문 선택형 오답 후보 — 예문 문장의 출제 단어 자리에 넣어도 문법은 성립하지만 뜻이 틀린 단어. 없으면 코드 규칙으로 폴백.';
