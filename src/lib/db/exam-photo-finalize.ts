import type { QueryResultRow } from 'pg'
import type { PreparedReadingRow, SavedGradeVersion } from '@/lib/atomic-grade'
import { SaveError } from './errors'

export interface ExamPhotoTransaction {
  query<T extends QueryResultRow>(statement: string, parameters: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>
}

export async function finalizeExamPhotoBatch(
  tx: ExamPhotoTransaction, teacherId: string, weekId: string, jobId: string, rows: PreparedReadingRow[],
) {
  const studentIds = rows.map((row) => row.student_id)
  if (!studentIds.length || new Set(studentIds).size !== studentIds.length) {
    throw new SaveError('확정할 학생을 확인해 주세요.', 422)
  }
  const { rows: [week] } = await tx.query<{ class_id: string }>(
    `select w.class_id from public.week w join public.class c on c.id = w.class_id
     join public.teacher t on t.id = c.teacher_id
     where w.id = $1 and t.id = $2
       and t.auth_id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
       and t.approval_status = 'approved'
     for update of w`, [weekId, teacherId],
  )
  const { rows: [job] } = await tx.query<{ closed_at: Date | null }>(
    'select closed_at from public.exam_photo_job where id = $1 and week_id = $2 and teacher_id = $3 for update',
    [jobId, weekId, teacherId],
  )
  if (!week || !job) throw new SaveError('채점 작업에 접근할 수 없습니다.', 403)

  const { rows: items } = await tx.query<{
    student_id: string; photo_path: string | null; has_draft: boolean; finalized_grade_version: SavedGradeVersion | null
  }>(
    `select student_id, photo_path, grade_draft is not null as has_draft, finalized_grade_version
     from public.exam_photo_job_item where job_id = $1 and student_id = any($2::uuid[])
     order by student_id for update`, [jobId, studentIds],
  )
  const itemsByStudent = new Map(items.map((item) => [item.student_id, item]))
  for (const row of rows) {
    const item = itemsByStudent.get(row.student_id)
    if (!row.present || !row.reading_present || !item?.has_draft || !item.photo_path ||
        item.photo_path !== row.exam_photo_path || item.photo_path !== `${weekId}/${row.student_id}/${jobId}`) {
      throw new SaveError('채점 작업의 답안과 사진을 확인해 주세요.', 422)
    }
  }
  const receipts = items.flatMap((item) => item.finalized_grade_version ? [item.finalized_grade_version] : [])
  if (receipts.length === rows.length) return { versions: receipts, replayed: true }
  if (job.closed_at || receipts.length) {
    throw new SaveError('이미 확정된 답안이 포함되어 있습니다. 작업을 다시 열어 주세요.', 409)
  }

  const { rows: enrolled } = await tx.query(
    'select student_id from public.class_student where class_id = $1 and student_id = any($2::uuid[])',
    [week.class_id, studentIds],
  )
  if (enrolled.length !== rows.length) throw new SaveError('수업에 속하지 않은 학생입니다.', 422)
  const { rows: current } = await tx.query<{
    id: string; student_id: string; grade_revision: string; photo_only: boolean
  }>(
    `select s.id, s.student_id, s.grade_revision::text,
       (s.grade_revision = 0 and s.exam_photo_path is not null and s.vocab_correct is null
        and s.reading_correct is null and s.homework_done is null and s.memo is null
        and not exists (select 1 from public.student_answer a where a.week_score_id = s.id)
        and not exists (select 1 from public.student_vocab_answer a where a.week_score_id = s.id)) as photo_only
     from public.week_score s where s.week_id = $1 and s.student_id = any($2::uuid[])
     order by s.student_id for update of s`, [weekId, studentIds],
  )
  const scores = new Map(current.map((score) => [score.student_id, score]))
  const questionIds = new Set<string>()
  for (const row of rows) {
    const score = scores.get(row.student_id)
    const matches = row.expected_revision === null
      ? !score || score.photo_only
      : score?.id === row.score_id && score.grade_revision === String(row.expected_revision)
    if (!matches) throw new SaveError('채점 중 답안이 변경됐습니다. 새로고침 후 다시 시도해주세요.', 409)
    const answers = new Set(row.answers.map((answer) => answer.exam_question_id))
    if (answers.size !== row.answers.length) throw new SaveError('문항이 중복되었습니다.', 422)
    for (const id of answers) questionIds.add(id)
  }
  const { rows: questions } = await tx.query(
    `select id from public.exam_question where week_id = $1 and exam_type = 'reading'
       and not coalesce(is_void, false) and id = any($2::uuid[])`, [weekId, [...questionIds]],
  )
  if (questions.length !== questionIds.size) throw new SaveError('시험 문항이 변경됐습니다. 새로고침해주세요.', 409)

  const scoreRows = rows.map((row) => ({
    id: scores.get(row.student_id)?.id ?? row.score_id,
    student_id: row.student_id, vocab_correct: row.vocab_correct,
    homework_done: row.homework_done, memo: row.memo || null, exam_photo_path: row.exam_photo_path,
    existing: scores.has(row.student_id),
  }))
  await tx.query(
    `with incoming as (
       select * from jsonb_to_recordset($2::jsonb) as r(id uuid, student_id uuid, vocab_correct integer,
         homework_done numeric, memo text, exam_photo_path text, existing boolean)
     ), updated as (
       update public.week_score s set vocab_correct = r.vocab_correct, homework_done = r.homework_done,
         memo = r.memo, exam_photo_path = r.exam_photo_path
       from incoming r where r.existing and s.id = r.id and s.week_id = $1
     )
     insert into public.week_score (id, week_id, student_id, vocab_correct, homework_done, memo, exam_photo_path)
     select id, $1, student_id, vocab_correct, homework_done, memo, exam_photo_path from incoming where not existing`,
    [weekId, JSON.stringify(scoreRows)],
  )
  const answers = rows.flatMap((row, index) => row.answers.map((answer) => ({
    ...answer, week_score_id: scoreRows[index].id, is_correct: answer.is_correct ?? false,
  })))
  await tx.query(
    `insert into public.student_answer (week_score_id, exam_question_id, student_answer, student_answer_text,
         ox_selection, is_correct, needs_review, teacher_confirmed, ai_feedback)
     select week_score_id, exam_question_id, student_answer, student_answer_text, ox_selection, is_correct,
       needs_review, teacher_confirmed, ai_feedback from jsonb_populate_recordset(null::public.student_answer, $1::jsonb)
     on conflict (week_score_id, exam_question_id) do update set
       student_answer = excluded.student_answer, student_answer_text = excluded.student_answer_text,
       ox_selection = excluded.ox_selection, is_correct = excluded.is_correct, needs_review = excluded.needs_review,
       teacher_confirmed = excluded.teacher_confirmed, ai_feedback = excluded.ai_feedback`,
    [JSON.stringify(answers)],
  )
  const { rows: savedScores } = await tx.query<{ student_id: string; score_id: string; revision: string }>(
    `update public.week_score s set reading_correct = (
       select case when count(*) = 0 then null else count(*) filter (where a.is_correct)::integer end
       from public.student_answer a join public.exam_question q on q.id = a.exam_question_id
       where a.week_score_id = s.id and q.week_id = s.week_id and q.exam_type = 'reading' and not coalesce(q.is_void, false)
     ) where s.week_id = $1 and s.student_id = any($2::uuid[])
     returning s.student_id, s.id as score_id, s.grade_revision::text as revision`, [weekId, studentIds],
  )
  if (savedScores.length !== rows.length) throw new SaveError('성적 저장 결과를 확인하지 못했습니다.', 503)
  const versions: SavedGradeVersion[] = savedScores.map((score) => ({ ...score, revision: Number(score.revision) }))
  await tx.query(
    `update public.week set reading_total = (
       select count(*) from public.exam_question where week_id = $1 and exam_type = 'reading' and not coalesce(is_void, false)
     ) where id = $1 and reading_total = 0`, [weekId],
  )
  const { rowCount } = await tx.query(
    `update public.exam_photo_job_item i set finalized_grade_version = receipt
     from jsonb_array_elements($2::jsonb) receipt where i.job_id = $1 and i.student_id = (receipt->>'student_id')::uuid`,
    [jobId, JSON.stringify(versions)],
  )
  if (rowCount !== rows.length) throw new SaveError('성적 확정 결과를 기록하지 못했습니다.', 503)
  await tx.query(
    `update public.exam_photo_job j set closed_at = now() where j.id = $1 and not exists (
       select 1 from public.exam_photo_job_item i where i.job_id = j.id and i.finalized_grade_version is null
     )`, [jobId],
  )
  return { versions, replayed: false }
}
