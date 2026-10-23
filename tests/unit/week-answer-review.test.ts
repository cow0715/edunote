import { sanitizeWeekExtraction } from '@/lib/week-extraction-shape'
import { describe, expect, it } from 'vitest'
import { prepareAnswerReview, resolveAnswerReview, verifyAnswerEvidence, type ReviewAnswer, type ReviewSource } from '@/lib/week-answer-review'

const sources: ReviewSource[] = [{ role: 'questions', fileName: '문제.pdf', bucket: 'pdf-import-sources', path: 't/q.pdf', pageCount: 1, sha256: 'hash' },
  { role: 'answers', fileName: '해설.pdf', bucket: 'pdf-import-sources', path: 't/a.pdf', pageCount: 1, sha256: 'hash2' }]
const answer = (over: Partial<ReviewAnswer> = {}): ReviewAnswer => ({ question_number: 1, sub_label: null, question_style: 'objective',
  correct_answer: 4, correct_answer_text: null, question_type: null, grading_criteria: null, explanation: '원문 해설', question_text: '문제',
  source_section: 'general', source_question_number: 1, answer_status: 'found',
  answer_evidence: { file_index: 2, page: 1, quote: '1번 정답 ④' }, evidence_verified: true, review_reasons: [], ...over })

describe('answer grounding and teacher review', () => {
  it('validates model structure before normalization instead of crashing on object-valued passages', () => {
    const q = sanitizeWeekExtraction({ ...answer(), shared_passage: { text: '변형된 객체' }, question_stem: ['잘못된 배열'] })
    expect(q.shared_passage).toBeNull()
    expect(q.question_stem).toBeNull()
    expect(q.extraction_issues).toHaveLength(2)
    expect(() => sanitizeWeekExtraction({ ...answer(), question_number: '1' })).toThrow('문항 번호')
  })
  it('checks the nominated file, page and literal quote, including separate answer documents', () => {
    const pages = ['문제 1. ① A ② B ③ C ④ D', '정답 및 해설\n1번 정답 ④'].map(t => [t])
    expect(verifyAnswerEvidence(answer(), pages, sources)).toBe(true)
    expect(verifyAnswerEvidence(answer({ correct_answer: 1, answer_evidence: { file_index: 2, page: 1, quote: '1번 정답 ④' } }), pages, sources)).toBe(false)
    expect(verifyAnswerEvidence(answer({ answer_evidence: { file_index: 2, page: 2, quote: '1번 정답 ④' } }), pages, sources)).toBe(false)
    expect(verifyAnswerEvidence(answer({ answer_evidence: { file_index: 1, page: 1, quote: '④ D' } }), pages, sources)).toBe(false)
    expect(verifyAnswerEvidence(answer({ answer_evidence: { file_index: 2, page: 1, quote: '1번 정답 ②' }, correct_answer: 2 }), pages, sources)).toBe(false)
  })
  it('recognizes explicit explanation markers while refusing a cover that only points to another answer document', () => {
    const q = answer({ correct_answer: 5, answer_evidence: { file_index: 1, page: 1, quote: '1. 제목 ⑤' } })
    expect(verifyAnswerEvidence(q, [['1. 제목 ⑤\n{해석} 원문 번역\n{해설} 원문 해설']], [{ role: 'combined' }])).toBe(true)
    expect(verifyAnswerEvidence(answer({ answer_evidence: { file_index: 1, page: 1, quote: '④ D' } }), [['정답·해설은 해설지\n문제 1. ① A ② B ③ C ④ D']], [{ role: 'combined' }])).toBe(false)
  })
  it('recognizes a literal question-to-answer summary table without requiring a particular vendor heading', () => {
    const q = answer({ question_number: 18, source_question_number: 18, correct_answer: 5, answer_evidence: { file_index: 1, page: 1, quote: '번18 : ⑤' } })
    expect(verifyAnswerEvidence(q, [['번18 : ⑤\n번19 : ①\n번20 : ②']], [{ role: 'combined' }])).toBe(true)
    expect(verifyAnswerEvidence(q, [['번18 : ⑤']], [{ role: 'combined' }])).toBe(false)
  })
  it('removes inferred answers AND generated solutions instead of passing them to grading', () => {
    const [q] = prepareAnswerReview([answer({ answer_status: 'missing', explanation: '그럴듯한 새 풀이' })], [['문제']], sources)
    expect(q.correct_answer).toBe(0)
    expect(q.correct_answer_text).toBeNull()
    expect(q.explanation).toBeNull()
    expect(q.evidence_verified).toBe(false)
    expect(() => resolveAnswerReview({ answers: [q], base_questions: [] }, [{ index: 0, reviewed: true, correct_answer: 4 }])).toThrow('직접 확인')
    expect(resolveAnswerReview({ answers: [q], base_questions: [] }, [{ index: 0, reviewed: true, manual: true, correct_answer: 4 }])[0].answer_origin).toBe('teacher')
  })
  it('keeps sparse find-error labels and matches correction evidence instead of flattening the type', () => {
    const q = answer({ sub_label: 'b', question_style: 'find_error', correct_answer: 0, correct_answer_text: 'b:struggle',
      answer_evidence: { file_index: 2, page: 1, quote: '2번 정답 ② struggle' } })
    expect(prepareAnswerReview([q], [[], ['2번 정답 ② struggle']], sources)[0]).toMatchObject({ sub_label: 'b', question_style: 'find_error', correct_answer_text: 'b:struggle', evidence_verified: true })
  })
  it('requires the selected symbols as well as the correction and rejects incomplete multi-select keys', () => {
    const q = answer({ question_style: 'find_error', sub_label: 'b', correct_answer: 0, correct_answer_text: 'b:struggle', answer_evidence: { file_index: 2, page: 1, quote: '2. ③ struggle' } })
    expect(verifyAnswerEvidence(q, [[], ['2. ③ struggle']], sources)).toBe(false)
    const multi = answer({ question_style: 'multi_select', correct_answer: 0, correct_answer_text: '1,3', answer_evidence: { file_index: 2, page: 1, quote: '1. 정답 ①③④' } })
    expect(verifyAnswerEvidence(multi, [[], ['1. 정답 ①③④']], sources)).toBe(false)
    expect(verifyAnswerEvidence({ ...multi, correct_answer_text: '1,3,4' }, [[], ['1. 정답 ①③④']], sources)).toBe(true)
  })
  it('does not allow a reviewed reparse to replace any existing key or drop a sibling', () => {
    const existing = { ...answer(), id: 'original', correct_answer: 3 }
    const draft = { answers: [answer()], base_questions: [existing] }
    expect(() => resolveAnswerReview(draft, [{ index: 0, reviewed: true }])).toThrow('기존 정답')
    expect(resolveAnswerReview(draft, [{ index: 0, reviewed: true, keep_existing: true }])[0]).toMatchObject({ correct_answer: 3, answer_origin: 'existing' })
    expect(() => resolveAnswerReview({ ...draft, base_questions: [existing, { ...existing, id: 'sibling', sub_label: 'b' }] }, [{ index: 0, reviewed: true, keep_existing: true }])).toThrow('문항 구성')
  })
  it('retains a legacy null numeric column on subjective keys without rewriting it to zero', () => {
    const q = answer({ question_style: 'subjective', correct_answer: 0, correct_answer_text: 'made' })
    const result = resolveAnswerReview({ answers: [q], base_questions: [{ ...q, id: 'legacy', correct_answer: null }] }, [{ index: 0, reviewed: true }])
    expect(result[0]).toMatchObject({ correct_answer: null, correct_answer_text: 'made', answer_origin: 'existing' })
  })
  it('rejects skipped reviews, duplicates and edits disguised as source evidence', () => {
    const draft = { answers: [answer()], base_questions: [] }
    expect(() => resolveAnswerReview(draft, [])).toThrow('모든 문항')
    expect(() => resolveAnswerReview(draft, [{ index: 0, reviewed: true, correct_answer: 2 }])).toThrow('직접 검토')
    expect(() => resolveAnswerReview({ answers: [answer(), answer()], base_questions: [] }, [{ index: 0, reviewed: true }, { index: 1, reviewed: true }])).toThrow('중복')
  })
})
