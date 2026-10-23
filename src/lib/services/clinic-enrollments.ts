import 'server-only'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { SaveError } from '@/lib/db/errors'
import { dateInput, parseInput } from '@/lib/db/input'
import { lockClass, type TeacherTransaction } from '@/lib/db/transaction'
import { lockStudent } from './students'

export async function saveClinicEnrollment(context: TeacherTransaction, input: unknown) {
  const body = parseInput(z.object({
    student_id: z.string().uuid(), clinic_slot_id: z.string().uuid().nullish(),
    start_date: z.preprocess(value => value === '' ? undefined : value, dateInput.optional()),
    action: z.enum(['enroll','unenroll']).optional(),
  }), input)
  const startDate = body.start_date ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const slotId = body.clinic_slot_id ?? null
  const action = body.action ?? (slotId ? 'enroll' : 'unenroll')
  if (action === 'enroll' && !slotId) throw new SaveError('배정할 보충수업 요일이 필요합니다')
  // Same parent-before-student lock order as enrollment/withdrawal saves.
  // The student lock serializes competing clinic assignments even when no row exists yet.
  const classes = (await context.tx.execute(sql`select id from public.class where teacher_id=${context.teacherId}::uuid order by id`)).rows
  for (const cls of classes) await lockClass(context, String(cls.id))
  await lockStudent(context, body.student_id)
  const active = (await context.tx.execute(sql`select cs.id from public.class_student cs join public.class c on c.id=cs.class_id
    where cs.student_id=${body.student_id}::uuid and cs.left_at is null and c.archived_at is null
      and c.teacher_id=${context.teacherId}::uuid limit 1`)).rows[0]
  if (!active) throw new SaveError('재원 학생만 보충수업에 배정할 수 있습니다',422)
  if (slotId) {
    const slot = (await context.tx.execute(sql`select id from public.clinic_slot where id=${slotId}::uuid
      and teacher_id=${context.teacherId}::uuid and is_active=true`)).rows[0]
    if (!slot) throw new SaveError('활성 보충수업 요일을 찾을 수 없습니다',422)
  }
  if (action === 'unenroll') {
    await context.tx.execute(sql`update public.clinic_enrollment set end_date=greatest(start_date,${startDate}::date)
      where teacher_id=${context.teacherId}::uuid and student_id=${body.student_id}::uuid
        and (end_date is null or end_date>${startDate}::date)
        ${slotId ? sql`and clinic_slot_id=${slotId}::uuid` : sql``}`)
    return { ok: true, enrollment: null }
  }
  const overlapping = (await context.tx.execute(sql`select * from public.clinic_enrollment
    where teacher_id=${context.teacherId}::uuid and student_id=${body.student_id}::uuid and clinic_slot_id=${slotId}::uuid
      and (end_date is null or end_date>${startDate}::date) order by start_date desc,id for update`)).rows
  const open = overlapping.find(row => !row.end_date)
  let savedId: unknown
  if (open) {
    savedId=open.id
    await context.tx.execute(sql`update public.clinic_enrollment set start_date=${startDate}::date
      where id=${open.id}::uuid and start_date>${startDate}::date`)
  } else if (overlapping[0]) {
    savedId=overlapping[0].id
    await context.tx.execute(sql`update public.clinic_enrollment set end_date=null where id=${savedId}::uuid`)
  } else {
    savedId=(await context.tx.execute(sql`insert into public.clinic_enrollment(teacher_id,student_id,clinic_slot_id,start_date,end_date)
      values(${context.teacherId}::uuid,${body.student_id}::uuid,${slotId}::uuid,${startDate}::date,null) returning id`)).rows[0].id
  }
  const enrollment=(await context.tx.execute(sql`select to_jsonb(e)||jsonb_build_object('clinic_slot',to_jsonb(s)) as enrollment from public.clinic_enrollment e
    join public.clinic_slot s on s.id=e.clinic_slot_id where e.id=${savedId}::uuid`)).rows[0]?.enrollment as Record<string, unknown> | undefined
  if (!enrollment) throw new SaveError('배정 정보를 확인할 수 없습니다.',409)
  return { ok: true, enrollment }
}
