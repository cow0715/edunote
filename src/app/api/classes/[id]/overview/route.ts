import { getAuth, err, ok } from '@/lib/api'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId } = await params
  const [{ data: classStudents }, { data: weeks }] = await Promise.all([
    supabase.from('class_student').select('student_id, student(*), joined_at, left_at').eq('class_id', classId).order('joined_at'),
    supabase.from('week').select('*').eq('class_id', classId).order('week_number'),
  ])
  if (!weeks || !classStudents) return ok({ students: [], weeks: [], scores: [], attendance: [] })
  const weekIds = weeks.map((w) => w.id)
  const studentIds = classStudents.map((cs) => cs.student_id)
  const startDates = weeks.filter((w) => w.start_date).map((w) => w.start_date as string)
  const [{ data: scores }, { data: attendance }] = await Promise.all([
    weekIds.length > 0 ? supabase.from('week_score').select('student_id, week_id, vocab_correct, reading_correct, homework_done').in('week_id', weekIds).in('student_id', studentIds) : Promise.resolve({ data: [] }),
    startDates.length > 0 ? supabase.from('attendance').select('student_id, date, status').eq('class_id', classId).in('date', startDates) : Promise.resolve({ data: [] }),
  ])
  return ok({ students: classStudents ?? [], weeks: weeks ?? [], scores: scores ?? [], attendance: attendance ?? [] })
}