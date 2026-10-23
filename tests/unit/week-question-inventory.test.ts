import { describe, expect, it } from 'vitest'
import { buildWeekQuestionTargets, weekTargetIssues } from '@/lib/week-question-inventory'

const inventory = () => ({
  counts: { general: 7, written: 3 },
  questions: [
    ...Array.from({ length: 7 }, (_, i) => ({ section: 'general', number: i + 1, sub_labels: [null], display_order: i === 6 ? 8 : i + 1, passage_group: i === 5 ? 'p6' : null })),
    { section: 'written', number: 1, sub_labels: ['a', 'b'], display_order: 7, passage_group: 'p6' },
    { section: 'written', number: 2, sub_labels: [null], display_order: 9, passage_group: null },
    { section: 'written', number: 3, sub_labels: ['a', 'b', 'c'], display_order: 10, passage_group: null },
  ],
})

// Same parent/slot layout as the reported five-page PDF, without student/teacher data.
const native = '객관식 7 · 서답형 3 · 정답·해설은 해설지 [6, 서답형 1] 다음 글 ' +
  '서답형 1 윗글에서 두 가지를 쓰시오. (1) (2) 7. 다음 글의 주제는? ' +
  '서답형 2 주어진 어구를 배열하시오. 서답형 3 다음 빈칸을 쓰시오. (1) 문장 (2) 문장 (3) 문장'

describe('week question inventory', () => {
  it('rejects numeric sorting and incorrect shared-passage references independently of leaf coverage', () => {
    const sortedNumerically = inventory()
    sortedNumerically.questions[6].display_order = 7
    sortedNumerically.questions[7].display_order = 8
    expect(() => buildWeekQuestionTargets(sortedNumerically, native)).toThrow('배치 순서 불일치')
    const wrongGroup = inventory()
    wrongGroup.questions[7].passage_group = 'different'
    expect(() => buildWeekQuestionTargets(wrongGroup, native)).toThrow('공통 지문 그룹 불일치')
    expect(() => buildWeekQuestionTargets(inventory(), '[3~4]')).toThrow('공통 지문 그룹 불일치')
  })
  it('keeps objective numbering and gives written parents unique internal numbers, with all 13 leaves', () => {
    const targets = buildWeekQuestionTargets(inventory(), native)
    expect(targets.map((t) => t.question_number)).toEqual([1, 2, 3, 4, 5, 6, 8, 7, 9, 10])
    expect(targets.filter((t) => t.section === 'written').map((t) => [t.section, t.number, t.sub_labels])).toEqual([
      ['written', 1, ['a', 'b']], ['written', 2, [null]], ['written', 3, ['a', 'b', 'c']],
    ])
    expect(targets.reduce((n, t) => n + t.sub_labels.length, 0)).toBe(13)
  })

  it('rejects the original incident even when discovery claims only seven questions exist', () => {
    const input = inventory()
    input.counts.written = 0
    input.questions = input.questions.slice(0, 7)
    expect(() => buildWeekQuestionTargets(input, native)).toThrow(/누락|불일치/)
  })

  it('compares independent cover counts and numbered answer slots, not just discovered parent numbers', () => {
    const input = inventory()
    input.questions[7].sub_labels = ['a']
    expect(() => buildWeekQuestionTargets(input, native)).toThrow('소문항 목록 불일치')
    expect(() => buildWeekQuestionTargets(inventory(), '객관식 8 · 서답형 3 ·')).toThrow('총 문항 수 불일치')
  })

  it('rejects duplicate parents, duplicate leaves, and inconsistent declared counts', () => {
    const input = inventory()
    input.questions.push(input.questions[0])
    expect(() => buildWeekQuestionTargets(input)).toThrow('중복')
    const duplicate = inventory()
    duplicate.questions[7].sub_labels = ['a', 'a']
    expect(() => buildWeekQuestionTargets(duplicate)).toThrow('소문항 목록 오류')
    const wrongCount = inventory()
    wrongCount.counts.general = 8
    expect(() => buildWeekQuestionTargets(wrongCount)).toThrow('개수 불일치')
  })

  it('does not mistake a section count for a printed written number in non-contiguous numbering', () => {
    expect(buildWeekQuestionTargets({ counts: { general: 0, written: 1 }, questions: [
      { section: 'written', number: 12, sub_labels: [null], display_order: 1, passage_group: null },
    ] }, '서답형 1 문항 · 서답형 12 영작하시오.')[0].question_number).toBe(12)
  })

  it('a sibling or a duplicate cannot fill in for a missing leaf or another section', () => {
    const target = buildWeekQuestionTargets(inventory()).find((t) => t.section === 'written' && t.number === 1)!
    const a = { question_number: 8, sub_label: 'a', source_section: 'written', source_question_number: 1 }
    expect(weekTargetIssues(target, [a])).toEqual(['서답형 1(b): 누락'])
    expect(weekTargetIssues(target, [a, a])).toEqual(['서답형 1(a): 중복', '서답형 1(b): 누락'])
    expect(weekTargetIssues(target, [a, { ...a, sub_label: 'b' }])).toEqual([])
    expect(weekTargetIssues(target, [a, { ...a, sub_label: 'b', source_section: 'general' }])).toContain('서답형 1(b): 누락')
  })
})
