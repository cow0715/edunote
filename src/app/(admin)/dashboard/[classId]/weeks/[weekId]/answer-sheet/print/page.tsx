import { groupQuestionParents } from '@/lib/question-presentation'
import { AnswerSheetDocument, type PrintQuestion } from './answer-sheet-document'
import { assertWeekOwner, getAuth, getTeacherId } from '@/lib/api'
import { buildWeekDisplayMap, type ClassPeriod } from '@/lib/class-periods'
import { PrintButton } from './print-button'

export default async function AnswerSheetPrintPage({
  params,
}: {
  params: Promise<{ classId: string; weekId: string }>
}) {
  const { weekId } = await params
  const { supabase, user } = await getAuth()
  if (!user) return <PrintMessage message="로그인이 필요합니다." />

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return <PrintMessage message="강사 정보를 찾을 수 없습니다." />
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return <PrintMessage message="접근 권한이 없습니다." />

  const { data: week } = await supabase
    .from('week')
    .select('id, week_number, start_date, class_id, class(name)')
    .eq('id', weekId)
    .single()

  const { data: questions } = await supabase
    .from('exam_question')
    .select('question_number, sub_label, question_style, question_stem, question_text, passage, choices, correct_answer_text, source_section, source_question_number, display_order, passage_group, shared_passage')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')
    .order('question_number')
    .order('sub_label', { nullsFirst: true })

  if (!week || !questions?.length) {
    return <PrintMessage message="문항이 없습니다. 해설지를 먼저 업로드해주세요." />
  }

  const className = (week.class as unknown as { name: string } | null)?.name ?? ''
  const { data: periods } = week.class_id
    ? await supabase.from('class_period').select('*').eq('class_id', week.class_id).order('sort_order').order('start_date')
    : { data: [] }
  const { data: classWeeks } = week.class_id
    ? await supabase.from('week').select('id, class_id, week_number, start_date').eq('class_id', week.class_id)
    : { data: [] }
  const weekLabel = buildWeekDisplayMap(classWeeks ?? [], (periods ?? []) as ClassPeriod[]).get(week.id)?.displayLabel ?? `${week.week_number}주차`
  const rows = groupQuestionParents(questions as PrintQuestion[])

  return (
    <main className="min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex w-[210mm] items-center justify-between print:hidden">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{weekLabel} 진단평가 답안지</h1>
          <p className="text-xs text-gray-500">{className ? `${className} · ` : ''}{rows.length}문항 · A4 인쇄용</p>
        </div>
        <PrintButton />
      </div>

      <AnswerSheetDocument questions={questions as PrintQuestion[]} weekLabel={weekLabel} />
    </main>
  )
}

function PrintMessage({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white p-8 text-sm text-gray-500">
      {message}
    </main>
  )
}
