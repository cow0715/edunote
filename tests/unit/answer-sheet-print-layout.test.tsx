// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { AnswerSheetDocument, type PrintQuestion } from '@/app/(admin)/dashboard/[classId]/weeks/[weekId]/answer-sheet/print/answer-sheet-document'

afterEach(cleanup)
const question = (n: number, sub: string | null, order = n): PrintQuestion => ({ question_number: n, sub_label: sub, display_order: order, question_style: 'subjective', correct_answer_text: 'SECRET ANSWER' })

describe('printable diagnostic answer sheet', () => {
  it('prints only each parent’s actual subquestions when two and three part questions are mixed', () => {
    render(<AnswerSheetDocument weekLabel="1주차" questions={[question(1, 'a'), question(1, 'b'), question(2, 'a'), question(2, 'b'), question(2, 'c')]} />)
    const rows = within(screen.getByRole('table')).getAllByRole('row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getAllByText(/^\([abc]\)$/).map(e => e.textContent)).toEqual(['(a)', '(b)'])
    expect(within(rows[1]).getAllByText(/^\([abc]\)$/).map(e => e.textContent)).toEqual(['(a)', '(b)', '(c)'])
    expect(rows.every(row => row.children.length === 2)).toBe(true)
    expect(screen.queryByText('SECRET ANSWER')).toBeNull()
  })
  it('retains PDF order and original written question numbers', () => {
    render(<AnswerSheetDocument weekLabel="1주차" questions={[question(7, null, 8), { ...question(8, 'b', 7), source_section: 'written', source_question_number: 1 }, question(6, null, 6), { ...question(8, 'a', 7), source_section: 'written', source_question_number: 1 }]} />)
    expect(screen.getAllByRole('rowheader').map(e => e.textContent)).toEqual(['6번', '서답형 1', '7번'])
  })
  it('does not reveal find-error symbols or correct answers', () => {
    render(<AnswerSheetDocument weekLabel="1주차" questions={['b', 'd'].map(sub => ({ ...question(1, sub), question_style: 'find_error', question_text: '①~⑤ 중 틀린 것을 모두 찾아 고치시오.' }))} />)
    expect(screen.getAllByText(/번호·기호/)).toHaveLength(5)
    expect(screen.queryByText(/필요한 칸만 작성/)).toBeNull()
    expect(screen.queryByText('(b)')).toBeNull()
    expect(screen.queryByText('(d)')).toBeNull()
    expect(screen.queryByText('SECRET ANSWER')).toBeNull()
  })
})
