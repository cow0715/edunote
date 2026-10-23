// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ExamQuestion } from '@/lib/types'
import type { StudentAnswer } from '@/app/share/[token]/share-types'

const mocks = vi.hoisted(() => ({ questions: [] as ExamQuestion[] }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.questions, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/use-concept-tags', () => ({ useConceptCategories: () => ({ data: [] }), useConceptTags: () => ({ data: [] }) }))
vi.mock('@/components/grade/source-image-preview', () => ({ SourceImagePreview: () => null }))

import { QuestionTypeEditor } from '@/components/grade/question-type-editor'
import { WrongAnswerPassageList } from '@/app/share/[token]/wrong-answer-card'

const common = 'This is the common source passage.'
function question(number: number, order: number, sub: string | null = null): ExamQuestion {
  const written = number === 8
  return {
    id: `q${number}${sub ?? ''}`, week_id: 'week', question_number: number, sub_label: sub,
    source_section: written ? 'written' : 'general', source_question_number: written ? 1 : number,
    display_order: order, passage_group: number === 7 ? null : 'p6', shared_passage: number === 7 ? null : common,
    exam_type: 'reading', question_style: written ? 'subjective' : 'objective', question_type: null,
    question_stem: `문항 발문 ${number}${sub ?? ''}`, question_text: `문항 발문 ${number}${sub ?? ''}\n${number === 7 ? 'Separate passage.' : common}`,
    passage: number === 7 ? 'Separate passage.' : common, choices: written ? null : ['First', 'Second'],
    correct_answer: written ? 0 : 1, correct_answer_text: written ? '모범답안' : null, extra_correct_answers: [],
    explanation: null, grading_criteria: null, is_void: false, all_correct: false,
    needs_source_image: false, source_image_reason: null, source_page: 3, source_bbox: null, source_image_path: null,
    exam_question_tag: [], created_at: '',
  }
}
const rows = [question(7, 8), question(8, 7, 'b'), question(6, 6), question(8, 7, 'a')]

afterEach(cleanup)

describe('PDF order and shared passage in real question screens', () => {
  it('renders the teacher editor in PDF order with one shared source and the original written number', () => {
    mocks.questions = rows
    render(<QuestionTypeEditor weekId="week" />)
    const group = screen.getByRole('region', { name: '공통 지문 그룹' })
    expect(within(group).getByText('6번')).toBeTruthy()
    expect(within(group).getByText('서답형 1 (a)')).toBeTruthy()
    expect(within(group).getByText('서답형 1 (b)')).toBeTruthy()
    expect(screen.getAllByText(common)).toHaveLength(1)
    expect(screen.queryByText('8번')).toBeNull()
    const labels = ['6번', '서답형 1 (a)', '서답형 1 (b)', '7번'].map((label) => screen.getByText(label))
    for (let i = 0; i < labels.length - 1; i++) {
      expect(labels[i].compareDocumentPosition(labels[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('keeps the same grouping in the parent wrong-note list, including the individual written answers', () => {
    const answers: StudentAnswer[] = rows.map((q) => ({ id: `answer:${q.id}`, week_score_id: 'score', is_correct: false,
      student_answer: q.question_style === 'objective' ? 2 : null, student_answer_text: q.sub_label ? `학생답 ${q.sub_label}` : null,
      ai_feedback: null, exam_question: { ...q, exam_question_tag: [] } }))
    render(<WrongAnswerPassageList answers={answers} token="token" />)
    const group = screen.getByRole('region', { name: '공통 지문 그룹' })
    expect(within(group).getByText('6번')).toBeTruthy()
    expect(within(group).getByText('서답형 1')).toBeTruthy()
    expect(screen.getAllByText(common)).toHaveLength(1)
    expect(within(group).getByText('학생답 a')).toBeTruthy()
    expect(within(group).getByText('학생답 b')).toBeTruthy()
    expect(screen.queryByText('8번')).toBeNull()
  })
})
