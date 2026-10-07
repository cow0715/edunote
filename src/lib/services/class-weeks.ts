import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { classes, weeks } from '@/lib/db/schema'
import { lockClass, type DbTransaction, type TeacherTransaction } from '@/lib/db/transaction'
import { nullableDate, parseInput, uuidInput } from '@/lib/db/input'
import { SaveError } from '@/lib/db/errors'

const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
export function sessionDates(start: string, end: string, days: string[]) {
  const cursor = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(last.getTime()) || cursor > last) throw new SaveError('수업 기간을 확인해 주세요.')
  if ((last.getTime() - cursor.getTime()) / 86400000 > 366 * 5) throw new SaveError('수업 기간은 5년 이내로 설정해 주세요.')
  const dates: string[] = []
  while (cursor <= last) {
    if (days.includes(dayNames[cursor.getUTCDay()])) dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

// Called only after locking the parent class. Null dates remain at the end.
export async function reorderWeeks(tx: DbTransaction, classId: string) {
  const rows = await tx.select({ id: weeks.id, number: weeks.week_number }).from(weeks)
    .where(eq(weeks.class_id, classId))
    .orderBy(sql`${weeks.start_date} asc nulls last`, weeks.week_number, weeks.id)
  const changes = rows.map((row, i) => ({ ...row, target: i + 1 })).filter(row => row.number !== row.target)
  if (!changes.length) return 0
  // Allocate values absent from ALL rows, including legacy negative numbers.
  const occupied = new Set(rows.map(row => row.number))
  let candidate = -1
  const updates = changes.map(row => {
    while (occupied.has(candidate)) candidate--
    return { ...row, temporary: candidate-- }
  })
  // Two batched UPDATEs avoid one network round trip per week.
  for (const key of ['temporary', 'target'] as const) {
    const values = sql.join(updates.map(row => sql`(${row.id}::uuid, ${row[key]}::integer)`), sql`, `)
    const result = await tx.execute(sql`update public.week as w set week_number = v.n from (values ${values}) as v(id,n) where w.id = v.id and w.class_id = ${classId}::uuid returning w.id`)
    if (result.rows.length !== changes.length) throw new SaveError('수업 상태가 변경되었습니다. 새로고침해 주세요.', 409)
  }
  return changes.length
}

export async function changeClassWeeks(context: TeacherTransaction, classId: string, action: 'add' | 'sync' | 'extend' | 'reorder', input: unknown = {}) {
  parseInput(uuidInput, classId)
  const cls = await lockClass(context, classId)
  const { tx } = context
  if (action === 'reorder') return { updated: await reorderWeeks(tx, classId) }
  const existing = await tx.select().from(weeks).where(eq(weeks.class_id, classId))
  const nextNumber = Math.max(0, ...existing.map(row => row.week_number)) + 1
  if (action === 'add') {
    const values = parseInput(z.object({ start_date: nullableDate.optional() }), input)
    const [created] = await tx.insert(weeks).values({ class_id: classId, week_number: nextNumber, start_date: values.start_date ?? null }).returning()
    await reorderWeeks(tx, classId)
    const [result] = await tx.select().from(weeks).where(eq(weeks.id, created.id))
    if (!result) throw new SaveError('수업 상태가 변경되었습니다. 새로고침해 주세요.', 409)
    return result
  }
  const days = cls.schedule_days ?? []
  if (!days.some(day => dayNames.includes(day))) throw new SaveError('수업 요일을 설정해 주세요.')
  let dates: string[]
  if (action === 'sync') {
    const occupied = new Set(existing.map(row => row.start_date))
    dates = sessionDates(cls.start_date, cls.end_date, days).filter(date => !occupied.has(date))
  } else {
    const { count } = parseInput(z.object({ count: z.number().int().min(1).max(52) }), input)
    const maxDate = existing.reduce((max, row) => row.start_date && row.start_date > max ? row.start_date : max, '')
    const cursor = new Date(`${maxDate || cls.end_date || cls.start_date}T00:00:00Z`)
    dates = []
    for (let i = 0; i < 732 && dates.length < count; i++) {
      cursor.setUTCDate(cursor.getUTCDate() + 1)
      if (days.includes(dayNames[cursor.getUTCDay()])) dates.push(cursor.toISOString().slice(0, 10))
    }
    if (dates.length !== count) throw new SaveError('추가할 수업일을 계산하지 못했습니다.')
  }
  if (dates.length) await tx.insert(weeks).values(dates.map((date, i) => ({ class_id: classId, week_number: nextNumber + i, start_date: date })))
  await reorderWeeks(tx, classId)
  if (action === 'extend') {
    const endDate = dates[dates.length - 1] > cls.end_date ? dates[dates.length - 1] : cls.end_date
    const changed = await tx.update(classes).set({ end_date: endDate }).where(eq(classes.id, classId)).returning({ id: classes.id })
    if (!changed.length) throw new SaveError('반 상태가 변경되었습니다. 새로고침해 주세요.', 409)
    return { ok: true, added: dates.length, new_end_date: endDate }
  }
  return { ok: true, total: existing.length + dates.length, added: dates.length }
}

export async function updateWeek(context: TeacherTransaction, weekId: string, input: unknown) {
  parseInput(uuidInput, weekId)
  const total = z.number().int().min(0).max(2147483647)
  const patch = parseInput(z.object({ start_date: nullableDate.optional(), vocab_total: total.optional(), reading_total: total.optional(), homework_total: total.optional() }), input)
  const { tx } = context
  // This read only locates the parent. Authorization and locking precede writes.
  const [location] = await tx.select({ classId: weeks.class_id }).from(weeks).where(eq(weeks.id, weekId))
  if (!location) throw new SaveError('주차를 찾을 수 없습니다.', 404)
  await lockClass(context, location.classId)
  const condition = and(eq(weeks.id, weekId), eq(weeks.class_id, location.classId))
  if (Object.keys(patch).length) await tx.update(weeks).set(patch).where(condition)
  if (patch.start_date !== undefined) await reorderWeeks(tx, location.classId)
  const [updated] = await tx.select().from(weeks).where(condition)
  if (!updated) throw new SaveError('주차를 찾을 수 없습니다.', 404)
  return updated
}
