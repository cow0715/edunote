import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { ClinicEnrollment, ClinicSlot, ClinicStudent } from '@/lib/types'

type ClassStudentRow = {
  class_id: string
  student_id: string
  class: { id: string; name: string; teacher_id: string; archived_at: string | null } | { id: string; name: string; teacher_id: string; archived_at: string | null }[] | null
  student: {
    id: string
    name: string
    phone: string | null
    father_phone: string | null
    mother_phone: string | null
    school: string | null
    grade: string | null
  } | {
    id: string
    name: string
    phone: string | null
    father_phone: string | null
    mother_phone: string | null
    school: string | null
    grade: string | null
  }[] | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function GET() {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const today = todayStr()
  const [{ data: slots, error: slotError }, { data: enrollments, error: enrollmentError }, { data: classStudents, error: studentError }] = await Promise.all([
    supabase
      .from('clinic_slot')
      .select('*')
      .eq('teacher_id', teacherId),
    supabase
      .from('clinic_enrollment')
      .select('*, clinic_slot(*)')
      .eq('teacher_id', teacherId)
      .or(`end_date.is.null,end_date.gt.${today}`)
      .order('start_date', { ascending: true }),
    supabase
      .from('class_student')
      .select('class_id, student_id, class:class_id!inner(id, name, teacher_id, archived_at), student(id, name, phone, father_phone, mother_phone, school, grade)')
      .eq('class.teacher_id', teacherId)
      .is('class.archived_at', null)
      .is('left_at', null),
  ])

  if (slotError) return err(slotError.message, 500)
  if (enrollmentError) return err(enrollmentError.message, 500)
  if (studentError) return err(studentError.message, 500)

  const studentMap = new Map<string, ClinicStudent>()
  for (const row of (classStudents ?? []) as unknown as ClassStudentRow[]) {
    const student = one(row.student)
    const cls = one(row.class)
    if (!student || !cls) continue
    const existing = studentMap.get(student.id)
    if (existing) {
      if (!existing.classes.some((item) => item.id === cls.id)) {
        existing.classes.push({ id: cls.id, name: cls.name })
      }
      continue
    }
    studentMap.set(student.id, {
      id: student.id,
      name: student.name,
      phone: student.phone,
      father_phone: student.father_phone,
      mother_phone: student.mother_phone,
      school: student.school,
      grade: student.grade,
      classes: [{ id: cls.id, name: cls.name }],
    })
  }

  const students = Array.from(studentMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'))

  const relevantEnrollments = ((enrollments ?? []) as ClinicEnrollment[]).filter((enrollment) => enrollment.end_date !== enrollment.start_date)

  return ok({
    slots: (slots ?? []) as ClinicSlot[],
    enrollments: relevantEnrollments,
    students,
  })
}
