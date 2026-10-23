// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AnswerReviewPanel } from '@/components/grade/answer-review-panel'
import type { AnswerDraft } from '@/lib/week-answer-review'

afterEach(cleanup)
const draft: AnswerDraft = { id: 'draft', status: 'review', created_at: '2026-10-23', base_questions: [], sources: [
  { role: 'questions', fileName: '시험.pdf', bucket: 'pdf-import-sources', path: 't/q', pageCount: 5, sha256: 'q' },
  { role: 'answers', fileName: '정답.pdf', bucket: 'pdf-import-sources', path: 't/a', pageCount: 2, sha256: 'a' }], answers: [
  { question_number: 1, sub_label: null, question_style: 'objective', correct_answer: 0, correct_answer_text: null,
    question_type: null, grading_criteria: null, explanation: null, question_text: '문제', evidence_verified: false, review_reasons: ['근거 없음'] }] }

describe('answer draft review UI', () => {
  it('keeps both original documents and requires a real answer plus teacher acknowledgement before confirmation', () => {
    const confirm = vi.fn()
    render(<AnswerReviewPanel draft={draft} weekId="week" onConfirm={confirm} saving={false} />)
    expect(screen.getByRole('link', { name: /문제지: 시험.pdf/ }).getAttribute('href')).toContain('source=0')
    expect(screen.getByRole('link', { name: /정답·해설지: 정답.pdf/ }).getAttribute('href')).toContain('source=1')
    fireEvent.click(screen.getByLabelText('전체 정답표와 원문을 확인했습니다'))
    const button = screen.getByRole('button', { name: '검토 완료하고 채점에 사용' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('1번 정답'), { target: { value: '4' } })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(confirm).toHaveBeenCalledWith([expect.objectContaining({ correct_answer: 4, manual: true, reviewed: true })])
  })
  it('offers retaining an existing key rather than silently applying the newly inferred value', () => {
    const confirm = vi.fn()
    const existing = { ...draft.answers[0], id: 'existing', correct_answer: 3 }
    render(<AnswerReviewPanel draft={{ ...draft, base_questions: [existing] }} weekId="week" onConfirm={confirm} saving={false} />)
    fireEvent.click(screen.getByLabelText('기존 정답 유지'))
    fireEvent.click(screen.getByLabelText('전체 정답표와 원문을 확인했습니다'))
    fireEvent.click(screen.getByRole('button', { name: '기존 정답을 보존하여 확정' }))
    expect(confirm).toHaveBeenCalledWith([expect.objectContaining({ keep_existing: true })])
  })
  it('prioritizes unresolved rows without dropping edits and opens the matching source page', () => {
    const grounded = { ...draft.answers[0], question_number: 2, correct_answer: 3, evidence_verified: true,
      answer_evidence: { file_index: 2, page: 2, quote: '2. ③' } }
    render(<AnswerReviewPanel draft={{ ...draft, answers: [...draft.answers, grounded] }} weekId="week" onConfirm={vi.fn()} saving={false} />)
    expect(screen.queryByLabelText('2번 정답')).toBeNull()
    fireEvent.change(screen.getByLabelText('1번 정답'), { target: { value: '4' } })
    expect((screen.getByLabelText('1번 정답') as HTMLInputElement).value).toBe('4')
    fireEvent.click(screen.getByRole('button', { name: '전체 문항' }))
    expect(screen.getByLabelText('2번 정답')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '2번 원문 보기' }))
    expect(screen.getByTitle('선택한 PDF 원문').getAttribute('src')).toContain('source=1&page=2')
    fireEvent.click(screen.getByRole('button', { name: '이전 쪽' }))
    expect(screen.getByTitle('선택한 PDF 원문').getAttribute('src')).toContain('source=1&page=1')
    fireEvent.click(screen.getByRole('button', { name: '확인 필요한 문항' }))
    expect((screen.getByLabelText('1번 정답') as HTMLInputElement).value).toBe('4')
  })

  it('shows a recoverable page failure while preserving answer edits', () => {
    render(<AnswerReviewPanel draft={draft} weekId="week" onConfirm={vi.fn()} saving={false} />)
    fireEvent.change(screen.getByLabelText('1번 정답'), { target: { value: '3' } })
    fireEvent.error(screen.getByTitle('선택한 PDF 원문'))
    expect(screen.getByRole('alert').textContent).toContain('원문 페이지를 표시하지 못했습니다')
    fireEvent.click(screen.getByRole('button', { name: '페이지 다시 불러오기' }))
    expect(screen.getByTitle('선택한 PDF 원문').getAttribute('src')).toContain('attempt=1')
    expect((screen.getByLabelText('1번 정답') as HTMLInputElement).value).toBe('3')
  })

})

