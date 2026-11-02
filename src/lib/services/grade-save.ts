import 'server-only'
import { sql } from 'drizzle-orm'
import { withTeacherTransaction, type TeacherTransaction } from '@/lib/db/transaction'
import { executeStatements, type Statement } from '@/lib/db/statements'
import { SaveError } from '@/lib/db/errors'
import { lockWeek, weekVersion, assertWeekStudents } from './week-save'
import type { GradeVersion, GradeSaveResult } from '@/lib/atomic-grade'

export function requireGradeToken(value: unknown): string {
  const version = value as GradeVersion | undefined
  if (!version || version.score_id !== null || typeof version.revision !== 'string' || !/^[a-f0-9]{64}$/.test(version.revision)) {
    throw new SaveError('저장 버전이 없습니다. 새로고침 후 다시 시도해주세요.', 409)
  }
  return version.revision
}

/** Reuse production's lock/ownership/transaction model; no schema or RPC migration. */
export async function captureGradeVersions(userId: string, weekId: string, studentIds: string[], expectedSnapshot?: string) {
  return withTeacherTransaction(userId, async context => {
    await lockWeek(context, weekId)
    if (expectedSnapshot && await weekVersion(context, weekId) !== expectedSnapshot) throw new SaveError('조회 중 답안이 변경됐습니다. 다시 조회해주세요.',409)
    await assertWeekStudents(context, weekId, studentIds)
    const versions = []
    for (const student_id of studentIds) versions.push({student_id, score_id:null, revision:await weekVersion(context,weekId,[student_id])})
    return versions
  })
}

export async function saveGradePlan(userId: string, weekId: string, token: string | Record<string,string>, statements: Statement[], studentIds: string[]): Promise<GradeSaveResult> {
  return withTeacherTransaction(userId, context => applyGradePlan(context, weekId, token, statements, studentIds))
}

export async function applyGradePlan(context: TeacherTransaction, weekId: string, token: string | Record<string,string>, statements: Statement[], studentIds: string[]): Promise<GradeSaveResult> {
    await lockWeek(context, weekId)
    for (const id of studentIds) {
      if (await weekVersion(context, weekId, [id]) !== (typeof token === 'string' ? token : token[id])) throw new SaveError('답안이 변경됐습니다. 입력은 유지됩니다. 새로고침 후 다시 시도해주세요.', 409)
    }
    await assertWeekStudents(context, weekId, studentIds)
    await executeStatements(context.tx, statements)
    const versions = []
    for (const student_id of studentIds) versions.push({student_id,score_id:null,revision:await weekVersion(context,weekId,[student_id])})
    return { ok: true, versions }
}

/** Only the active test participates; historical residual answers cannot inflate totals. */
export function activeVocabTotals(scoreIds: string[]): Statement[] {
  if (!scoreIds.length) return []
  return [{ query: sql`update public.week_score s set
    vocab_correct=(select count(*)::integer from public.student_vocab_answer a
      where a.week_score_id=s.id and a.is_correct and (not exists(select 1 from public.vocab_test t where t.week_id=s.week_id and t.is_active)
      or exists(select 1 from public.vocab_test_item i where i.vocab_word_id=a.vocab_word_id and i.vocab_test_id=(select t.id from public.vocab_test t where t.week_id=s.week_id and t.is_active order by t.created_at desc,t.id desc limit 1)))),
    vocab_retake_correct=(select count(*)::integer from public.student_vocab_answer a
      where a.week_score_id=s.id and not a.is_correct and a.retake_is_correct and (not exists(select 1 from public.vocab_test t where t.week_id=s.week_id and t.is_active)
      or exists(select 1 from public.vocab_test_item i where i.vocab_word_id=a.vocab_word_id and i.vocab_test_id=(select t.id from public.vocab_test t where t.week_id=s.week_id and t.is_active order by t.created_at desc,t.id desc limit 1))))
    where s.id in (${sql.join(scoreIds.map(id => sql`${id}::uuid`), sql`, `)})` }]
}
