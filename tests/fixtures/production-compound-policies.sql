-- Public policy expressions read from production on 2026-10-19; no user data.
create policy "cs_auth" on public."class_student" as PERMISSIVE for ALL to public using ((class_id IN ( SELECT class.id
   FROM class
  WHERE (class.teacher_id = my_teacher_id())))) with check ((class_id IN ( SELECT class.id
   FROM class
  WHERE (class.teacher_id = my_teacher_id()))));
create policy "cs_public_read" on public."class_student" as PERMISSIVE for SELECT to public using (true) ;
create policy "clinic_enrollment_owner" on public."clinic_enrollment" as PERMISSIVE for ALL to public using (((teacher_id IN ( SELECT teacher.id
   FROM teacher
  WHERE (teacher.auth_id = auth.uid()))) AND (EXISTS ( SELECT 1
   FROM student s
  WHERE ((s.id = clinic_enrollment.student_id) AND (s.teacher_id = clinic_enrollment.teacher_id)))) AND (EXISTS ( SELECT 1
   FROM clinic_slot cs
  WHERE ((cs.id = clinic_enrollment.clinic_slot_id) AND (cs.teacher_id = clinic_enrollment.teacher_id)))))) with check (((teacher_id IN ( SELECT teacher.id
   FROM teacher
  WHERE (teacher.auth_id = auth.uid()))) AND (EXISTS ( SELECT 1
   FROM student s
  WHERE ((s.id = clinic_enrollment.student_id) AND (s.teacher_id = clinic_enrollment.teacher_id)))) AND (EXISTS ( SELECT 1
   FROM clinic_slot cs
  WHERE ((cs.id = clinic_enrollment.clinic_slot_id) AND (cs.teacher_id = clinic_enrollment.teacher_id))))));
create policy "clinic_slot_owner" on public."clinic_slot" as PERMISSIVE for ALL to public using ((teacher_id IN ( SELECT teacher.id
   FROM teacher
  WHERE (teacher.auth_id = auth.uid())))) with check ((teacher_id IN ( SELECT teacher.id
   FROM teacher
  WHERE (teacher.auth_id = auth.uid()))));
create policy "concept_tag_public_read" on public."concept_tag" as PERMISSIVE for SELECT to public using (true) ;
create policy "ct_all" on public."concept_tag" as PERMISSIVE for ALL to public using ((teacher_id = my_teacher_id())) with check ((teacher_id = my_teacher_id()));
create policy "eq_auth" on public."exam_question" as PERMISSIVE for ALL to public using ((week_id IN ( SELECT week.id
   FROM week
  WHERE (week.class_id IN ( SELECT class.id
           FROM class
          WHERE (class.teacher_id = my_teacher_id())))))) with check ((week_id IN ( SELECT week.id
   FROM week
  WHERE (week.class_id IN ( SELECT class.id
           FROM class
          WHERE (class.teacher_id = my_teacher_id()))))));
create policy "eq_public_read" on public."exam_question" as PERMISSIVE for SELECT to public using (true) ;
create policy "eqt_auth" on public."exam_question_tag" as PERMISSIVE for ALL to public using (true) with check (true);
create policy "mock_exam_owner" on public."mock_exam" as PERMISSIVE for ALL to public using ((teacher_id IN ( SELECT teacher.id
   FROM teacher
  WHERE (teacher.auth_id = auth.uid())))) with check ((teacher_id IN ( SELECT teacher.id
   FROM teacher
  WHERE (teacher.auth_id = auth.uid()))));
create policy "mock_exam_question_owner" on public."mock_exam_question" as PERMISSIVE for ALL to public using ((mock_exam_id IN ( SELECT mock_exam.id
   FROM mock_exam
  WHERE (mock_exam.teacher_id IN ( SELECT teacher.id
           FROM teacher
          WHERE (teacher.auth_id = auth.uid())))))) with check ((mock_exam_id IN ( SELECT mock_exam.id
   FROM mock_exam
  WHERE (mock_exam.teacher_id IN ( SELECT teacher.id
           FROM teacher
          WHERE (teacher.auth_id = auth.uid()))))));
create policy "mock_exam_report_owner" on public."mock_exam_report" as PERMISSIVE for ALL to public using ((mock_exam_result_id IN ( SELECT r.id
   FROM (mock_exam_result r
     JOIN mock_exam e ON ((e.id = r.mock_exam_id)))
  WHERE (e.teacher_id IN ( SELECT teacher.id
           FROM teacher
          WHERE (teacher.auth_id = auth.uid())))))) with check ((mock_exam_result_id IN ( SELECT r.id
   FROM (mock_exam_result r
     JOIN mock_exam e ON ((e.id = r.mock_exam_id)))
  WHERE (e.teacher_id IN ( SELECT teacher.id
           FROM teacher
          WHERE (teacher.auth_id = auth.uid()))))));
create policy "mock_exam_result_owner" on public."mock_exam_result" as PERMISSIVE for ALL to public using (((mock_exam_id IN ( SELECT mock_exam.id
   FROM mock_exam
  WHERE (mock_exam.teacher_id IN ( SELECT teacher.id
           FROM teacher
          WHERE (teacher.auth_id = auth.uid()))))) AND (student_id IN ( SELECT student.id
   FROM student
  WHERE (student.teacher_id IN ( SELECT teacher.id
           FROM teacher
          WHERE (teacher.auth_id = auth.uid()))))))) with check (((mock_exam_id IN ( SELECT mock_exam.id
   FROM mock_exam
  WHERE (mock_exam.teacher_id IN ( SELECT teacher.id
           FROM teacher
          WHERE (teacher.auth_id = auth.uid()))))) AND (student_id IN ( SELECT student.id
   FROM student
  WHERE (student.teacher_id IN ( SELECT teacher.id
           FROM teacher
          WHERE (teacher.auth_id = auth.uid())))))));
create policy "mock_exam_student_answer_owner" on public."mock_exam_student_answer" as PERMISSIVE for ALL to public using ((mock_exam_result_id IN ( SELECT r.id
   FROM (mock_exam_result r
     JOIN mock_exam e ON ((e.id = r.mock_exam_id)))
  WHERE (e.teacher_id IN ( SELECT teacher.id
           FROM teacher
          WHERE (teacher.auth_id = auth.uid())))))) with check ((mock_exam_result_id IN ( SELECT r.id
   FROM (mock_exam_result r
     JOIN mock_exam e ON ((e.id = r.mock_exam_id)))
  WHERE (e.teacher_id IN ( SELECT teacher.id
           FROM teacher
          WHERE (teacher.auth_id = auth.uid()))))));
create policy "student_all" on public."student" as PERMISSIVE for ALL to public using ((teacher_id = my_teacher_id())) with check ((teacher_id = my_teacher_id()));
create policy "student_public_read" on public."student" as PERMISSIVE for SELECT to public using (true) ;
create policy "sa_auth" on public."student_answer" as PERMISSIVE for ALL to public using (true) with check (true);
create policy "sa_public_read" on public."student_answer" as PERMISSIVE for SELECT to public using (true) ;
create policy "sva_auth" on public."student_vocab_answer" as PERMISSIVE for ALL to public using (true) with check (true);
create policy "sva_public_read" on public."student_vocab_answer" as PERMISSIVE for SELECT to public using (true) ;
create policy "vocab_test_owner" on public."vocab_test" as PERMISSIVE for ALL to public using (is_vocab_week_owner(week_id)) with check (is_vocab_week_owner(week_id));
create policy "teachers can delete own vocab test items" on public."vocab_test_item" as PERMISSIVE for DELETE to public using ((EXISTS ( SELECT 1
   FROM (((vocab_test vt
     JOIN week w ON ((w.id = vt.week_id)))
     JOIN class c ON ((c.id = w.class_id)))
     JOIN teacher t ON ((t.id = c.teacher_id)))
  WHERE ((vt.id = vocab_test_item.vocab_test_id) AND (t.auth_id = auth.uid()))))) ;
create policy "teachers can insert own vocab test items" on public."vocab_test_item" as PERMISSIVE for INSERT to public  with check ((EXISTS ( SELECT 1
   FROM (((vocab_test vt
     JOIN week w ON ((w.id = vt.week_id)))
     JOIN class c ON ((c.id = w.class_id)))
     JOIN teacher t ON ((t.id = c.teacher_id)))
  WHERE ((vt.id = vocab_test_item.vocab_test_id) AND (t.auth_id = auth.uid())))));
create policy "teachers can read own vocab test items" on public."vocab_test_item" as PERMISSIVE for SELECT to public using ((EXISTS ( SELECT 1
   FROM (((vocab_test vt
     JOIN week w ON ((w.id = vt.week_id)))
     JOIN class c ON ((c.id = w.class_id)))
     JOIN teacher t ON ((t.id = c.teacher_id)))
  WHERE ((vt.id = vocab_test_item.vocab_test_id) AND (t.auth_id = auth.uid()))))) ;
create policy "teachers can update own vocab test items" on public."vocab_test_item" as PERMISSIVE for UPDATE to public using ((EXISTS ( SELECT 1
   FROM (((vocab_test vt
     JOIN week w ON ((w.id = vt.week_id)))
     JOIN class c ON ((c.id = w.class_id)))
     JOIN teacher t ON ((t.id = c.teacher_id)))
  WHERE ((vt.id = vocab_test_item.vocab_test_id) AND (t.auth_id = auth.uid()))))) with check ((EXISTS ( SELECT 1
   FROM (((vocab_test vt
     JOIN week w ON ((w.id = vt.week_id)))
     JOIN class c ON ((c.id = w.class_id)))
     JOIN teacher t ON ((t.id = c.teacher_id)))
  WHERE ((vt.id = vocab_test_item.vocab_test_id) AND (t.auth_id = auth.uid())))));
create policy "vocab_test_item_owner" on public."vocab_test_item" as PERMISSIVE for ALL to public using ((EXISTS ( SELECT 1
   FROM vocab_test vt
  WHERE ((vt.id = vocab_test_item.vocab_test_id) AND is_vocab_week_owner(vt.week_id))))) with check ((EXISTS ( SELECT 1
   FROM vocab_test vt
  WHERE ((vt.id = vocab_test_item.vocab_test_id) AND is_vocab_week_owner(vt.week_id)))));
create policy "vw_auth" on public."vocab_word" as PERMISSIVE for ALL to public using (true) with check (true);
create policy "vw_public_read" on public."vocab_word" as PERMISSIVE for SELECT to public using (true) ;
create policy "vocab_word_variant_owner" on public."vocab_word_variant" as PERMISSIVE for ALL to public using ((vocab_word_id IN ( SELECT vw.id
   FROM ((vocab_word vw
     JOIN week w ON ((w.id = vw.week_id)))
     JOIN class c ON ((c.id = w.class_id)))
  WHERE (c.teacher_id IN ( SELECT teacher.id
           FROM teacher
          WHERE (teacher.auth_id = auth.uid())))))) with check ((vocab_word_id IN ( SELECT vw.id
   FROM ((vocab_word vw
     JOIN week w ON ((w.id = vw.week_id)))
     JOIN class c ON ((c.id = w.class_id)))
  WHERE (c.teacher_id IN ( SELECT teacher.id
           FROM teacher
          WHERE (teacher.auth_id = auth.uid()))))));
create policy "ws_auth" on public."week_score" as PERMISSIVE for ALL to public using ((week_id IN ( SELECT week.id
   FROM week
  WHERE (week.class_id IN ( SELECT class.id
           FROM class
          WHERE (class.teacher_id = my_teacher_id())))))) with check ((week_id IN ( SELECT week.id
   FROM week
  WHERE (week.class_id IN ( SELECT class.id
           FROM class
          WHERE (class.teacher_id = my_teacher_id()))))));
create policy "ws_public_read" on public."week_score" as PERMISSIVE for SELECT to public using (true) ;
