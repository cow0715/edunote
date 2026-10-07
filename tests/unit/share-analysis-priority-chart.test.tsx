// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { AnalysisPriorityChart } from '@/app/share/[token]/analysis-priority-chart'
import { buildShareAnalysis } from '@/lib/share-analysis'
import { analysisAnswer, analysisTag, analysisWeek, manyTypesFixture } from '../fixtures/share-analysis'

afterEach(cleanup)

describe('분석의 복습 유형 비교', () => {
  it('기간 누적 수치와 오답 반복 근거를 보여주고 해당 유형의 오답을 연다', () => {
    const { priorities } = buildShareAnalysis(manyTypesFixture.studentAnswers, manyTypesFixture.weeks)
    const onTagClick = vi.fn()
    render(<AnalysisPriorityChart types={priorities} onTagClick={onTagClick} />)
    const comparison = screen.getByRole('list', { name: '먼저 확인할 유형의 기간 오답률 비교' })
    expect(within(comparison).getAllByRole('listitem')).toHaveLength(3)
    const first = priorities[0]
    const row = within(comparison).getAllByRole('listitem')[0]
    const wrongRate = Math.round(first.cumulative.wrong / first.cumulative.total * 100)
    expect(within(row).getByText(`${wrongRate}%`)).toBeTruthy()
    expect(within(row).getByText(`${first.total}문항 중 오답 ${first.wrong}`)).toBeTruthy()
    expect(within(row).getByText(`${first.wrongAppearances}회에서 오답 반복`)).toBeTruthy()
    const action = within(row).getByRole('button', { name: `${first.name} 오답 ${first.wrong}문항 보기` })
    const description = action.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)!.textContent).join(' ')
    expect(description).toContain(`기간 오답률 ${wrongRate}%`)
    expect(description).toContain(`${first.total}문항 중 오답 ${first.wrong}`)
    expect(description).toContain(`${first.wrongAppearances}회에서 오답 반복`)
    fireEvent.click(action)
    expect(onTagClick).toHaveBeenCalledWith(first.id, first.name)
  })

  it('많은 유형을 넘겨도 추천 순서와 최대 세 유형을 유지한다', () => {
    const { types } = buildShareAnalysis(manyTypesFixture.studentAnswers, manyTypesFixture.weeks)
    render(<AnalysisPriorityChart types={types} onTagClick={vi.fn()} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    types.slice(0, 3).forEach((type, index) => expect(within(rows[index]).getByText(type.name)).toBeTruthy())
    expect(screen.queryByText(types[3].name)).toBeNull()
  })

  it('긴 유형 이름을 잘라 숨기지 않고 실제 이름으로 오답을 열 수 있다', () => {
    const name = '맥락에 따른 문장 연결과 아주 긴 빈칸 추론 유형 이름'
    const weeks = [analysisWeek('one')]
    const { types } = buildShareAnalysis([analysisAnswer('one', 'one', false, [{ ...analysisTag, name }])], weeks)
    const onTagClick = vi.fn()
    render(<AnalysisPriorityChart types={types} onTagClick={onTagClick} />)
    expect(screen.getByText(name).className).not.toContain('truncate')
    fireEvent.click(screen.getByRole('button', { name: `${name} 오답 1문항 보기` }))
    expect(onTagClick).toHaveBeenCalledWith(analysisTag.id, name)
    expect(screen.getByText('판정 보류')).toBeTruthy()
    expect(screen.queryByText(/반복/)).toBeNull()
  })

  it('누적은 안정적이지만 최근 충분한 기록이 낮으면 최근 결과 확인을 함께 보여준다', () => {
    const weeks = Array.from({ length: 12 }, (_, index) => analysisWeek(`w${index}`, index + 1))
    const answers = weeks.flatMap((week, index) => Array.from({ length: index < 8 ? 10 : 4 }, (_, question) =>
      analysisAnswer(`${week.id}-${question}`, week.id, index < 8 || question === 0)))
    const { priorities } = buildShareAnalysis(answers, weeks)
    render(<AnalysisPriorityChart types={priorities} onTagClick={vi.fn()} />)
    expect(screen.getByText('13%')).toBeTruthy()
    expect(screen.getByText('최근 4회 정답률 25% · 최근 결과 확인')).toBeTruthy()
    expect(screen.getByText('96문항 중 오답 12')).toBeTruthy()
  })

  it('기간 오답이 없으면 오답 이동을 만들지 않고 0% 실제 오답률을 유지한다', () => {
    const weeks = [analysisWeek('one'), analysisWeek('two', 2), analysisWeek('three', 3)]
    const answers = weeks.flatMap((week) => Array.from({ length: 4 }, (_, index) => analysisAnswer(`${week.id}-${index}`, week.id, true)))
    const { types } = buildShareAnalysis(answers, weeks)
    render(<AnalysisPriorityChart types={types} onTagClick={vi.fn()} />)
    expect(screen.getByText('0%')).toBeTruthy()
    expect(screen.getByText('12문항 중 오답 0')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText('오답 보기')).toBeNull()
  })

  it('유형이 없으면 빈 비교 그래프를 렌더링하지 않는다', () => {
    const { container } = render(<AnalysisPriorityChart types={[]} onTagClick={vi.fn()} />)
    expect(container.childElementCount).toBe(0)
  })
})
