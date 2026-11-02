import { describe, expect, it } from 'vitest'
import { inventoryBook, nativeBookLetterChoices } from '@/lib/book-pdf/inventory'
import { bookPublishReady, validateBookUnit } from '@/lib/book-pdf/validation'
import { questionSourceLabel } from '@/lib/book-pdf/labels'
import type { BookExtraction, BookPage, BookUnitManifest } from '@/lib/book-pdf/types'

const page = (n: number, left: string, right = ''): BookPage => ({ page: n, left, right, full: `${left}\n${right}\n2027학년도` })
const header = (chapter: number, number: number, gateway = false) => `[수능특강(영어) ${chapter}강 ${gateway ? 'Gateway ' : ''}${number}번]`

describe('native textbook inventory', () => {
  it('separates repeated question numbers across chapters and Gateway, independently counts printed answers', () => {
    const m = inventoryBook([page(1, '표지'), page(2, `${header(1, 1, true)}\n지문`, '[정답]②\n[해석]해석\n[해설]풀이'),
      page(3, header(1, 1), '[정답]①'), page(4, header(2, 1), '[정답]⑤')], '2026_교재.pdf')
    expect(m.errors).toEqual([])
    expect(m.units.map((u) => u.questions[0].key)).toEqual(['1:gateway:1', '1:exercise:1', '2:exercise:1'])
    expect(m.units[0].questions[0].printed_answer).toBe(2)
    expect(m.units[0].translation).toBe('해석')
    expect(m.warnings.join(' ')).toContain('2026')
    expect(m.printed_years).toEqual([2027])
    expect(m.ignored_pages).toEqual([1])
  })
  it('keeps a shared passage when the second question starts the continuation page', () => {
    const m = inventoryBook([page(1, '표지'), page(2, `[1~2] 다음 글\n공유 지문\n${header(19, 1, true)}`, '[정답]③\n[해석]공통 해석\n[해설]풀이1'),
      page(3, `${header(19, 2, true)}\n두 번째 문제`, '[정답]⑤\n[해설]풀이2'), page(4, `[1~2] 다음 글\n${header(19, 1)}`, '[정답]①'),
      page(5, header(19, 2), '[정답]②')], '교재.pdf')
    expect(m.errors).toEqual([])
    expect(m.units.map((u) => u.pages)).toEqual([[2, 3], [4, 5]])
    expect(m.units[0].questions.map((q) => q.printed_answer)).toEqual([3, 5])
  })
  it('preserves a sentence continued before the three question labels on the next page', () => {
    const m = inventoryBook([page(1, '표지'), page(2, '[1~3] 다음 글\n(A) First paragraph.\n(D) The last sentence continues', '[해석]순서를 바꾼 해석'),
      page(3, `onto this page without a new passage.\n${header(20, 1, true)}\n${header(20, 2, true)}\n${header(20, 3, true)}`, '[정답]①\n[정답]④\n[정답]⑤')], '교재.pdf')
    expect(m.errors).toEqual([])
    expect(m.question_count).toBe(3)
    expect(m.units).toHaveLength(1)
    expect(m.units[0].left_text).toContain('continues\nonto this page')
    expect(m.units[0].pages).toEqual([2, 3])
  })
  it('blocks missing answers, duplicate labels, and unsupported PDFs', () => {
    expect(inventoryBook([page(1, header(1, 1))], '').errors.join(' ')).toContain('정답')
    expect(inventoryBook([page(1, header(1, 1), '[정답]①'), page(2, header(1, 1), '[정답]①')], '').errors.join(' ')).toContain('중복')
    expect(inventoryBook([page(1, '표지'), page(2, '지원하지 않는 레이아웃')], '').errors.length).toBeGreaterThan(0)
  })
  it('retains chart references instead of applying the past-exam chart exclusion', () => {
    const m = inventoryBook([page(1, `${header(8, 1)}\n다음 도표의 내용`, '[정답]④')], '')
    expect(m.errors).toEqual([])
    expect(m.units[0].visual_required).toBe(true)
  })
})

const ref = { key: '1:gateway:1', chapter: 1, section: 'gateway' as const, number: 1, label: '1강 Gateway 1번', label_page: 2, printed_answer: 2 }
const unit: BookUnitManifest = { key: 'unit-1', order: 1, pages: [2], questions: [ref], left_text: `${header(1, 1, true)}\nAn original passage with every sentence preserved.\nOne\nTwo\nThree\nFour\nFive`, right_text: '[정답]②', translation: '원문 해석도 빠짐없이 그대로 옮깁니다.', visual_required: false }
const extraction: BookExtraction = { passage: 'An original passage with every sentence preserved.', translation: unit.translation, vocabulary: 'original 원래의',
  questions: [{ key: ref.key, question_type: 'topic', stem: '주제로 적절한 것은?', choices: ['One', 'Two', 'Three', 'Four', 'Five'], answer: 2, intent: '출제 소재', solution: '원문 해설' }] }

describe('independent source validation and publication gates', () => {
  it('checks source solution text even when its heading is absent or spaced', () => {
    const source = { ...unit, right_text: '[정답 ]②\n인쇄된 원문 풀이입니다.\n[어휘 ]original 원래의' }
    const value = { ...extraction, questions: [{ ...extraction.questions[0], solution:'인쇄된 원문 풀이입니다.' }] }
    expect(validateBookUnit(source, value, true).errors.filter(e=>e.includes('원문 해설'))).toEqual([])
    const wrong = { ...value, questions: [{ ...value.questions[0], solution:'다른 문제 풀이' }] }
    expect(validateBookUnit(source, wrong, true).errors.join(' ')).toContain('원문 해설')
    const translationOnly = { ...source, right_text:'[정답 ]②\n[해석 ]원문 해석입니다.' }
    expect(validateBookUnit(translationOnly, value, true).errors.some(e=>e.includes('원문 해설'))).toBe(false)
  })
  it('recognizes all five explicit letter choices without manufacturing missing options', () => {
    const marked = { ...unit, left_text: `${header(1, 1, true)}\n발문\n① (a)\n② (b)\n③ (c)\n④ (d)\n⑤ (e)` }
    expect(nativeBookLetterChoices(marked, ref.key)).toEqual(['① (a)', '② (b)', '③ (c)', '④ (d)', '⑤ (e)'])
    expect(nativeBookLetterChoices({ ...marked, left_text: marked.left_text.replace('④ (d)', '④ 다른 선지') }, ref.key)).toBeNull()
    expect(nativeBookLetterChoices({ ...marked, left_text: 'Some ① (a) inline ② (b) markers ③ (c) are ④ (d) not options ⑤ (e).' }, ref.key)).toBeNull()
  })
  it('does not replace independent AI verification with a clean native check', () => {
    const validation = validateBookUnit(unit, extraction)
    expect(validation.errors).toEqual([])
    expect(validation.english_coverage).toBe(1)
    expect(bookPublishReady([{ extraction, validation, version: 1, verified_version: null, verification: {status: 'pending'} }], 1, true)).toBe(false)
  })
  it('blocks plausible wrong answers, duplicate/missing question keys and missing choices', () => {
    const wrong = { ...extraction, questions: [{ ...extraction.questions[0], answer: 3, choices: ['a'] }] }
    expect(validateBookUnit(unit, wrong).errors.join(' ')).toContain('정답')
    expect(validateBookUnit(unit, wrong).errors.join(' ')).toContain('선지')
    expect(validateBookUnit(unit, { ...extraction, questions: [...extraction.questions, ...extraction.questions] }).errors.join(' ')).toContain('목록')
    expect(validateBookUnit(unit, { ...extraction, questions: [{ ...extraction.questions[0], key: 'wrong' }] }).errors.join(' ')).toContain('목록')
  })
  it('catches a short missing ending despite high overall recall', () => {
    const prefix = Array.from({ length: 150 }, () => 'The original sentence is intact and complete.').join('\n')
    const ending = 'A final sentence must never silently disappear.'
    const source = { ...unit, left_text: `${prefix}\n${ending}` }
    const result = validateBookUnit(source, { ...extraction, passage: prefix })
    expect(result.english_coverage).toBeGreaterThan(0.99)
    expect(result.errors.join(' ')).toContain('문장 일부')
  })
  it('blocks truncated translation and absent explanations', () => {
    const result = validateBookUnit(unit, { ...extraction, translation: '원문', questions: [{ ...extraction.questions[0], solution: '' }] })
    expect(result.errors.join(' ')).toContain('해석')
    expect(result.errors.join(' ')).toContain('해설')
    expect(validateBookUnit({ ...unit, translation: '원문' }, { ...extraction, translation: '' }).errors.join(' ')).toContain('해석')
  })
  it('checks original explanations, vocabulary and topic rather than accepting nonempty fabricated text', () => {
    const full = { ...unit, right_text: `[정답]②\n[소재]${extraction.questions[0].intent}\n[해석]${unit.translation}\n[해설]${extraction.questions[0].solution}\n[어휘]${extraction.vocabulary}` }
    expect(validateBookUnit(full, extraction).errors).toEqual([])
    const fabricated = { ...extraction, vocabulary: '', questions: [{ ...extraction.questions[0], solution: '새로 만든 설명', intent: '다른 소재' }] }
    const errors = validateBookUnit(full, fabricated).errors.join(' ')
    expect(errors).toContain('해설의 원문')
    expect(errors).toContain('어휘의 원문')
    expect(errors).toContain('소재의 원문')
  })
  it('flags shared passages, continuation pages and charts for source review', () => {
    const result = validateBookUnit({ ...unit, visual_required: true, pages: [2, 3], questions: [ref, { ...ref, key: '2' }] }, extraction)
    expect(result.warnings.join(' ')).toContain('도표')
    expect(result.warnings.join(' ')).toContain('연결 페이지')
    expect(result.warnings.join(' ')).toContain('지문을 공유')
  })
  it('rejects malformed AI JSON and requires latest reviews, metadata and all units', () => {
    expect(validateBookUnit(unit, {}).errors.length).toBeGreaterThan(0)
    const draft = { extraction, validation: validateBookUnit(unit, extraction), version: 2, verified_version: 2, verification: {status: 'passed'} }
    expect(bookPublishReady([draft], 1, true)).toBe(true)
    expect(bookPublishReady([draft], 2, true)).toBe(false)
    expect(bookPublishReady([draft], 1, false)).toBe(false)
    expect(bookPublishReady([{ ...draft, verified_version: 1 }], 1, true)).toBe(false)
    expect(bookPublishReady([{ ...draft, validation: { ...draft.validation, errors: ['누락'] } }], 1, true)).toBe(false)
    expect(bookPublishReady([], 0, true)).toBe(false)
  })
  it('uses original textbook labels in copies and preserves past exam headers', () => {
    expect(questionSourceLabel({ question_number: 119, source_label: '20강 3번', exam_bank: { title: '교재', exam_year: null, exam_month: null, grade: null, source: '교재' } })).toBe('교재 · 20강 3번')
    expect(questionSourceLabel({ question_number: 18, exam_bank: { title: '기출', exam_year: 2025, exam_month: 6, grade: 3, source: '평가원' } })).toBe('2025년 6월 고3 평가원 18번')
  })
})
