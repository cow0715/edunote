import { assertWeekOwner, getAuth, getTeacherId } from '@/lib/api'
import { buildWeekDisplayMap, type ClassPeriod } from '@/lib/class-periods'
import { PrintButton } from './print-button'

type QuestionRow = {
  question_number: number
  sub_label: string | null
  question_style: string
}

type RowInfo = {
  qNum: number
  group: QuestionRow[]
  isShort: boolean
  heightPt: number
}

function isShortStyle(style: string | null | undefined) {
  return style === 'objective' || style === 'ox' || style === 'multi_select'
}

function groupQuestions(questions: QuestionRow[]) {
  const grouped = new Map<number, QuestionRow[]>()
  for (const q of questions) {
    const list = grouped.get(q.question_number) ?? []
    list.push(q)
    grouped.set(q.question_number, list)
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([qNum, group]) => ({ qNum, group }))
}

function buildRows(questions: QuestionRow[]): RowInfo[] {
  const grouped = groupQuestions(questions)
  const baseRows = grouped.map(({ qNum, group }) => ({
    qNum,
    group,
    isShort: isShortStyle(group[0]?.question_style),
  }))
  const shortCount = baseRows.filter((row) => row.isShort).length
  const tallCount = baseRows.length - shortCount
  const availMm = 255
  const shortPt = 28
  const tallMaxPt = 120
  const shortMm = shortPt / 2.835
  const remainingMm = Math.max(0, availMm - shortCount * shortMm)
  const tallPtRaw = tallCount > 0 ? Math.floor((remainingMm / tallCount) * 2.835) : 0
  const tallPt = Math.max(36, Math.min(tallPtRaw, tallMaxPt))

  return baseRows.map((row) => ({
    ...row,
    heightPt: row.isShort ? shortPt : tallPt,
  }))
}

function ObjectiveMarks() {
  return (
    <div className="flex items-center gap-5 text-[16px] font-semibold">
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n}>{n}</span>
      ))}
    </div>
  )
}

function AnswerCells({ row, maxSubs }: { row: RowInfo; maxSubs: number }) {
  const first = row.group[0]
  const style = first?.question_style
  const hasSub = row.group.length > 1 || first?.sub_label !== null
  const answerColSpan = maxSubs * 2

  if ((style === 'objective' || style === 'multi_select') && !hasSub) {
    return (
      <td className="answer-cell" colSpan={answerColSpan}>
        <ObjectiveMarks />
      </td>
    )
  }

  if ((style === 'objective' || style === 'multi_select') && hasSub) {
    return (
      <>
        {row.group.map((q) => (
          <FragmentCells key={`${q.question_number}-${q.sub_label ?? 'none'}`} label={q.sub_label} objective />
        ))}
        {Array.from({ length: Math.max(0, maxSubs - row.group.length) }).map((_, index) => (
          <FragmentCells key={`empty-${index}`} label={null} />
        ))}
      </>
    )
  }

  if (style === 'ox') {
    return (
      <td className="answer-cell" colSpan={answerColSpan}>
        O / X&nbsp;&nbsp;&nbsp; 수정답:
      </td>
    )
  }

  if ((style === 'find_error' || style === 'subjective') && hasSub) {
    return (
      <>
        {row.group.map((q) => (
          <FragmentCells key={`${q.question_number}-${q.sub_label ?? 'none'}`} label={q.sub_label} />
        ))}
        {Array.from({ length: Math.max(0, maxSubs - row.group.length) }).map((_, index) => (
          <FragmentCells key={`empty-${index}`} label={null} />
        ))}
      </>
    )
  }

  return <td className="answer-cell" colSpan={answerColSpan} />
}

function FragmentCells({ label, objective = false }: { label: string | null; objective?: boolean }) {
  return (
    <>
      <td className="sub-header">{label ? `(${label})` : ''}</td>
      <td className="sub-answer">{objective ? '① ② ③ ④ ⑤' : ''}</td>
    </>
  )
}

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
    .select('question_number, sub_label, question_style')
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
  const rows = buildRows(questions as QuestionRow[])
  const maxSubs = Math.max(1, ...rows.map((row) => row.group.length))

  return (
    <main className="min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex w-[210mm] items-center justify-between print:hidden">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{weekLabel} 진단평가 답안지</h1>
          <p className="text-xs text-gray-500">{className ? `${className} · ` : ''}{rows.length}문항 · A4 인쇄용</p>
        </div>
        <PrintButton />
      </div>

      <section className="answer-print-page mx-auto bg-white shadow-sm print:shadow-none">
        <header className="mb-3">
          <h2 className="text-center text-[18px] font-black text-gray-950">{weekLabel} 진단평가 답안지</h2>
          <div className="mt-2 flex justify-end gap-8 text-[12px] font-semibold text-gray-900">
            <span>학번: __________________</span>
            <span>이름: __________________</span>
          </div>
        </header>

        <table className="answer-table">
          <tbody>
            {rows.map((row) => (
              <tr key={row.qNum} style={{ height: `${row.heightPt}pt` }}>
                <td className="q-number">{row.qNum}</td>
                <AnswerCells row={row} maxSubs={maxSubs} />
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <style>{`
        @page {
          size: A4 portrait;
          margin: 10mm;
        }

        .answer-print-page {
          width: 210mm;
          min-height: 297mm;
          padding: 10mm;
          box-sizing: border-box;
        }

        .answer-table {
          width: 100%;
          border-collapse: collapse;
          border: 2px solid #000;
          table-layout: fixed;
          font-family: 'Malgun Gothic', Arial, sans-serif;
        }

        .answer-table td {
          border: 1px solid #000;
          padding: 2pt 4pt;
          vertical-align: middle;
        }

        .q-number {
          width: 36pt;
          text-align: center;
          font-weight: 800;
          background: #fde3c4;
        }

        .answer-cell {
          font-size: 13px;
        }

        .sub-header {
          width: 26pt;
          text-align: center;
          font-size: 12px;
          font-weight: 800;
          background: #f5f5f5;
        }

        .sub-answer {
          font-size: 12px;
        }

        @media print {
          html,
          body {
            width: 210mm;
            background: white !important;
          }

          .answer-print-page {
            width: auto;
            min-height: auto;
            padding: 0;
            margin: 0;
            box-shadow: none !important;
          }
        }
      `}</style>
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
