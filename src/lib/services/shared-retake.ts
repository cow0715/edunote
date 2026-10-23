import 'server-only'
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { SaveError } from '@/lib/db/errors'
import { withTeacherTransaction, type TeacherTransaction } from '@/lib/db/transaction'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveShareToken, SHARE_CLOSED_ERROR, SHARE_EXPIRED_ERROR, SHARE_NOT_FOUND_ERROR } from '@/lib/share-access'
import { lockWeek } from './week-save'

const idsInput = z.array(z.string().uuid()).min(1).max(500)
type RetakeSnapshot = { studentId: string; scoreId: string; answerIds: string[]; version: string }
export type SharedRetakeSnapshot = RetakeSnapshot & { ownerAuthId: string }
export type RetakeResult = { answer_id: string; retake_answer: string; is_correct: boolean }

/** Recheck the capability under the same locks used for teacher grading. */
export async function snapshotRetake(context: TeacherTransaction, token: string, weekId: string, studentId: string, answerIds: string[]): Promise<RetakeSnapshot> {
  const parsed = idsInput.safeParse(answerIds)
  if (!parsed.success || new Set(answerIds).size !== answerIds.length) throw new SaveError('답안을 확인해 주세요')
  const classId = await lockWeek(context, weekId)
  const { tx } = context
  const student = (await tx.execute(sql`select id, share_token::text=${token} as current_token,
    previous_share_token::text=${token} as previous_token,
    previous_share_token_expires_at>clock_timestamp() as graced
    from public.student where id=${studentId}::uuid for update`)).rows[0]
  if (!student) throw new SaveError(SHARE_NOT_FOUND_ERROR, 404)
  if (!student.current_token && !(student.previous_token && student.graced)) {
    throw new SaveError(student.previous_token ? SHARE_EXPIRED_ERROR : SHARE_NOT_FOUND_ERROR, student.previous_token ? 410 : 404)
  }
  const openClass = (await tx.execute(sql`select id from public.class where id=${classId}::uuid and archived_at is null`)).rows[0]
  const enrollment = (await tx.execute(sql`select id from public.class_student where class_id=${classId}::uuid
    and student_id=${studentId}::uuid and left_at is null for update`)).rows[0]
  if (!openClass || !enrollment) throw new SaveError(SHARE_CLOSED_ERROR, 403)
  const score = (await tx.execute(sql`select id from public.week_score where week_id=${weekId}::uuid and student_id=${studentId}::uuid`)).rows[0]
  if (!score) throw new SaveError('성적 데이터가 없습니다', 404)
  const answerFilter = sql`a.id in (${sql.join(answerIds.map(id => sql`${id}::uuid`), sql`, `)})`
  const answers = (await tx.execute(sql`select a.id from public.student_vocab_answer a join public.vocab_word w on w.id=a.vocab_word_id
    where a.week_score_id=${score.id}::uuid and not a.is_correct and w.week_id=${weekId}::uuid and ${answerFilter}`)).rows
  if (answers.length !== answerIds.length) throw new SaveError('재시험 대상이 아닌 답안입니다', 400)
  // Retake results are excluded: concurrent submissions serialize, then recompute
  // the aggregate from all committed answers. Teacher edits to inputs still conflict.
  const fingerprint = (await tx.execute(sql`select jsonb_build_object(
    'score',${score.id}::text,
    'answers',(select jsonb_agg(to_jsonb(a)-'retake_answer'-'retake_is_correct' order by a.id)
      from public.student_vocab_answer a where a.week_score_id=${score.id}::uuid and ${answerFilter}),
    'words',(select jsonb_agg(to_jsonb(w) order by w.id) from public.vocab_word w where w.week_id=${weekId}::uuid),
    'variants',(select jsonb_agg(to_jsonb(v) order by v.id) from public.vocab_word_variant v
      join public.vocab_word w on w.id=v.vocab_word_id where w.week_id=${weekId}::uuid),
    'tests',(select jsonb_agg(to_jsonb(t) order by t.id) from public.vocab_test t where t.week_id=${weekId}::uuid),
    'items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.vocab_test_item i
      join public.vocab_test t on t.id=i.vocab_test_id where t.week_id=${weekId}::uuid)
  )::text as value`)).rows[0].value
  return { studentId, scoreId: String(score.id), answerIds: [...answerIds].sort(), version: createHash('sha256').update(String(fingerprint)).digest('hex') }
}

/** Never accepts a teacher identity from HTTP. Resolve the owner from the verified
 * share capability on the server, then retain the existing restricted driver/RLS.
 * No owner identity or snapshot is returned to the browser. */
export async function captureSharedRetake(token: string, weekId: string, answerIds: string[]): Promise<SharedRetakeSnapshot> {
  const db = createServiceClient()
  const found = await resolveShareToken<{ id: string; teacher_id: string }>(db, token, 'id,teacher_id')
  if (found.status !== 'ok') throw new SaveError(found.status === 'expired' ? SHARE_EXPIRED_ERROR : SHARE_NOT_FOUND_ERROR, found.status === 'expired' ? 410 : 404)
  const { data: owner, error } = await db.from('teacher').select('auth_id').eq('id', found.student.teacher_id).eq('approval_status','approved').single()
  if (error || !owner?.auth_id) throw new SaveError(SHARE_CLOSED_ERROR, 403)
  return withTeacherTransaction(owner.auth_id, async context => ({
    ...await snapshotRetake(context, token, weekId, found.student.id, answerIds), ownerAuthId: owner.auth_id,
  }))
}

export async function applyRetake(context: TeacherTransaction, token: string, weekId: string, snapshot: RetakeSnapshot, results: RetakeResult[]) {
  if (results.length !== snapshot.answerIds.length || new Set(results.map(r => r.answer_id)).size !== results.length ||
    results.some(r => !snapshot.answerIds.includes(r.answer_id))) throw new SaveError('답안을 확인해 주세요')
  const current = await snapshotRetake(context, token, weekId, snapshot.studentId, snapshot.answerIds)
  if (current.version !== snapshot.version) throw new SaveError('시험 또는 답안이 변경됐습니다. 새로고침 후 다시 시도해 주세요.', 409)
  for (const result of results) {
    const saved = await context.tx.execute(sql`update public.student_vocab_answer set retake_answer=${result.retake_answer || null},
      retake_is_correct=${result.is_correct} where id=${result.answer_id}::uuid and week_score_id=${current.scoreId}::uuid and not is_correct returning id`)
    if (saved.rows.length !== 1) throw new SaveError('답안을 저장하지 못했습니다. 다시 시도해 주세요', 409)
  }
  const stats = (await context.tx.execute(sql`select count(*) filter(where retake_is_correct)::integer as total_mastered,
    count(*) filter(where retake_is_correct is distinct from true)::integer as remaining
    from public.student_vocab_answer where week_score_id=${current.scoreId}::uuid and not is_correct`)).rows[0]
  const saved = await context.tx.execute(sql`update public.week_score set vocab_retake_correct=${stats.total_mastered}
    where id=${current.scoreId}::uuid and student_id=${snapshot.studentId}::uuid and week_id=${weekId}::uuid returning id`)
  if (saved.rows.length !== 1) throw new SaveError('결과를 저장하지 못했습니다. 다시 시도해 주세요', 409)
  return { total_mastered: Number(stats.total_mastered), remaining: Number(stats.remaining) }
}

export function saveSharedRetake(token: string, weekId: string, snapshot: SharedRetakeSnapshot, results: RetakeResult[]) {
  return withTeacherTransaction(snapshot.ownerAuthId, context => applyRetake(context, token, weekId, snapshot, results))
}
