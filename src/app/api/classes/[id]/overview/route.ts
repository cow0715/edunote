import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: classId } = await params
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const [{ data: classStudents }, { data: weeks }] = await Promise.all([
    supabase
      .from('class_student')
      .select('student_id, student(*)')
      .eq('class_id', classId)
      .order('created_at'),
    supabase
      .from('week')
      .select('*')
      .eq('class_id', classId)
      .order('week_number'),
  ])

  if (!weeks || !classStudents) {
    return NextResponse.json({ students: [], weeks: [], scores: [], attendance: [] })
  }

  const weekIds = weeks.map((w) => w.id)
  const studentIds = classStudents.map((cs) => cs.student_id)

  const startDates = weeks.filter((w) => w.start_date).map((w) => w.start_date as string)

  const [{ data: scores }, { data: attendance }] = await Promise.all([
    weekIds.length > 0
      ? supabase
          .from('week_score')
          .select('student_id, week_id, vocab_correct, reading_correct, homework_done')
          .in('week_id', weekIds)
          .in('student_id', studentIds)
      : Promise.resolve({ data: [] }),
    startDates.length > 0
      ? supabase
          .from('attendance')
          .select('student_id, date, status')
          .eq('class_id', classId)
          .in('date', startDates)
      : Promise.resolve({ data: [] }),
  ])

  return NextResponse.json({
    students: classStudents ?? [],
    weeks: weeks ?? [],
    scores: scores ?? [],
    attendance: attendance ?? [],
  })
}
