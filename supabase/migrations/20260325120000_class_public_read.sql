-- class 테이블 공개 읽기 정책 추가
-- 다른 테이블(student, week, week_score 등)과 동일하게 맞춤
create policy "class_public_read" on class for select using (true);
