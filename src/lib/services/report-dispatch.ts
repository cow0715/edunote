import 'server-only'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { SaveError } from '@/lib/db/errors'
import { parseInput } from '@/lib/db/input'
import { lockClass, type TeacherTransaction } from '@/lib/db/transaction'
import { getMonthlyPeriod } from '@/lib/report-card'
import { lockStudent } from './students'
import { mockInputs } from './mock-results'
import { publishMockReports } from './mock-reports'

type MonthlyCard = {
  id: string; student_id: string; class_id: string; status: 'published'; period_label: string; share_token: string
}
type MockReport = { id: string; mock_exam_result_id: string; share_token: string; status: 'published' }
const ids = z.array(z.string().uuid()).min(1).max(500)

/** One transaction for every selected student/class. SMS must run only after commit. */
export async function publishMonthlyBatch(context: TeacherTransaction, year: number, month: number, input: unknown) {
  const parsed = parseInput(z.object({
    year: z.number().int().min(2000).max(9999), month: z.number().int().min(1).max(12),
    pairs: z.array(z.object({ student_id: z.string().uuid(), class_id: z.string().uuid() })).min(1).max(500),
  }), { year, month, pairs: input })
  const pairs = [...new Map(parsed.pairs.map(pair => [`${pair.student_id}:${pair.class_id}`, pair])).values()]
    .sort((a, b) => `${a.class_id}:${a.student_id}`.localeCompare(`${b.class_id}:${b.student_id}`))
  // Lock parents even when no report exists, so concurrent batch publications cannot create duplicate drafts.
  for (const id of [...new Set(pairs.map(pair => pair.class_id))].sort()) await lockClass(context, id)
  for (const id of [...new Set(pairs.map(pair => pair.student_id))].sort()) await lockStudent(context, id)
  const period = getMonthlyPeriod(parsed.year, parsed.month)
  const cards: MonthlyCard[] = []
  let created_count = 0
  for (const pair of pairs) {
    // Keep legacy standalone drafts; use the most recently created card deterministically if duplicates exist.
    let card = (await context.tx.execute(sql`select id from public.report_card
      where teacher_id=${context.teacherId}::uuid and student_id=${pair.student_id}::uuid
        and class_id=${pair.class_id}::uuid and period_type='monthly'
        and period_start=${period.start}::date and period_end=${period.end}::date
      order by created_at desc, id desc limit 1 for update`)).rows[0]
    if (!card) {
      card = (await context.tx.execute(sql`insert into public.report_card
        (teacher_id,student_id,class_id,period_type,period_start,period_end,period_label,highlighted_wrong_ids,status)
        values (${context.teacherId}::uuid,${pair.student_id}::uuid,${pair.class_id}::uuid,'monthly',
          ${period.start}::date,${period.end}::date,${period.label},'[]'::jsonb,'draft') returning id`)).rows[0]
      created_count++
    }
    const published = (await context.tx.execute(sql`update public.report_card
      set status='published',published_at=now(),revoked_at=null
      where id=${card.id}::uuid and teacher_id=${context.teacherId}::uuid
      returning id,student_id,class_id,status,period_label,share_token`)).rows[0]
    if (!published) throw new SaveError('성적표가 변경됐습니다. 다시 시도해 주세요.', 409)
    cards.push(published as MonthlyCard)
  }
  return { cards, created_count }
}

/** Reuse published snapshots and links, but atomically create/revive all other selected reports. */
export async function publishMockBatch(context: TeacherTransaction, examId: string, input: unknown) {
  parseInput(z.string().uuid(), examId)
  const resultIds = [...new Set(parseInput(ids, input))].sort()
  await mockInputs(context, examId)
  const reports: MockReport[] = []
  const missing: string[] = []
  for (const id of resultIds) {
    const result = (await context.tx.execute(sql`select id from public.mock_exam_result
      where id=${id}::uuid and mock_exam_id=${examId}::uuid for update`)).rows[0]
    if (!result) throw new SaveError('성적 결과를 찾을 수 없습니다.', 404)
    const existing = (await context.tx.execute(sql`select id,mock_exam_result_id,share_token,status
      from public.mock_exam_report where mock_exam_result_id=${id}::uuid and status='published' for update`)).rows[0]
    if (existing) reports.push(existing as MockReport)
    else missing.push(id)
  }
  const created = missing.length ? await publishMockReports(context, examId, missing) : []
  reports.push(...created as MockReport[])
  return { reports, created_count: missing.length }
}
