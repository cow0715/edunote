import 'server-only'
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { SaveError } from '@/lib/db/errors'
import { withTeacherTransaction, lockClass, type TeacherTransaction, type TransactionTiming } from '@/lib/db/transaction'
import { executeStatements, type Statement } from '@/lib/db/statements'

export async function lockWeek(context: TeacherTransaction, weekId: string, batchChildren = false, readingStudentIds?: string[]) {
  const { rows } = await context.tx.execute(sql`select class_id from public.week where id=${weekId}::uuid`)
  if (!rows[0]) throw new SaveError('접근 권한이 없거나 주차를 찾을 수 없습니다.', 403)
  const classId = String(rows[0].class_id)
  await lockClass(context, classId)
  const locked = await context.tx.execute(sql`select id from public.week where id=${weekId}::uuid and class_id=${classId}::uuid for update`)
  if (!locked.rows.length) throw new SaveError('주차가 변경됐습니다.', 409)
  if (readingStudentIds) {
    // Reading drafts never read/write vocabulary. Keep class/week/question locks,
    // and lock every score/answer they can change, in the existing lock order.
    const students = readingStudentIds.length ? sql`student_id in (${sql.join(readingStudentIds.map(id=>sql`${id}::uuid`),sql`, `)})` : sql`false`
    await context.tx.execute(sql`with
      questions as materialized (select id from public.exam_question where week_id=${weekId}::uuid order by id for update),
      scores as materialized (select id from public.week_score where week_id=${weekId}::uuid and ${students}
        and (select count(*) from questions)>=0 order by id for update),
      answers as materialized (select id from public.student_answer where week_score_id in
        (select id from public.week_score where week_id=${weekId}::uuid and ${students})
        and ((select count(*) from questions)+(select count(*) from scores))>=0 order by id for update)
      select (select count(*) from questions) as questions, (select count(*) from scores) as scores,
        (select count(*) from answers) as answers`)
    return classId
  }
  if (batchChildren) {
    // MATERIALIZED dependencies keep the legacy lock order, in one DB round trip.
    // Each lock depends on ALL preceding CTEs, so an empty intermediate table
    // cannot skip an earlier lock. Every CTE is consumed; lock scope is unchanged.
    await context.tx.execute(sql`with
      questions as materialized (select id from public.exam_question where week_id=${weekId}::uuid order by id for update),
      words as materialized (select id from public.vocab_word where week_id=${weekId}::uuid
        and (select count(*) from questions)>=0 order by id for update),
      variants as materialized (select id from public.vocab_word_variant where vocab_word_id in
        (select id from public.vocab_word where week_id=${weekId}::uuid)
        and ((select count(*) from questions) + (select count(*) from words))>=0 order by id for update),
      tests as materialized (select id from public.vocab_test where week_id=${weekId}::uuid
        and ((select count(*) from questions) + (select count(*) from words) + (select count(*) from variants))>=0 order by id for update),
      items as materialized (select id from public.vocab_test_item where vocab_test_id in
        (select id from public.vocab_test where week_id=${weekId}::uuid)
        and ((select count(*) from questions) + (select count(*) from words) + (select count(*) from variants) + (select count(*) from tests))>=0 order by id for update),
      scores as materialized (select id from public.week_score where week_id=${weekId}::uuid
        and ((select count(*) from questions) + (select count(*) from words) + (select count(*) from variants) + (select count(*) from tests) + (select count(*) from items))>=0 order by id for update),
      answers as materialized (select id from public.student_answer where week_score_id in
        (select id from public.week_score where week_id=${weekId}::uuid)
        and ((select count(*) from questions) + (select count(*) from words) + (select count(*) from variants) + (select count(*) from tests) + (select count(*) from items) + (select count(*) from scores))>=0 order by id for update),
      vocab_answers as materialized (select id from public.student_vocab_answer where week_score_id in
        (select id from public.week_score where week_id=${weekId}::uuid)
        and ((select count(*) from questions) + (select count(*) from words) + (select count(*) from variants) + (select count(*) from tests) + (select count(*) from items) + (select count(*) from scores) + (select count(*) from answers))>=0 order by id for update)
      select (select count(*) from questions) as questions, (select count(*) from words) as words,
        (select count(*) from variants) as variants, (select count(*) from tests) as tests,
        (select count(*) from items) as items, (select count(*) from scores) as scores,
        (select count(*) from answers) as answers, (select count(*) from vocab_answers) as vocab_answers`)
    return classId
  }
  // Also coordinate with older writers: existing children cannot be changed
  // between the version comparison and COMMIT, and FK inserts wait on parents.
  await context.tx.execute(sql`select id from public.exam_question where week_id=${weekId}::uuid order by id for update`)
  await context.tx.execute(sql`select id from public.vocab_word where week_id=${weekId}::uuid order by id for update`)
  await context.tx.execute(sql`select id from public.vocab_word_variant where vocab_word_id in (select id from public.vocab_word where week_id=${weekId}::uuid) order by id for update`)
  await context.tx.execute(sql`select id from public.vocab_test where week_id=${weekId}::uuid order by id for update`)
  await context.tx.execute(sql`select id from public.vocab_test_item where vocab_test_id in (select id from public.vocab_test where week_id=${weekId}::uuid) order by id for update`)
  await context.tx.execute(sql`select id from public.week_score where week_id=${weekId}::uuid order by id for update`)
  await context.tx.execute(sql`select id from public.student_answer where week_score_id in (select id from public.week_score where week_id=${weekId}::uuid) order by id for update`)
  await context.tx.execute(sql`select id from public.student_vocab_answer where week_score_id in (select id from public.week_score where week_id=${weekId}::uuid) order by id for update`)
  return classId
}

// An optimistic token covers both grading inputs and existing results. AI/OCR
// runs without a connection; a later edit causes 409 instead of stale overwrite.
export async function weekVersion({ tx }: TeacherTransaction, weekId: string, studentIds: string[] = []) {
  const scoreScope = studentIds.length ? sql`s.student_id in (${sql.join([...new Set(studentIds)].map(id => sql`${id}::uuid`),sql`, `)})` : sql`true`
  const result = await tx.execute(sql`select jsonb_build_object(
    'week', (select to_jsonb(w)-'reading_total'-'vocab_total' from public.week w where id=${weekId}::uuid),
    'questions', (select jsonb_agg(to_jsonb(q) order by id) from public.exam_question q where week_id=${weekId}::uuid),
    'words', (select jsonb_agg(to_jsonb(w) order by id) from public.vocab_word w where week_id=${weekId}::uuid),
    'variants', (select jsonb_agg(to_jsonb(v) order by v.id) from public.vocab_word_variant v join public.vocab_word w on w.id=v.vocab_word_id where w.week_id=${weekId}::uuid),
    'tests', (select jsonb_agg(to_jsonb(t) order by id) from public.vocab_test t where week_id=${weekId}::uuid),
    'items', (select jsonb_agg(to_jsonb(i) order by i.id) from public.vocab_test_item i join public.vocab_test t on t.id=i.vocab_test_id where t.week_id=${weekId}::uuid),
    'scores', (select jsonb_agg(to_jsonb(s) order by id) from public.week_score s where week_id=${weekId}::uuid and ${scoreScope}),
    'answers', (select jsonb_agg(to_jsonb(a) order by a.id) from public.student_answer a join public.week_score s on s.id=a.week_score_id where s.week_id=${weekId}::uuid and ${scoreScope}),
    'vocab_answers', (select jsonb_agg(to_jsonb(a) order by a.id) from public.student_vocab_answer a join public.week_score s on s.id=a.week_score_id where s.week_id=${weekId}::uuid and ${scoreScope})
  )::text as version`)
  return createHash('sha256').update(String(result.rows[0].version)).digest('hex')
}

export function captureWeekVersion(userId: string, weekId: string, studentIds: string[] = []) {
  return withTeacherTransaction(userId, async context => {
    await lockWeek(context, weekId)
    await assertWeekStudents(context, weekId, studentIds)
    return weekVersion(context, weekId, studentIds)
  })
}

export async function assertWeekStudents(context: TeacherTransaction, weekId: string, studentIds: string[]) {
  if (!studentIds.length) return
  const ids = [...new Set(studentIds)]
  const result = await context.tx.execute(sql`select s.id from public.student s
    join public.class_student cs on cs.student_id=s.id join public.week w on w.class_id=cs.class_id
    where w.id=${weekId}::uuid and s.teacher_id=${context.teacherId}::uuid
      and s.id in (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)}) for update of s`)
  if (new Set(result.rows.map(row => String(row.id))).size !== ids.length) throw new SaveError('해당 수업 학생이 아닙니다.', 403)
}

/** Code-only saves have no unlocked AI interval to snapshot and compare.
 * Keep the existing lock order/ownership checks, and plan from locked DB records.
 * Never pass a planner that makes external calls or returns before its writes finish.
 */
export function saveImmediateWeekPlan(userId: string, weekId: string, studentIds: string[],
  prepare: (context: TeacherTransaction) => Promise<Statement[]>, onTiming?: TransactionTiming) {
  return withTeacherTransaction(userId, context => applyImmediateWeekPlan(context, weekId, studentIds, prepare, onTiming), onTiming)
}

export async function applyImmediateWeekPlan(context: TeacherTransaction, weekId: string, studentIds: string[],
  prepare: (context: TeacherTransaction) => Promise<Statement[]>, onTiming?: TransactionTiming) {
  let stageAt = performance.now()
  const mark = (stage: string) => {
    const now = performance.now()
    // Diagnostics must not alter persistence or connection-release behavior.
    try { onTiming?.(stage, now - stageAt) } catch { /* ignore observer errors */ }
    stageAt = now
  }
  await lockWeek(context, weekId, true, studentIds)
  mark('db_locks')
  await assertWeekStudents(context, weekId, studentIds)
  mark('db_students')
  const statements = await prepare(context)
  mark('db_plan')
  await executeStatements(context.tx, statements)
  mark('db_writes')
}

export function saveWeekPlan(userId: string, weekId: string, version: string, statements: Statement[], studentIds: string[] = []) {
  return withTeacherTransaction(userId, context => applyWeekPlan(context, weekId, version, statements, studentIds))
}

export async function applyWeekPlan(context: TeacherTransaction, weekId: string, version: string, statements: Statement[], studentIds: string[] = []) {
  await lockWeek(context, weekId)
  if (await weekVersion(context, weekId, studentIds) !== version) throw new SaveError('문항 또는 채점 자료가 변경됐습니다. 새로고침 후 다시 시도해 주세요.', 409)
  await assertWeekStudents(context, weekId, studentIds)
  await executeStatements(context.tx, statements)
}

export function readingTotals(scoreIds: string[]): Statement[] {
  if (!scoreIds.length) return []
  return [{ query: sql`update public.week_score s set reading_correct=(
    select case when count(*)=0 then null else count(*) filter(where a.is_correct)::integer end
    from public.student_answer a join public.exam_question q on q.id=a.exam_question_id
    where a.week_score_id=s.id and q.week_id=s.week_id and q.exam_type='reading' and not coalesce(q.is_void,false))
    where s.id in (${sql.join(scoreIds.map(id => sql`${id}::uuid`), sql`, `)})` }]
}

export function vocabTotals(scoreIds: string[]): Statement[] {
  if (!scoreIds.length) return []
  return [{ query: sql`update public.week_score s set
    vocab_correct=(select count(*)::integer from public.student_vocab_answer a where a.week_score_id=s.id and a.is_correct),
    vocab_retake_correct=(select count(*)::integer from public.student_vocab_answer a where a.week_score_id=s.id and not a.is_correct and a.retake_is_correct)
    where s.id in (${sql.join(scoreIds.map(id => sql`${id}::uuid`), sql`, `)})` }]
}
