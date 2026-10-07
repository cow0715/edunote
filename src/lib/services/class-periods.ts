import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { periods } from '@/lib/db/schema'
import { lockClass, type TeacherTransaction } from '@/lib/db/transaction'
import { dateInput, nullableDate, parseInput, uuidInput } from '@/lib/db/input'
import { SaveError } from '@/lib/db/errors'

const fields = z.object({
  label: z.string().trim().min(1).max(200),
  semester: z.coerce.number().int().min(1).max(2),
  exam_type: z.enum(['midterm', 'final', 'other']),
  start_date: dateInput,
  end_date: nullableDate,
  sort_order: z.number().int().min(0).max(2147483646),
})
const createInput = fields.omit({ sort_order: true }).extend({
  exam_type: fields.shape.exam_type.default('other'),
  end_date: nullableDate.default(null),
  sort_order: fields.shape.sort_order.optional(),
  is_current: z.boolean().default(true),
})
const editInput = fields.partial().extend({ is_current: z.never().optional() })

export async function managePeriod(context: TeacherTransaction, classId: string, action: 'create' | 'edit' | 'set_default' | 'delete', periodId?: string, input?: unknown) {
  parseInput(uuidInput, classId)
  if (action !== 'create') parseInput(uuidInput, periodId)
  const { tx } = context
  await lockClass(context, classId)
  if (action === 'create') {
    const values = parseInput(createInput, input)
    if (values.end_date && values.end_date < values.start_date) throw new SaveError('종료일은 시작일 이후여야 합니다.')
    const existing = await tx.select().from(periods).where(eq(periods.class_id, classId))
    if (values.is_current) {
      if (existing.some(row => row.start_date >= values.start_date)) throw new SaveError('새 기간은 가장 최근 기간의 시작일 이후에 시작해 주세요')
      await tx.update(periods).set({ end_date: sql`${values.start_date}::date - 1` })
        .where(sql`${periods.class_id} = ${classId} and ${periods.start_date} < ${values.start_date}::date and (${periods.end_date} is null or ${periods.end_date} >= ${values.start_date}::date)`)
      await tx.update(periods).set({ is_current: false }).where(and(eq(periods.class_id, classId), eq(periods.is_current, true)))
    }
    const [created] = await tx.insert(periods).values({ ...values, class_id: classId,
      sort_order: values.sort_order ?? Math.max(0, ...existing.map(row => row.sort_order)) + 1 }).returning()
    return created
  }
  const condition = and(eq(periods.class_id, classId), eq(periods.id, periodId!))
  const [current] = await tx.select().from(periods).where(condition)
  if (!current) throw new SaveError('기간을 찾을 수 없습니다', 404)
  if (action === 'delete') {
    if (current.is_current) throw new SaveError('다른 기간을 공유 기본으로 지정한 뒤 삭제해 주세요', 409)
    const deleted = await tx.delete(periods).where(condition).returning({ id: periods.id })
    if (!deleted.length) throw new SaveError('기간 상태가 변경되었습니다. 새로고침해 주세요.', 409)
    return { ok: true }
  }
  if (action === 'set_default') {
    await tx.update(periods).set({ is_current: false }).where(and(eq(periods.class_id, classId), eq(periods.is_current, true)))
    const [updated] = await tx.update(periods).set({ is_current: true }).where(condition).returning()
    if (!updated) throw new SaveError('기간 상태가 변경되었습니다. 새로고침해 주세요.', 409)
    return updated
  }
  const patch = parseInput(editInput, input)
  const merged = { ...current, ...patch }
  if (merged.end_date && merged.end_date < merged.start_date) throw new SaveError('종료일은 시작일 이후여야 합니다.')
  if (!Object.keys(patch).length) return current
  const [updated] = await tx.update(periods).set(patch).where(condition).returning()
  if (!updated) throw new SaveError('기간 상태가 변경되었습니다. 새로고침해 주세요.', 409)
  return updated
}
