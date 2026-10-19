// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { AnalysisTrendChart } from '@/app/share/[token]/analysis-trend-chart'
import { buildShareAnalysis } from '@/lib/share-analysis'
import { analysisAnswer, analysisFixture, analysisTag, analysisWeek, insightFixture } from '../fixtures/share-analysis'

afterEach(cleanup)

function chartData(correct: number[], total: number | number[] = 4) {
  const weeks = correct.map((_, index) => analysisWeek(`w${index + 1}`, index + 1, `2026-09-${String(index + 1).padStart(2, '0')}`))
  const answers = weeks.flatMap((week, index) => Array.from({ length: Array.isArray(total) ? total[index] : total }, (_, question) =>
    analysisAnswer(`${week.id}-${question}`, week.id, question < correct[index])))
  return { weeks, types: buildShareAnalysis(answers, weeks).types }
}

describe('분석의 유형별 정답률 그래프', () => {
  it('유형 선택에 따라 실제 흐름과 해당 오답 이동을 바꾼다', () => {
    const types = buildShareAnalysis(insightFixture.studentAnswers, insightFixture.weeks).types
    const onTagClick = vi.fn()
    render(<AnalysisTrendChart types={types} weeks={insightFixture.weeks} onTagClick={onTagClick} improvementId="claim" strengthId="content" />)
    expect(screen.getByRole('img', { name: '빈칸 추론 정답률, 출제 회차 순: 80% → 60% → 40% → 20%' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '빈칸 추론 오답 10문항 보기' }))
    fireEvent.click(screen.getByRole('button', { name: '주장', pressed: false }))
    expect(screen.getByRole('img', { name: '주장 정답률, 출제 회차 순: 25% → 25% → 75% → 100%' })).toBeTruthy()
    expect(screen.getByText('최근에 나아진 유형')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '주장 오답 7문항 보기' }))
    expect(onTagClick.mock.calls).toEqual([['blank', '빈칸 추론'], ['claim', '주장']])
    fireEvent.click(screen.getByRole('button', { name: '내용 일치' }))
    expect(screen.getByText('잘 풀고 있는 유형')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /오답 .*문항 보기/ })).toBeNull()
  })

  it('기간 변경으로 선택한 유형이 사라지면 새 기간의 첫 유형과 실제 수치로 돌아간다', () => {
    const first = buildShareAnalysis(analysisFixture.studentAnswers, analysisFixture.weeks).types
    const { rerender } = render(<AnalysisTrendChart types={first} weeks={analysisFixture.weeks} onTagClick={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '주장' }))
    const next = chartData([3, 4])
    rerender(<AnalysisTrendChart {...next} onTagClick={vi.fn()} />)
    expect(screen.getByRole('button', { name: '빈칸 추론', pressed: true })).toBeTruthy()
    expect(screen.getByRole('img', { name: '빈칸 추론 정답률, 출제 회차 순: 75% → 100%' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '주장' })).toBeNull()
    rerender(<AnalysisTrendChart types={[]} weeks={[]} onTagClick={vi.fn()} />)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('한 회차는 실제 점 하나만 보여주고 변화를 단정하지 않는다', () => {
    const data = chartData([0], 1)
    render(<AnalysisTrendChart {...data} onTagClick={vi.fn()} />)
    expect(screen.getByRole('img', { name: '빈칸 추론 정답률, 출제 회차 순: 0%' })).toBeTruthy()
    const details = screen.getByText('회차별 수치 보기').closest('details')!
    expect(within(details).getAllByRole('listitem')).toHaveLength(1)
    expect(within(details).getByText('0/1문항 정답 · 0%')).toBeTruthy()
    expect(screen.getByText('최근 1회 합산 정답률')).toBeTruthy()
    expect(screen.getByText('변화 비교는 최근·직전 묶음이 각각 3회·10문항 이상일 때 보여드려요.')).toBeTruthy()
    expect(screen.queryByText(/직전 .*회 대비/)).toBeNull()
  })

  it.each([{ correct: [0, 0, 0], rate: 0 }, { correct: [4, 4, 4], rate: 100 }])('모두 $rate%여도 고정 0–100 축과 실제 회차별 수치를 유지한다', ({ correct, rate }) => {
    render(<AnalysisTrendChart {...chartData(correct)} onTagClick={vi.fn()} />)
    const chart = screen.getByRole('img')
    expect(within(chart).getByText('50%')).toBeTruthy()
    expect(within(chart).getAllByText('100%').length).toBeGreaterThan(0)
    expect(within(chart).getAllByText('0%').length).toBeGreaterThan(0)
    expect(chart.getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('img', { name: `빈칸 추론 정답률, 출제 회차 순: ${rate}% → ${rate}% → ${rate}%` })).toBeTruthy()
    const details = screen.getByText('회차별 수치 보기').closest('details')!
    expect(within(details).getAllByText(`${rate === 100 ? 4 : 0}/4문항 정답 · ${rate}%`)).toHaveLength(3)
    if (rate === 100) expect(screen.getByText('안정적')).toBeTruthy()
  })

  it('미출제 회차를 0%로 만들지 않고 실제 두 출제 사이를 같은 간격으로 연결한다', () => {
    const weeks = [analysisWeek('first', 1), analysisWeek('missing', 2), analysisWeek('last', 3)]
    const types = buildShareAnalysis([analysisAnswer('wrong', 'first', false), analysisAnswer('correct', 'last', true)], weeks).types
    render(<AnalysisTrendChart types={types} weeks={weeks} onTagClick={vi.fn()} />)
    expect(screen.getByRole('img', { name: '빈칸 추론 정답률, 출제 회차 순: 0% → 100%' })).toBeTruthy()
    expect(screen.getByText('회차별 정답률 · 2회 출제')).toBeTruthy()
    const details = screen.getByText('회차별 수치 보기').closest('details')!
    expect(within(details).getAllByRole('listitem')).toHaveLength(2)
    expect(within(details).queryByText('2주차')).toBeNull()
    expect(within(details).getByText('1주차')).toBeTruthy()
    expect(within(details).getByText('3주차')).toBeTruthy()
    expect(screen.getByText('변화 비교는 최근·직전 묶음이 각각 3회·10문항 이상일 때 보여드려요.')).toBeTruthy()
  })

  it('그래프는 최근 여섯 실제 출제만 보여주고 전체 회차 수치를 펼침에서 보존한다', () => {
    const data = chartData([0, 1, 2, 3, 4, 3, 2, 1])
    render(<AnalysisTrendChart {...data} onTagClick={vi.fn()} />)
    expect(screen.getByText('회차별 정답률 · 최근 6회 출제 · 전체 8회')).toBeTruthy()
    expect(screen.getByRole('img', { name: '빈칸 추론 정답률, 최근 6회 출제 회차 순: 50% → 75% → 100% → 75% → 50% → 25%' })).toBeTruthy()
    const details = screen.getByText('회차별 수치 보기').closest('details')!
    expect(within(details).getAllByRole('listitem')).toHaveLength(8)
    expect(within(details).getByText('1주차 · 9/1')).toBeTruthy()
    expect(within(details).getByText('8주차 · 9/8')).toBeTruthy()
    expect(within(details).getByText('0/4문항 정답 · 0%')).toBeTruthy()
  })

  it('최근 네 회차의 실제 문항 수로 합산하고 직전 네 회차와 비교하며 그래프 끝점 변화와 구분한다', () => {
    const data = chartData([1, 1, 1, 1, 0, 1, 2, 3], [4, 4, 4, 4, 1, 2, 3, 4])
    render(<AnalysisTrendChart {...data} onTagClick={vi.fn()} />)
    const summaryLabel = screen.getByText('최근 4회 합산 정답률')
    expect(summaryLabel).toBeTruthy()
    expect(screen.getByText('60%')).toBeTruthy()
    expect(screen.getByText(/6\/10문항 정답/)).toBeTruthy()
    expect(screen.getByText('직전 4회 대비 +35%p')).toBeTruthy()
    const summary = summaryLabel.parentElement!.parentElement!
    expect(within(summary).getByText('60%')).toBeTruthy()
    expect(within(summary).getByText('6/10문항 정답')).toBeTruthy()
    expect(within(summary).getByText('직전 4회 대비 +35%p')).toBeTruthy()
    expect(summary.compareDocumentPosition(screen.getByRole('img')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('직전 4회 대비 +8%p')).toBeNull()
    expect(screen.getByRole('img', { name: '빈칸 추론 정답률, 최근 6회 출제 회차 순: 25% → 25% → 0% → 50% → 67% → 75%' })).toBeTruthy()
    expect(screen.getByText('출제 수가 적은 회차가 있어 변화는 참고로 봐주세요.')).toBeTruthy()
    expect(screen.getByText('유형 분류 · 선택 기간 누적 기준')).toBeTruthy()
  })

  it('최근 네 회차만 요약하고 두 회차뿐인 이전 기록으로는 변화를 단정하지 않는다', () => {
    render(<AnalysisTrendChart {...chartData([0, 0, 1, 2, 3, 4])} onTagClick={vi.fn()} />)
    expect(screen.getByText('최근 4회 합산 정답률')).toBeTruthy()
    expect(screen.getByText('10/16문항 정답')).toBeTruthy()
    expect(screen.getByText('63%')).toBeTruthy()
    expect(screen.queryByText(/직전 .*회 대비/)).toBeNull()
    expect(screen.getByText('변화 비교는 최근·직전 묶음이 각각 3회·10문항 이상일 때 보여드려요.')).toBeTruthy()
  })

  it('이전 기록이 세 회차와 열 문항을 충족하면 실제 세 회차 합산과 비교한다', () => {
    render(<AnalysisTrendChart {...chartData([1, 1, 1, 3, 3, 3, 3])} onTagClick={vi.fn()} />)
    expect(screen.getByText('최근 4회 합산 정답률')).toBeTruthy()
    expect(screen.getByText('직전 3회 대비 +50%p')).toBeTruthy()
    expect(screen.getByText('회차마다 출제 수와 난도가 다를 수 있어요.')).toBeTruthy()
  })

  it('두 회차를 모두 맞혀도 누적 판단에 필요한 기록이 부족하면 안정적이라고 분류하지 않는다', () => {
    render(<AnalysisTrendChart {...chartData([4, 4])} onTagClick={vi.fn()} />)
    expect(screen.getByText('최근 2회 합산 정답률')).toBeTruthy()
    expect(screen.getByText('기록 부족')).toBeTruthy()
    expect(screen.queryByText('안정적')).toBeNull()
  })

  it('방향키로 실제 출제 회차의 정답률과 문항 수를 확인할 수 있다', async () => {
    render(<AnalysisTrendChart {...chartData([1, 3, 4])} onTagClick={vi.fn()} />)
    const chart = screen.getByRole('img')
    fireEvent.focus(chart)
    const tooltip = await screen.findByRole('status')
    expect(within(tooltip).getByText('1주차 · 9/1')).toBeTruthy()
    expect(within(tooltip).getByText('25% · 1/4문항 정답')).toBeTruthy()
    fireEvent.keyDown(chart, { key: 'ArrowRight' })
    expect(within(tooltip).getByText('2주차 · 9/2')).toBeTruthy()
    expect(within(tooltip).getByText('75% · 3/4문항 정답')).toBeTruthy()
    fireEvent.keyDown(chart, { key: 'ArrowRight' })
    expect(within(tooltip).getByText('3주차 · 9/3')).toBeTruthy()
    expect(within(tooltip).getByText('100% · 4/4문항 정답')).toBeTruthy()
  })

  it.each([
    { name: '직전 묶음', correct: [0, 0, 0, 0, 4, 4, 4, 4], total: [2, 2, 2, 2, 4, 4, 4, 4] },
    { name: '최근 묶음', correct: [0, 0, 0, 0, 2, 2, 2, 2], total: [4, 4, 4, 4, 2, 2, 2, 2] },
  ])('$name이 네 회차여도 열 문항 미만이면 변화량을 강조하지 않는다', ({ correct, total }) => {
    render(<AnalysisTrendChart {...chartData(correct, total)} onTagClick={vi.fn()} />)
    expect(screen.queryByText(/직전 .*회 대비/)).toBeNull()
    expect(screen.getByText('변화 비교는 최근·직전 묶음이 각각 3회·10문항 이상일 때 보여드려요.')).toBeTruthy()
  })

  it('긴 유형 이름은 선택 버튼에서 한 번 보여주고 그래프와 오답 이동에도 전체 이름을 유지한다', () => {
    const name = '맥락에 따른 문장 연결과 아주 긴 빈칸 추론 유형 이름'
    const weeks = [analysisWeek('one')]
    const types = buildShareAnalysis([analysisAnswer('one', 'one', false, [{ ...analysisTag, name }])], weeks).types
    render(<AnalysisTrendChart types={types} weeks={weeks} onTagClick={vi.fn()} />)
    expect(screen.getByRole('button', { name, pressed: true })).toBeTruthy()
    expect(screen.getByRole('button', { name: `${name} 오답 1문항 보기` })).toBeTruthy()
    expect(screen.getAllByText(name)).toHaveLength(1)
    expect(screen.getByRole('img', { name: `${name} 정답률, 출제 회차 순: 0%` })).toBeTruthy()
  })

  it('유형이 많으면 추천에 포함되지 않은 유형도 하나씩 골라 실제 흐름과 오답을 확인한다', () => {
    const weeks = [analysisWeek('w1', 1), analysisWeek('w2', 2), analysisWeek('w3', 3)]
    const tags = Array.from({ length: 4 }, (_, index) => ({ ...analysisTag, id: `type-${index}`, name: `유형 ${index}` }))
    const answers = tags.flatMap((tag, index) => weeks.flatMap((week) => Array.from({ length: 4 }, (_, question) =>
      analysisAnswer(`${tag.id}-${week.id}-${question}`, week.id, question < index + 1, [tag]))))
    const { types: allTypes } = buildShareAnalysis(answers, weeks)
    const types = [allTypes[0], allTypes[1], allTypes[3]]
    const onTagClick = vi.fn()
    const { rerender } = render(<AnalysisTrendChart types={types} allTypes={allTypes} weeks={weeks} onTagClick={onTagClick} />)
    const selector = screen.getByRole('combobox', { name: '정답률 그래프 유형 선택' })
    expect((selector as HTMLSelectElement).value).toBe(types[0].id)
    expect(within(selector).getAllByRole('option')).toHaveLength(4)
    expect(within(selector).getByRole('group', { name: '우선 보완' })).toBeTruthy()
    expect(within(selector).getByRole('option', { name: '유형 2 · 복습 권장' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '유형 0', pressed: true })).toBeNull()
    fireEvent.change(selector, { target: { value: 'type-2' } })
    expect(screen.getByRole('img', { name: '유형 2 정답률, 출제 회차 순: 75% → 75% → 75%' })).toBeTruthy()
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByText(/9\/12문항 정답/)).toBeTruthy()
    expect(screen.queryByText('복습 권장')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '유형 2 오답 3문항 보기' }))
    expect(onTagClick).toHaveBeenCalledWith('type-2', '유형 2')
    rerender(<AnalysisTrendChart types={types} allTypes={allTypes} weeks={weeks} onTagClick={onTagClick} improvementId="type-2" />)
    expect(screen.getByText('최근에 나아진 유형')).toBeTruthy()
    rerender(<AnalysisTrendChart types={types} allTypes={types} weeks={weeks} onTagClick={onTagClick} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByRole('button', { name: types[0].name, pressed: true })).toBeTruthy()
    expect(screen.getByRole('img', { name: '유형 0 정답률, 출제 회차 순: 25% → 25% → 25%' })).toBeTruthy()
  })
})
