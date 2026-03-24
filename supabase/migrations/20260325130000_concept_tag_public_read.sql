-- concept_tag, concept_category 공개 읽기 정책 추가
-- share 페이지에서 exam_question_tag 임베딩 시 concept_tag/concept_category 조회 필요
create policy "concept_tag_public_read" on concept_tag for select using (true);
create policy "concept_category_public_read" on concept_category for select using (true);
