import 'server-only'
import { z } from 'zod'
import { classes, periods, weeks } from '@/lib/db/schema'
import { dateInput, parseInput } from '@/lib/db/input'
import { SaveError } from '@/lib/db/errors'
import type { TeacherTransaction } from '@/lib/db/transaction'
import { sessionDates } from './class-weeks'

const optionalNumber = z.preprocess(value => value === '' || value === undefined ? null : value, z.coerce.number().int().nullable())
export async function createClass({ tx, teacherId }: TeacherTransaction, input: unknown) {
  const { period_label, ...values } = parseInput(z.object({
    name: z.string().trim().min(1).max(200),
    description: z.string().nullable().optional(),
    start_date: dateInput,
    end_date: dateInput,
    schedule_days: z.array(z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])).default([]),
    academic_year: optionalNumber,
    school_name: z.string().nullable().optional(),
    grade_level: optionalNumber,
    class_type: z.enum(['regular', 'special']).default('regular'),
    period_label: z.string().trim().min(1).max(200).default('1학기 중간'),
  }), input)
  if (values.end_date < values.start_date) throw new SaveError('종료일은 시작일 이후여야 합니다.')
  const dates = sessionDates(values.start_date, values.end_date, values.schedule_days)
  const [created] = await tx.insert(classes).values({ ...values, teacher_id: teacherId }).returning()
  if (dates.length) await tx.insert(weeks).values(dates.map((date, i) => ({ class_id: created.id, week_number: i + 1, start_date: date })))
  await tx.insert(periods).values({ class_id: created.id, label: period_label, semester: 1, exam_type: 'midterm', start_date: values.start_date, is_current: true, sort_order: 1 })
  return created
}
