import { ANSWER_SHEET_TABLE_HEIGHT, paginateAnswerSheetRows } from './answer-sheet-pagination'
import { answerSheetSlots, type SlotQuestion } from './answer-sheet-slots'
import { groupQuestionParents, type QuestionPresentation } from './question-presentation'

export type PrintQuestion = QuestionPresentation & SlotQuestion & {
  question_number: number
  sub_label: string | null
  question_style: string
  correct_answer_text: string | null
}

type AnswerRow = {
  qNum: number
  group: PrintQuestion[]
  stacked: boolean
  minHeight: number
  weight: number
  part?: number
  slotCount?: number
}

export function buildAnswerSheetPages(questions: readonly PrintQuestion[]) {
  const groups = groupQuestionParents(questions)
  const rows = groups.flatMap<AnswerRow>(({ qNum, group }) => {
    const style = group[0]?.question_style
    if (style === 'find_error') {
      const { count } = answerSheetSlots(group)
      const limit = 32
      return Array.from({ length: Math.ceil(count / limit) }, (_, part) => {
        const slotCount = Math.min(limit, count - part * limit)
        return { qNum, group, stacked: false, part, slotCount, minHeight: slotCount * 20 + 24, weight: 3.2 }
      })
    }
    const short = ['objective', 'multi_select', 'ox'].includes(style)
    const stacked = group.length > 3
    const rowHeight = short ? 36 : 44
    const perPage = stacked ? Math.floor(ANSWER_SHEET_TABLE_HEIGHT / rowHeight) : group.length
    return Array.from({ length: Math.ceil(group.length / perPage) }, (_, part) => {
      const entries = group.slice(part * perPage, (part + 1) * perPage)
      return { qNum, group: entries, stacked, part, minHeight: rowHeight * (stacked ? entries.length : 1), weight: short ? 1 : 2.4 }
    })
  })
  return { pages: paginateAnswerSheetRows(rows), questionCount: groups.length }
}
