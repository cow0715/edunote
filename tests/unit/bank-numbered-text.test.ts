import { describe, expect, it } from 'vitest'
import { bankChoiceText, joinBankNumberedContent } from '@/lib/bank-numbered-text'
import { copyBlockHtml, copyBlockText } from '@/lib/material-copy'
import { readablePassage } from '@/lib/material-display'
import { buildQuestionCopyText, buildQuestionCopyHtml, buildExplanationCopyText, buildExplanationCopyHtml } from '@/lib/exam-bank-copy'

describe('live textbook line-break regressions', () => {
  it('keeps choice numbers and all choice content on a single line', () => {
    expect(bankChoiceText('①\r\n동아리 활동에 대한\n만족도를 조사하려고')).toBe('① 동아리 활동에 대한 만족도를 조사하려고')
  })
  it('joins a circled answer to Korean explanation text, including marked-up numbers', () => {
    expect(copyBlockText('적절한 것은\n②\n이다.')).toBe('적절한 것은\n② 이다.')
    expect(copyBlockHtml('②\n<u>자신감 있는 → 당황한</u>')).toBe('<p>② <u>자신감 있는 → 당황한</u></p>')
    expect(joinBankNumberedContent('<strong>③</strong>\n이유')).toBe('<strong>③</strong> 이유')
    expect(readablePassage('②\n설명')).toBe('② 설명')
  })
  it('preserves real passage paragraphs, bare markers, tables and vocabulary rows', () => {
    const passage = 'First paragraph.\n\nBut many of us still prefer physical files.'
    expect(copyBlockText(passage)).toBe(passage)
    expect(copyBlockHtml(passage)).toBe('<p>First paragraph.</p><p>But many of us still prefer physical files.</p>')
    expect(joinBankNumberedContent('①\n②\n③')).toBe('①\n②\n③')
    expect(copyBlockText('A\t10\nB\t20')).toBe('A\t10\nB\t20')
    expect(copyBlockText('word 뜻\nterm 의미', 'list')).toBe('word 뜻\nterm 의미')
  })
  it('applies the same fix to actual question/explanation clipboard builders without modifying source', () => {
    const q = Object.freeze({ question_text: '목적은?', passage: 'First.\n\nSecond.', choices: ['①\n동아리 활동\n조사', '②\n설명'], answer: '②', explanation_solution: '가장 적절한 것은\n②\n이다.\n\n[AI 보완 풀이]\n근거', explanation_vocabulary: 'word 뜻\nterm 의미' })
    const before = JSON.stringify(q)
    expect(buildQuestionCopyText(q, '교재')).toContain('① 동아리 활동 조사\n② 설명')
    expect(buildQuestionCopyHtml(q, '교재')).toContain('<p>① 동아리 활동 조사</p><p>② 설명</p>')
    expect(buildExplanationCopyText(q, '교재')).toContain('② 이다.')
    expect(buildExplanationCopyHtml(q, '교재')).not.toContain('②<br>')
    expect(buildExplanationCopyText(q, '교재')).toContain('[AI 보완 풀이]')
    expect(JSON.stringify(q)).toBe(before)
  })
})
