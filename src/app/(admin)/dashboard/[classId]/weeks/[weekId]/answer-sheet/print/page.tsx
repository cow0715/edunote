import { answerSheetCode } from '@/lib/answer-sheet-identity'
import Link from 'next/link'
import { AnswerSheetDocument, buildAnswerSheetPages, type PrintQuestion } from './answer-sheet-document'
import { assertWeekOwner, getAuth, getTeacherId } from '@/lib/api'
import { buildWeekDisplayMap, type ClassPeriod } from '@/lib/class-periods'
import { PrintButton } from './print-button'

export default async function AnswerSheetPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string; weekId: string }>
  searchParams?: Promise<{ students?: string; duplex?: string }>
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
  const { pages, questionCount } = buildAnswerSheetPages(questions as PrintQuestion[])
  const options = await searchParams
  const personalized = options?.students === '1'
  const duplex = options?.duplex === undefined ? pages.length > 1 : options.duplex === '1'
  const { data: enrollments, error: rosterError } = personalized && week.class_id
    ? await supabase.from('class_student').select('student_id, student(name)').eq('class_id', week.class_id).is('left_at', null).order('joined_at')
    : { data: null, error: null }
  const roster = (enrollments ?? []).flatMap(({ student_id, student }) => {
    const name = (Array.isArray(student) ? student[0] : student)?.name
    return typeof name === 'string' && name ? [{ name, code: answerSheetCode(weekId, student_id) }] : []
  }).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  const copies = personalized ? roster : [{ name: '', code: '' }]


  return (
    <main className="answer-print bg-gray-100 py-6 print:bg-white print:py-0">
      <div className="answer-print-controls mx-auto mb-4 flex max-w-[210mm] flex-wrap items-start justify-between gap-3 px-4 print:hidden">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{weekLabel} 진단평가 답안지</h1>
          <p className="text-xs text-gray-500">{className ? `${className} · ` : ''}{questionCount}문항 · A4 {pages.length}페이지{personalized && ` · ${roster.length}명`}</p>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            <Link href="?students=0" aria-current={personalized ? undefined : 'page'} className={personalized ? 'text-gray-600 underline' : 'font-bold text-gray-900'}>빈 답안지</Link>
            <Link href="?students=1" aria-current={personalized ? 'page' : undefined} className={personalized ? 'font-bold text-gray-900' : 'text-gray-600 underline'}>학생별 답안지</Link>
          </div>
          <p className="mt-2 text-xs text-gray-600">학생별 답안지는 모든 페이지에 이름과 판독 코드를 인쇄합니다.</p>
          {personalized && pages.length % 2 === 1 && roster.length > 1 && (
            <Link href={`?students=1&duplex=${duplex ? '0' : '1'}`} className="mt-2 inline-block text-xs text-gray-700 underline">
              {duplex ? '단면 인쇄용으로 보기' : '양면 인쇄용으로 보기'}
            </Link>
          )}
          {duplex && <p className="mt-2 text-xs text-gray-600">인쇄 창에서 A4 · 실제 크기(100%) · 양면(긴 쪽 넘기기)을 선택하세요.</p>}
          {personalized && !duplex && <p className="mt-2 text-xs text-gray-600">인쇄 창에서 A4 · 실제 크기(100%) · 단면을 선택하세요.</p>}
        </div>
        {copies.length > 0 && <PrintButton />}
      </div>
      {personalized && copies.length === 0 && (
        <p role="status" className="mx-auto max-w-[210mm] px-4 py-6 text-sm text-gray-700">{rosterError ? '학생 명단을 불러오지 못했습니다.' : '등록된 재원생이 없습니다.'}</p>
      )}
      <AnswerSheetDocument questions={questions as PrintQuestion[]} weekLabel={weekLabel} pages={pages} copies={copies} duplex={duplex} />
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
