import 'server-only'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { SaveError } from '@/lib/db/errors'
import { parseInput } from '@/lib/db/input'
import { executeStatements, insertRows, updateRows, deleteRows } from '@/lib/db/statements'
import { lockClass, type TeacherTransaction } from '@/lib/db/transaction'

const optionalText = z.string().nullable().optional()
const studentInput = z.object({ name: z.string().trim().min(1).max(200), phone: optionalText,
  father_phone: optionalText, mother_phone: optionalText, school: optionalText, grade: optionalText, memo: optionalText })
const moment = z.string().refine(value => !Number.isNaN(Date.parse(value)), '날짜가 올바르지 않습니다.')

export async function lockStudent({ tx, teacherId }: TeacherTransaction, studentId: string) {
  const result = await tx.execute(sql`select * from public.student where id=${studentId}::uuid and teacher_id=${teacherId}::uuid for update`)
  if (!result.rows[0]) throw new SaveError('학생 접근 권한이 없습니다.', 403)
  return result.rows[0]
}

export async function registerStudent(context: TeacherTransaction, input: unknown) {
  const { class_id, joined_at, ...values } = parseInput(studentInput.extend({
    class_id: z.string().uuid().nullish(), joined_at: moment.nullish(),
  }), input)
  // All class membership paths acquire class before student (same as grading).
  if (class_id) await lockClass(context, class_id)
  const id = randomUUID()
  await executeStatements(context.tx, insertRows('student', [{ id, teacher_id: context.teacherId, ...values }]))
  if (class_id) await executeStatements(context.tx, insertRows('class_student', [{ class_id, student_id: id,
    left_at: null, ...(joined_at ? { joined_at } : {}) }], ['class_id', 'student_id']))
  const result = await context.tx.execute(sql`select * from public.student where id=${id}::uuid`)
  if (!result.rows[0]) throw new SaveError('학생 저장에 실패했습니다.', 409)
  return result.rows[0]
}

export async function enrollStudent(context: TeacherTransaction, classId: string, input: unknown) {
  const { student_id, joined_at } = parseInput(z.object({ student_id: z.string().uuid(), joined_at: moment.nullish() }), input)
  await lockClass(context, classId)
  await lockStudent(context, student_id)
  await executeStatements(context.tx, insertRows('class_student', [{ class_id: classId, student_id,
    left_at: null, ...(joined_at ? { joined_at } : {}) }], ['class_id', 'student_id']))
  const result = await context.tx.execute(sql`select cs.*,to_jsonb(s) as student from public.class_student cs
    join public.student s on s.id=cs.student_id where cs.class_id=${classId}::uuid and cs.student_id=${student_id}::uuid`)
  if (!result.rows[0]) throw new SaveError('반 배정에 실패했습니다.', 409)
  return result.rows[0]
}

export async function changeEnrollment(context: TeacherTransaction, studentId: string, classId: string | null,
  action: 'join_date' | 'withdraw', input: unknown) {
  const parsed = parseInput(z.object({ joined_at: moment.optional(), left_at: moment.optional() }), input)
  if (action === 'join_date' && !parsed.joined_at) throw new SaveError('등록일 필요')
  const leftAt = parsed.left_at ?? new Date().toISOString()
  // A global withdrawal locks all owned classes in stable order, then student.
  const classes = classId ? [classId] : (await context.tx.execute(sql`select id from public.class order by id`)).rows.map(row => String(row.id))
  for (const id of classes) await lockClass(context, id)
  await lockStudent(context, studentId)
  if (classes.length) await executeStatements(context.tx, [updateRows('class_student',
    action === 'join_date' ? { joined_at: parsed.joined_at } : { left_at: leftAt },
    sql`student_id=${studentId}::uuid and class_id in (${sql.join(classes.map(id => sql`${id}::uuid`), sql`, `)})
      ${classId ? sql`` : sql`and left_at is null and class_id in (select id from public.class where archived_at is null)`}`, !!classId)])
  if (action === 'withdraw') {
    await context.tx.execute(sql`update public.clinic_enrollment ce
      set end_date=greatest(ce.start_date,${leftAt.slice(0, 10)}::date)
      where ce.student_id=${studentId}::uuid and ce.teacher_id=${context.teacherId}::uuid
        and (ce.end_date is null or ce.end_date>${leftAt.slice(0, 10)}::date)
        and not exists(select 1 from public.class_student cs join public.class c on c.id=cs.class_id
          where cs.student_id=${studentId}::uuid and cs.left_at is null and c.archived_at is null)`)
  }
  return { ok: true }
}

export async function editStudent(context: TeacherTransaction, studentId: string, input: unknown) {
  const values = parseInput(studentInput, input)
  await lockStudent(context, studentId)
  await executeStatements(context.tx, [updateRows('student', values, sql`id=${studentId}::uuid`, true)])
  return (await context.tx.execute(sql`select * from public.student where id=${studentId}::uuid`)).rows[0]
}

export async function removeStudent(context: TeacherTransaction, studentId: string) {
  const classes = (await context.tx.execute(sql`select id from public.class order by id`)).rows
  for (const row of classes) await lockClass(context, String(row.id))
  await lockStudent(context, studentId)
  await executeStatements(context.tx, [deleteRows('student', sql`id=${studentId}::uuid` )])
  return { ok: true }
}
