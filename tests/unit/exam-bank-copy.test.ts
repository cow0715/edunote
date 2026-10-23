// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildExplanationCopyHtml, buildExplanationCopyText, buildQuestionCopyHtml, buildQuestionCopyText } from '@/lib/exam-bank-copy'

const original = Object.freeze({
  question_text: '다음 글의 목적으로 가장 적절한 것은?',
  passage: 'Dear students,\nThe school decided to offer\nmore activities with **<u>clear goals</u>**.\n\n(A) Another paragraph.\n* semester: 학기',
  choices: Object.freeze(['① First option with\nmore detail', '② 둘째 선지', '③ Third', '④ Fourth', '⑤ Fifth']),
  answer: '②', choice_rates: Object.freeze([0, 98, 1, 0, 1]),
  explanation_intent: '글의 목적', explanation_translation: '더 다양한 동아리에 대\n한 요청이 있었습니다.\n\n둘째 문단입니다.',
  explanation_solution: 'The key evidence appears\nin <u>this sentence</u>.\n\n**Keep this paragraph.**',
  explanation_vocabulary: 'expand 확대하다\nopportunity 기회',
})

describe('shared question bank copy for every material source', () => {
  it.each(['2027학년도 수능특강 영어 · 상', '2026년 9월 고3 모의고사', '2025년 11월 수능'])('reflows question and explanation for %s without changing the input', (label) => {
    const before = JSON.stringify(original)
    const plain = buildQuestionCopyText(original, label), html = buildQuestionCopyHtml(original, label)
    expect(plain).toContain('offer more activities')
    expect(plain).toContain('① First option with more detail\n② 둘째 선지')
    expect(plain).toContain('(A) Another paragraph.\n* semester: 학기')
    expect(plain).toContain('정답: ②')
    expect(plain).toContain('선택률: ① 0%   ② 98%   ③ 1%   ④ 0%   ⑤ 1%')
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelector('strong u')?.textContent).toBe('clear goals')
    expect([...document.querySelectorAll('p')].some((p) => p.textContent === '① First option with more detail')).toBe(true)
    expect([...document.querySelectorAll('p')].some((p) => p.textContent === '② 둘째 선지')).toBe(true)
    expect(buildExplanationCopyText(original, label)).toContain('대\n한 요청')
    expect(buildExplanationCopyText(original, label)).toContain('appears in this sentence.')
    expect(buildExplanationCopyText(original, label)).toContain('expand 확대하다\nopportunity 기회')
    expect(buildExplanationCopyHtml(original, label)).toContain('<u>this sentence</u>')
    expect(buildExplanationCopyHtml(original, label)).toContain('<strong>Keep this paragraph.</strong>')
    expect(JSON.stringify(original)).toBe(before)
  })
  it('handles missing fields and treats source labels and unknown explanation HTML as text', () => {
    expect(buildQuestionCopyText({ question_text: '서답형', passage: null, choices: [], answer: null }, '출처')).toBe('[출처]\n\n서답형')
    expect(buildExplanationCopyText({}, '출처')).toBe('[출처 해설]')
    const html = buildExplanationCopyHtml({ explanation_solution: '<script>alert(1)</script>' }, '<img src=x>')
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelector('script, img')).toBeNull()
    expect(document.body.textContent).toContain('<script>alert(1)</script>')
  })
})
