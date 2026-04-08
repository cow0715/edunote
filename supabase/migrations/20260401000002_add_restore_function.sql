-- 복원 시 역순 FK로 전체 삭제하는 DB 함수
-- SECURITY DEFINER: RLS 우회, service role과 동일한 권한으로 실행
CREATE OR REPLACE FUNCTION restore_truncate_tables()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- 자식 테이블부터 역순으로 삭제 (FK 제약 위반 방지)
  DELETE FROM teacher_memos;
  DELETE FROM attendance;
  DELETE FROM student_answer;
  DELETE FROM week_score;
  DELETE FROM exam_question_tag;
  DELETE FROM exam_question;
  DELETE FROM week;
  DELETE FROM class_student;
  DELETE FROM student;
  DELETE FROM class;
  DELETE FROM concept_tag;
  DELETE FROM concept_category;
  DELETE FROM teacher;
END;
$$;
