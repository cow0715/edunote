import { answerSheetSlots, OPTIONAL_SLOT_GUIDANCE, type SlotQuestion } from '@/lib/answer-sheet-slots'
import { groupQuestionParents, questionLabel, type QuestionPresentation } from '@/lib/question-presentation'
import { oxChoiceLabels, oxNotationForGroup } from '@/lib/ox-grading'

export type PrintQuestion = QuestionPresentation & SlotQuestion & {
  question_number: number
  sub_label: string | null
  question_style: string
  correct_answer_text: string | null
}

function buildRows(questions: PrintQuestion[]) {
  const rows = groupQuestionParents(questions).map(({ qNum, group }) => {
    const style = group[0]?.question_style
    const short = ['objective', 'multi_select', 'ox'].includes(style)
    const stacked = group.length > 3 && style !== 'find_error'
    return {
      qNum, group, stacked,
      minHeight: style === 'find_error' ? answerSheetSlots(group).count * 20 + 24 : (short ? 36 : 44) * (stacked ? group.length : 1),
      weight: style === 'find_error' ? 3.2 : short ? 1 : 2.4,
    }
  })
  const minTotal = rows.reduce((sum, row) => sum + row.minHeight, 0)
  const weightTotal = rows.reduce((sum, row) => sum + row.weight, 0)
  const extra = Math.max(0, 255 * 72 / 25.4 - minTotal)
  // Crowded sheets can flow to another page; never shrink below a usable writing height.
  return rows.map(row => ({ ...row, heightPt: Math.floor(row.minHeight + extra * row.weight / weightTotal) }))
}

const NUMBER_MARKS = ['①', '②', '③', '④', '⑤']
const LETTER_MARKS = ['ⓐ', 'ⓑ', 'ⓒ', 'ⓓ', 'ⓔ']

function ResponseGuide({ question, group }: { question: PrintQuestion; group: PrintQuestion[] }) {
  if (question.question_style === 'objective' || question.question_style === 'multi_select') {
    const marks = question.question_style === 'multi_select' && /[a-e]/i.test(question.correct_answer_text ?? '') ? LETTER_MARKS : NUMBER_MARKS
    return <div className="print-choice-marks">{marks.map(mark => <span key={mark}>{mark}</span>)}</div>
  }
  if (question.question_style === 'ox') {
    const notation = oxNotationForGroup(group.map(q => q.correct_answer_text))
    const { yes, no } = oxChoiceLabels(notation)
    return <span className="print-ox-guide">{yes} / {no}{notation === 'OX' && <span>수정답:</span>}</span>
  }
  return null
}

function AnswerArea({ row }: { row: ReturnType<typeof buildRows>[number] }) {
  const first = row.group[0]
  const hasSub = row.group.length > 1 || first.sub_label != null
  if (first.question_style === 'find_error') {
    const { count, optional } = answerSheetSlots(row.group)
    return <div className="print-error-slots" style={{ minHeight: `${row.heightPt}pt` }}>
      {optional && <p className="print-error-guidance">{OPTIONAL_SLOT_GUIDANCE}</p>}
      {Array.from({ length: count }, (_, i) => <div className="print-error-slot" key={i}>
        <span>번호·기호 [&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;]</span><span>고친 표현:</span><span className="print-error-line" />
      </div>)}
    </div>
  }
  if (hasSub) {
    return <div className={`print-sub-grid${row.stacked ? ' print-sub-stacked' : ''}`}
      style={{ gridTemplateColumns: `repeat(${row.stacked ? 1 : row.group.length}, minmax(0, 1fr))`, minHeight: `${row.heightPt}pt` }}>
      {row.group.map(q => <div className="print-sub-slot" key={`${q.question_number}:${q.sub_label ?? ''}`}>
        <span className="print-sub-label">{q.sub_label ? `(${q.sub_label})` : ''}</span>
        <div className="print-sub-response"><ResponseGuide question={q} group={row.group} /></div>
      </div>)}
    </div>
  }
  return <div className="print-single-response" style={{ minHeight: `${row.heightPt}pt` }}>
    <ResponseGuide question={first} group={row.group} />
  </div>
}

export function AnswerSheetDocument({ questions, weekLabel }: { questions: PrintQuestion[]; weekLabel: string }) {
  const rows = buildRows(questions)
  return <>
    <section className="answer-print-page" aria-label={`${weekLabel} 진단평가 답안지`}>
      <header className="answer-print-header">
        <h2>{weekLabel} 진단평가 답안지</h2>
        <div className="answer-print-identity"><span>학번: __________________</span><span>이름: __________________</span></div>
      </header>
      <table className="answer-table" aria-label="학생 작성용 답안 표">
        <colgroup><col className="print-number-col" /><col /></colgroup>
        <tbody>{rows.map(row => <tr key={row.qNum}>
          <th scope="row" className="print-question-number">{questionLabel(row.group[0], false)}</th>
          <td className="print-response-cell"><AnswerArea row={row} /></td>
        </tr>)}</tbody>
      </table>
    </section>
    <style>{ANSWER_SHEET_PRINT_CSS}</style>
  </>
}

export const ANSWER_SHEET_PRINT_CSS = `
  @page { size: A4 portrait; margin: 10mm; }
  .answer-print-page {
    width: 210mm; min-height: 297mm; padding: 10mm; margin: 0 auto;
    box-sizing: border-box; background: #fff; color: #191F28; color-scheme: light;
    font-family: 'Malgun Gothic', Arial, sans-serif;
  }
  .answer-print-header { margin-bottom: 9pt; }
  .answer-print-header h2 { margin: 0; text-align: center; font-size: 14pt; font-weight: 800; line-height: 1.4; }
  .answer-print-identity { display: flex; justify-content: flex-end; gap: 24pt; margin-top: 6pt; font-size: 9pt; font-weight: 600; }
  .answer-table { width: 100%; border-collapse: collapse; border: 1.25pt solid #333D4B; table-layout: fixed; }
  .answer-table tr { break-inside: avoid; page-break-inside: avoid; }
  .answer-table th, .answer-table td { border: .75pt solid #6B7684; vertical-align: middle; }
  .print-number-col { width: 46pt; }
  .print-question-number { padding: 4pt; text-align: center; font-size: 9pt; font-weight: 700; white-space: nowrap; background: #F2F4F6; }
  .print-response-cell { padding: 0; }
  .print-single-response { display: flex; align-items: center; padding: 5pt 12pt; box-sizing: border-box; }
  .print-sub-grid { display: grid; }
  .print-sub-slot { display: flex; min-width: 0; }
  .print-sub-slot + .print-sub-slot { border-left: .75pt solid #6B7684; }
  .print-sub-stacked .print-sub-slot + .print-sub-slot { border-left: 0; border-top: .75pt solid #6B7684; }
  .print-sub-label { display: flex; align-items: center; justify-content: center; flex: 0 0 20pt; font-size: 9pt; font-weight: 600; border-right: .75pt solid #6B7684; background: #F9FAFB; }
  .print-sub-response { display: flex; align-items: center; flex: 1; min-width: 0; padding: 5pt 7pt; }
  .print-choice-marks { display: flex; justify-content: space-between; align-items: center; width: 220pt; max-width: 100%; gap: 5pt; font-size: 14pt; font-weight: 600; line-height: 1; }
  .print-ox-guide { display: flex; flex-wrap: wrap; gap: 8pt; font-size: 10pt; }
  .print-error-slots { display: flex; flex-direction: column; justify-content: space-evenly; gap: 5pt; padding: 6pt 10pt; box-sizing: border-box; }
  .print-error-guidance { margin: 0; font-size: 9pt; }
  .print-error-slot { display: flex; align-items: flex-end; gap: 5pt; font-size: 9pt; }
  .print-error-line { flex: 1; height: 12pt; border-bottom: .5pt solid #8B95A1; }
  @media print {
    html, body { width: auto; background: #fff !important; }
    .answer-print-page { width: auto; min-height: auto; padding: 0; margin: 0; }
  }
`
