import 'server-only'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { parseInput } from '@/lib/db/input'
import { SaveError } from '@/lib/db/errors'
import type { TeacherTransaction } from '@/lib/db/transaction'
import { executeStatements, updateRows } from '@/lib/db/statements'
import { lockWeek, assertWeekStudents, readingTotals } from './week-save'

export async function confirmGrades(context: TeacherTransaction, weekId: string, input: unknown) {
  const body = parseInput(z.array(z.object({ student_id: z.string().uuid(), exam_question_id: z.string().uuid(), is_correct: z.boolean() })), input)
  await lockWeek(context, weekId)
  await assertWeekStudents(context, weekId, body.map(row => row.student_id))
  const scores = (await context.tx.execute(sql`select id,student_id from public.week_score where week_id=${weekId}::uuid`)).rows
  const scoreMap = new Map(scores.map(row => [String(row.student_id), String(row.id)]))
  const touched = new Set<string>()
  for (const row of body) {
    const scoreId = scoreMap.get(row.student_id)
    if (!scoreId) continue
    const question = await context.tx.execute(sql`select id from public.exam_question where id=${row.exam_question_id}::uuid and week_id=${weekId}::uuid`)
    if (!question.rows.length) throw new SaveError('다른 주차의 문항입니다.', 403)
    await executeStatements(context.tx, [updateRows('student_answer', { is_correct: row.is_correct, teacher_confirmed: true, needs_review: false },
      sql`week_score_id=${scoreId}::uuid and exam_question_id=${row.exam_question_id}::uuid`, true)])
    touched.add(scoreId)
  }
  await executeStatements(context.tx, readingTotals([...touched]))
  const skipped = [...new Set(body.map(row => row.student_id))].filter(id => !scoreMap.has(id))
  return { ok: true, ...(skipped.length ? { skipped } : {}) }
}
