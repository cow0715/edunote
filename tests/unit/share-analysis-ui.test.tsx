// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { AnalysisTab } from '@/app/share/[token]/tabs/analysis-tab'
import { useShareModel } from '@/app/share/[token]/use-share-model'
import type { ShareData } from '@/app/share/[token]/share-types'
import { analysisAnswer, analysisData, analysisFixture, analysisTag, analysisWeek, insightFixture, manyTypesFixture } from '../fixtures/share-analysis'

afterEach(cleanup)

function Subject({ data, onTagClick = vi.fn(), onOpenWrongNote = vi.fn() }: {
  data: ShareData; onTagClick?: (id: string, name: string) => void; onOpenWrongNote?: () => void
}) {
  const model = useShareModel(data)
  return <AnalysisTab model={model} periodLabel="9월" onTagClick={onTagClick} onOpenWrongNote={onOpenWrongNote} />
}

function disclosure(title: string) {
  return screen.getByText(title).closest('details') as HTMLDetailsElement
}

function openDisclosure(title: string) {
  const details = disclosure(title)
  fireEvent.click(within(details).getByText(title))
  expect(details.open).toBe(true)
  return details
}

function openTypeList() {
  const overview = screen.getByRole('region', { name: '전체 유형 분석' })
  fireEvent.click(within(overview).getByRole('button', { name: '전체 유형 살펴보기' }))
  return within(overview).getByRole('region', { name: '유형 목록' })
}

function priorityList() {
  return screen.getByRole('list', { name: '먼저 확인할 유형의 기간 오답률 비교' })
}

function concentrationDetails() {
  const details = screen.getByText(/^상위 \d+유형에 오답 \d+문항 포함$/).closest('details') as HTMLDetailsElement
  fireEvent.click(within(details).getByText(/^상위 \d+유형에 오답 \d+문항 포함$/))
  expect(details.open).toBe(true)
  return details
}

function trendFixture() {
  const weeks = Array.from({ length: 8 }, (_, index) => analysisWeek(`trend-${index + 1}`, index + 1))
  const types = [
    { tag: analysisTag, total: 5, correct: weeks.map(() => 1) },
    { tag: { ...analysisTag, id: 'claim', name: '주장' }, total: 4, correct: [1, 1, 1, 1, 4, 4, 4, 4] },
    { tag: { ...analysisTag, id: 'content', name: '내용 일치' }, total: 4, correct: weeks.map(() => 4) },
  ]
  return analysisData(types.flatMap((type) => weeks.flatMap((week, index) =>
    Array.from({ length: type.total }, (_, question) => analysisAnswer(`${type.tag.id}-${week.id}-${question}`, week.id, question < type.correct[index], [type.tag])))), weeks)
}

describe('분석 화면', () => {
  it('추천과 접힌 상세의 관련 오답에서 동일한 실제 태그를 전달한다', () => {
    const onTagClick = vi.fn()
    render(<Subject data={analysisFixture} onTagClick={onTagClick} />)
    openDisclosure('유형별 최근 흐름')
    const chart = screen.getByRole('group', { name: '정답률 추이를 볼 유형' }).parentElement!
    fireEvent.click(within(chart).getByRole('button', { name: '빈칸 추론 오답 3문항 보기' }))
    openDisclosure('회차별 변화')
    fireEvent.click(screen.getByRole('button', { name: '빈칸 추론 관련 오답 보기' }))
    expect(onTagClick.mock.calls).toEqual([['blank', '빈칸 추론'], ['blank', '빈칸 추론']])
    expect(screen.getByText('직전 회차와 67%p 차이 · 참고')).toBeTruthy()
    expect(screen.queryByText(/직전 \d+회 대비/)).toBeNull()
    expect(screen.queryByRole('button', { name: /내용 일치 오답/ })).toBeNull()
  })

  it('기간 데이터가 바뀌면 헤드라인과 액션도 갱신한다', () => {
    const { rerender } = render(<Subject data={analysisFixture} />)
    rerender(<Subject data={analysisData([analysisAnswer('ok', 'w', true)], [analysisWeek('w')])} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('모두 맞혔어요')
    expect(screen.queryByRole('button', { name: /오답 \d+문항 보기/ })).toBeNull()
    rerender(<Subject data={analysisData([], [])} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('기록이 쌓이면')
    expect(screen.queryByRole('region', { name: '전체 유형 분석' })).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('유형 미분류 오답은 전체 오답 조회로 연결한다', () => {
    const onOpenWrongNote = vi.fn()
    render(<Subject data={analysisData([analysisAnswer('a', 'w', false, [])], [analysisWeek('w')])} onOpenWrongNote={onOpenWrongNote} />)
    fireEvent.click(screen.getByRole('button', { name: '오답 1문항 확인하기' }))
    expect(onOpenWrongNote).toHaveBeenCalledOnce()
    expect(screen.queryByRole('region', { name: '전체 유형 분석' })).toBeNull()
  })

  it('전체 유형 요약과 누적 비교를 먼저 보여주고 최근 그래프와 세부 분석은 독립적으로 펼친다', () => {
    render(<Subject data={insightFixture} />)
    const chart = disclosure('유형별 최근 흐름')
    const trends = disclosure('회차별 변화')
    const areas = disclosure('영역별 요약')
    const criteria = disclosure('분석 기준과 추천 이유')
    expect(chart.open).toBe(false)
    expect(trends.open).toBe(false)
    expect(areas.open).toBe(false)
    expect(criteria.open).toBe(false)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('group', { name: '정답률 추이를 볼 유형' })).toBeNull()
    const mainTitles = screen.getAllByRole('heading', { level: 2, hidden: true })
      .filter((heading) => !heading.closest('details')).map((heading) => heading.textContent)
    expect(mainTitles).toEqual(['3개 유형 · 선택 기간 누적', '먼저 확인할 유형'])
    const overview = screen.getByRole('region', { name: '전체 유형 분석' })
    expect(overview.compareDocumentPosition(priorityList()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '오답이 모인 범위' })).toBeNull()
    expect(screen.queryByRole('region', { name: '유형 목록' })).toBeNull()
    expect(screen.getByText(/기간 밖의 기록은 합치지 않아요/).closest('details')).toBe(criteria)
    expect(within(screen.getByRole('region', { name: '먼저 살펴볼 내용' })).queryByText(/먼저 복습을 권해요/)).toBeNull()
    expect(within(priorityList()).queryByText(/먼저 복습을 권해요/)).toBeNull()
    expect(screen.queryByRole('button', { name: /^복습 \d+순위/ })).toBeNull()
    openDisclosure('영역별 요약')
    expect(chart.open).toBe(false)
    expect(trends.open).toBe(false)
    expect(criteria.open).toBe(false)
    expect(screen.getByRole('region', { name: '영역별 요약' })).toBeTruthy()
    openDisclosure('분석 기준과 추천 이유')
    expect(areas.open).toBe(true)
    expect(chart.open).toBe(false)
    expect(trends.open).toBe(false)
    expect(within(criteria).getByRole('region', { name: '분석 기준과 추천 이유' }).textContent).toContain('3회 이상 출제·10문항 이상')
    openDisclosure('유형별 최근 흐름')
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(areas.open).toBe(true)
    expect(criteria.open).toBe(true)
    expect(trends.open).toBe(false)
  })

  it('같은 영역에 속하는 다중 태그의 문항을 중복 계산하지 않는다', () => {
    const data = analysisData([analysisAnswer('a', 'w', false, [analysisTag, { ...analysisTag, id: 'other', name: '다른 독해 유형' }])], [analysisWeek('w')])
    render(<Subject data={data} />)
    openDisclosure('영역별 요약')
    const areas = screen.getByRole('region', { name: '영역별 요약' })
    expect(within(areas).getByText('1문항 중 0문항 정답')).toBeTruthy()
    expect(within(areas).getByText('선택 기간 누적 정답률 · 영역마다 문항 수가 달라요.')).toBeTruthy()
    const types = within(areas).getByText('포함된 유형 2개').closest('details') as HTMLDetailsElement
    expect(types.open).toBe(false)
    fireEvent.click(within(types).getByText('포함된 유형 2개'))
    expect(types.open).toBe(true)
    expect(types.textContent).toContain('빈칸 추론')
    expect(types.textContent).toContain('다른 독해 유형')
  })

  it('24개 유형은 전체 분석을 펼친 다음 더 보기로 전부 접근할 수 있다', () => {
    render(<Subject data={manyTypesFixture} />)
    openTypeList()
    const list = screen.getByRole('region', { name: '유형 목록' })
    expect(within(list).getAllByRole('button', { name: /오답 \d+문항 보기$/ })).toHaveLength(8)
    fireEvent.click(within(list).getByRole('button', { name: '유형 16개 더 보기' }))
    expect(within(list).getAllByRole('button', { name: /오답 \d+문항 보기$/ })).toHaveLength(24)
    expect(within(list).getByRole('button', { name: '문맥 어휘 오답 1문항 보기' })).toBeTruthy()
  })

  it('많은 유형에서도 집중 보완 추천은 최대 세 개이며 안정적·기록 부족 유형을 끼워 넣지 않는다', () => {
    render(<Subject data={manyTypesFixture} />)
    const priorities = within(priorityList()).getAllByRole('button', { name: /오답 \d+문항 보기$/ })
    expect(priorities).toHaveLength(3)
    for (const priority of priorities) {
      expect(within(priority).queryByText('안정적')).toBeNull()
      expect(within(priority).queryByText('기록 부족')).toBeNull()
      expect(priority.textContent).toMatch(/빈칸 추론|문장 삽입|글의 순서|어법/)
      expect(within(priority).getByText('45%')).toBeTruthy()
      expect(within(priority).getByText('20문항 중 오답 9')).toBeTruthy()
      expect(within(priority).getByText('오답 9문항 보기')).toBeTruthy()
      expect(within(priority).getByText('4회에서 오답 반복')).toBeTruthy()
      expect(within(priority).queryByText('30%')).toBeNull()
      expect(within(priority).queryByText(/직전 출제 묶음보다/)).toBeNull()
    }
    expect(screen.queryByRole('region', { name: '유형 목록' })).toBeNull()
  })

  it('분류별 유형 수를 바로 확인하고 분류를 누르면 해당 목록과 선택 상태를 보여준다', () => {
    render(<Subject data={manyTypesFixture} />)
    const overview = screen.getByRole('region', { name: '전체 유형 분석' })
    const groups = [
      { status: 'priority', label: '우선 보완', count: 4 },
      { status: 'review', label: '복습 권장', count: 2 },
      { status: 'stable', label: '안정적', count: 10 },
      { status: 'insufficient', label: '기록 부족', count: 8 },
    ]
    for (const group of groups) {
      expect(within(overview).getByRole('button', { name: `${group.label} ${group.count}개 유형 보기` }).getAttribute('aria-pressed')).toBe('false')
    }
    for (const group of groups) {
      const button = within(overview).getByRole('button', { name: `${group.label} ${group.count}개 유형 보기` })
      fireEvent.click(button)
      expect(button.getAttribute('aria-pressed')).toBe('true')
      const list = within(overview).getByRole('region', { name: '유형 목록' })
      expect((within(list).getByRole('combobox', { name: '유형 상태 필터' }) as HTMLSelectElement).value).toBe(group.status)
      expect(within(list).getAllByRole('region')).toHaveLength(1)
      expect(within(list).getByRole('region', { name: `${group.label} 유형` })).toBeTruthy()
      expect(within(list).getByRole('status').textContent).toBe(group.count > 8 ? `${group.count}유형 중 8유형 표시` : `${group.count}유형`)
      for (const other of groups.filter((item) => item.status !== group.status)) {
        expect(within(overview).getByRole('button', { name: `${other.label} ${other.count}개 유형 보기` }).getAttribute('aria-pressed')).toBe('false')
      }
    }
    fireEvent.change(within(overview).getByRole('searchbox', { name: '유형 이름 검색' }), { target: { value: '문맥 어휘' } })
    expect(within(overview).getByRole('status').textContent).toBe('1유형')
    fireEvent.click(within(overview).getByRole('button', { name: '안정적 10개 유형 보기' }))
    expect((within(overview).getByRole('searchbox', { name: '유형 이름 검색' }) as HTMLInputElement).value).toBe('')
    expect(within(overview).getByRole('status').textContent).toBe('10유형 중 8유형 표시')
    fireEvent.click(within(overview).getByRole('button', { name: '유형 2개 더 보기' }))
    expect(within(overview).getByRole('status').textContent).toBe('10유형')
    fireEvent.click(within(overview).getByRole('button', { name: '안정적 10개 유형 보기' }))
    expect(within(overview).getByRole('status').textContent).toBe('10유형 중 8유형 표시')
  })

  it('유형 목록을 접었다 펴면 검색과 상태 필터를 초기화한다', () => {
    render(<Subject data={manyTypesFixture} />)
    const overview = screen.getByRole('region', { name: '전체 유형 분석' })
    const list = openTypeList()
    fireEvent.change(within(list).getByRole('searchbox', { name: '유형 이름 검색' }), { target: { value: '요약문' } })
    fireEvent.change(within(list).getByRole('combobox', { name: '유형 상태 필터' }), { target: { value: 'stable' } })
    expect(within(list).getByRole('status').textContent).toBe('1유형')
    fireEvent.click(within(overview).getByRole('button', { name: '유형 목록 접기' }))
    expect(within(overview).queryByRole('region', { name: '유형 목록' })).toBeNull()
    const reopened = openTypeList()
    expect((within(reopened).getByRole('searchbox', { name: '유형 이름 검색' }) as HTMLInputElement).value).toBe('')
    expect((within(reopened).getByRole('combobox', { name: '유형 상태 필터' }) as HTMLSelectElement).value).toBe('all')
    expect(within(reopened).getByRole('status').textContent).toBe('24유형 중 8유형 표시')
    expect(within(overview).getByRole('button', { name: '안정적 10개 유형 보기' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('검색은 기본 여덟 개 밖의 유형도 찾고 실제 유형별 오답으로 이동한다', () => {
    const onTagClick = vi.fn()
    render(<Subject data={manyTypesFixture} onTagClick={onTagClick} />)
    openTypeList()
    const list = screen.getByRole('region', { name: '유형 목록' })
    expect(within(list).queryByRole('button', { name: '문맥 어휘 오답 1문항 보기' })).toBeNull()
    const search = within(list).getByRole('searchbox', { name: '유형 이름 검색' })
    fireEvent.change(search, { target: { value: '  문맥 어휘  ' } })
    expect(within(list).getByRole('status').textContent).toBe('1유형')
    fireEvent.click(within(list).getByRole('button', { name: '문맥 어휘 오답 1문항 보기' }))
    expect(onTagClick).toHaveBeenLastCalledWith('many-23', '문맥 어휘')
    fireEvent.change(search, { target: { value: '요약문' } })
    fireEvent.click(within(list).getByRole('button', { name: '요약문 오답 2문항 보기' }))
    expect(onTagClick).toHaveBeenLastCalledWith('many-15', '요약문')
  })

  it('상태 필터는 해당 분류만 보여주고 많은 안정적 유형도 더 보기로 확인한다', () => {
    render(<Subject data={manyTypesFixture} />)
    openTypeList()
    const list = screen.getByRole('region', { name: '유형 목록' })
    const filter = within(list).getByRole('combobox', { name: '유형 상태 필터' })
    const groups = [
      { status: 'priority', label: '우선 보완', count: 4 },
      { status: 'review', label: '복습 권장', count: 2 },
      { status: 'stable', label: '안정적', count: 10 },
      { status: 'insufficient', label: '기록 부족', count: 8 },
    ]
    for (const group of groups) {
      fireEvent.change(filter, { target: { value: group.status } })
      expect(within(list).getByRole('status').textContent).toBe(group.count > 8 ? `${group.count}유형 중 8유형 표시` : `${group.count}유형`)
      expect(within(list).getAllByRole('region')).toHaveLength(1)
      expect(within(list).getByRole('region', { name: `${group.label} 유형` })).toBeTruthy()
      expect(within(list).getAllByRole('button', { name: /오답 \d+문항 보기$/ })).toHaveLength(Math.min(group.count, 8))
      if (group.count > 8) {
        fireEvent.click(within(list).getByRole('button', { name: '유형 2개 더 보기' }))
        expect(within(list).getAllByRole('button', { name: /오답 \d+문항 보기$/ })).toHaveLength(10)
      }
    }
    fireEvent.change(filter, { target: { value: 'all' } })
    expect(within(list).getByRole('status').textContent).toBe('24유형 중 8유형 표시')
  })

  it('검색과 상태 필터를 함께 적용하고 빈 결과에서 조건을 바꿔 다시 찾을 수 있다', () => {
    render(<Subject data={manyTypesFixture} />)
    openTypeList()
    const list = screen.getByRole('region', { name: '유형 목록' })
    const search = within(list).getByRole('searchbox', { name: '유형 이름 검색' })
    const filter = within(list).getByRole('combobox', { name: '유형 상태 필터' })
    fireEvent.change(filter, { target: { value: 'priority' } })
    fireEvent.change(search, { target: { value: '문맥 어휘' } })
    expect(within(list).getByRole('status').textContent).toBe('0유형')
    expect(within(list).getByText('조건에 맞는 유형이 없어요.')).toBeTruthy()
    expect(within(list).queryByRole('button', { name: /오답 \d+문항 보기$/ })).toBeNull()
    fireEvent.change(filter, { target: { value: 'all' } })
    expect(within(list).getByRole('button', { name: '문맥 어휘 오답 1문항 보기' })).toBeTruthy()
    expect(within(list).queryByText('조건에 맞는 유형이 없어요.')).toBeNull()
    fireEvent.change(search, { target: { value: '' } })
    expect(within(list).getByRole('status').textContent).toBe('24유형 중 8유형 표시')
  })

  it('기간 변경은 유형 목록·검색·상태 필터와 독립 상세의 펼침을 초기화한다', () => {
    const { rerender } = render(<Subject data={manyTypesFixture} />)
    openTypeList()
    fireEvent.change(screen.getByRole('searchbox', { name: '유형 이름 검색' }), { target: { value: '요약문' } })
    fireEvent.change(screen.getByRole('combobox', { name: '유형 상태 필터' }), { target: { value: 'stable' } })
    expect(screen.getByRole('status').textContent).toBe('1유형')
    openDisclosure('유형별 최근 흐름')
    openDisclosure('회차별 변화')
    openDisclosure('영역별 요약')
    openDisclosure('분석 기준과 추천 이유')
    rerender(<Subject data={analysisFixture} />)
    expect(screen.queryByRole('region', { name: '유형 목록' })).toBeNull()
    expect(disclosure('유형별 최근 흐름').open).toBe(false)
    expect(screen.queryByRole('group', { name: '정답률 추이를 볼 유형' })).toBeNull()
    expect(disclosure('회차별 변화').open).toBe(false)
    expect(disclosure('영역별 요약').open).toBe(false)
    expect(disclosure('분석 기준과 추천 이유').open).toBe(false)
    openTypeList()
    expect((screen.getByRole('searchbox', { name: '유형 이름 검색' }) as HTMLInputElement).value).toBe('')
    expect((screen.getByRole('combobox', { name: '유형 상태 필터' }) as HTMLSelectElement).value).toBe('all')
    expect(screen.getByRole('status').textContent).toBe('3유형')
  })

  it('오답 범위와 선택한 유형의 개선·강점을 하나의 차트에서 보여준다', () => {
    const onTagClick = vi.fn()
    render(<Subject data={trendFixture()} onTagClick={onTagClick} />)
    const concentration = screen.getByText('상위 1유형에 오답 32문항 포함').closest('details') as HTMLDetailsElement
    expect(concentration.open).toBe(false)
    concentrationDetails()
    expect(within(concentration).getByText('추천 유형 32문항 · 그 외 12문항')).toBeTruthy()
    expect(within(concentration).getByText('73%')).toBeTruthy()
    expect(screen.queryByText('최근에 나아진 유형')).toBeNull()
    openDisclosure('유형별 최근 흐름')
    const selector = screen.getByRole('group', { name: '정답률 추이를 볼 유형' })
    fireEvent.click(within(selector).getByRole('button', { name: '주장' }))
    expect(screen.getByText('최근에 나아진 유형')).toBeTruthy()
    expect(screen.getByText('직전 4회 대비 +75%p')).toBeTruthy()
    fireEvent.click(within(selector.parentElement!).getByRole('button', { name: '주장 오답 12문항 보기' }))
    expect(onTagClick).toHaveBeenCalledWith('claim', '주장')
    fireEvent.click(within(selector).getByRole('button', { name: '내용 일치' }))
    expect(screen.getByText('잘 풀고 있는 유형')).toBeTruthy()
    expect(screen.getByRole('img', { name: /내용 일치 정답률/ })).toBeTruthy()
    expect(within(selector.parentElement!).queryByRole('button', { name: /오답 \d+문항 보기/ })).toBeNull()
    expect(screen.queryByRole('region', { name: '유형 목록' })).toBeNull()
  })

  it('최근 충분한 기록이 회복한 유형은 누적 보완 분류여도 추천에 섞지 않고 전체 분석에서 접근한다', () => {
    const onTagClick = vi.fn()
    render(<Subject data={trendFixture()} onTagClick={onTagClick} />)
    fireEvent.click(within(priorityList()).getByRole('button', { name: '빈칸 추론 오답 32문항 보기' }))
    expect(within(priorityList()).getAllByRole('button', { name: /오답 \d+문항 보기$/ })).toHaveLength(1)
    expect(within(priorityList()).queryByRole('button', { name: /주장 오답/ })).toBeNull()
    const list = openTypeList()
    fireEvent.change(within(list).getByRole('combobox', { name: '유형 상태 필터' }), { target: { value: 'review' } })
    const row = within(list).getByRole('button', { name: '주장 오답 12문항 보기' })
    expect(within(row).getByText('63%')).toBeTruthy()
    expect(within(row).getByText('기간 20/32문항 정답 · 8회 출제')).toBeTruthy()
    fireEvent.click(row)
    expect(onTagClick.mock.calls).toEqual([['blank', '빈칸 추론'], ['claim', '주장']])
    expect(disclosure('분석 기준과 추천 이유').open).toBe(false)
  })

  it('기간 정답률은 높아도 최근 충분한 기록에 오답이 많으면 두 수치의 범위를 구분해 안내한다', () => {
    const weeks = Array.from({ length: 12 }, (_, index) => analysisWeek(`warning-${index + 1}`, index + 1))
    const answers = weeks.flatMap((week, index) => Array.from({ length: index < 8 ? 10 : 4 }, (_, question) =>
      analysisAnswer(`${week.id}-${question}`, week.id, index < 8 || question === 0)))
    render(<Subject data={analysisData(answers, weeks)} />)
    const row = within(priorityList()).getByRole('button', { name: '빈칸 추론 오답 12문항 보기' })
    expect(within(row).getByText('13%')).toBeTruthy()
    expect(within(row).getByText('96문항 중 오답 12')).toBeTruthy()
    expect(within(row).getByText('최근 4회 정답률 25% · 최근 결과 확인')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('최근 결과를 확인해요')
    expect(screen.getByRole('button', { name: '안정적 1개 유형 보기' })).toBeTruthy()
  })

  it('소표본에서는 개선·강점·오답 집중도를 과장해서 보여주지 않는다', () => {
    const { rerender } = render(<Subject data={analysisFixture} />)
    expect(screen.queryByText('최근에 나아진 유형')).toBeNull()
    expect(screen.queryByText('잘 풀고 있는 유형')).toBeNull()
    rerender(<Subject data={analysisData([analysisAnswer('single', 'w', false)], [analysisWeek('w')])} />)
    expect(screen.queryByText(/^상위 \d+유형에 오답/)).toBeNull()
    expect(within(priorityList()).getByText('판정 보류')).toBeTruthy()
    expect(screen.getByRole('button', { name: '기록 부족 1개 유형 보기' })).toBeTruthy()
    openDisclosure('유형별 최근 흐름')
    expect(screen.getByText('변화 비교는 최근·직전 묶음이 각각 3회·10문항 이상일 때 보여드려요.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('약점 판단은 보류해요')
    expect(screen.queryByText(/직전 \d+회 대비/)).toBeNull()
  })

  it('추천 두 유형이 일부 오답만 포함하면 나머지 범위도 함께 보여준다', () => {
    const answers = Array.from({ length: 10 }, (_, index) => analysisAnswer(`spread-${index}`, 'w', false, [{ ...analysisTag, id: `type-${index}`, name: `유형 ${index}` }]))
    render(<Subject data={analysisData(answers, [analysisWeek('w')])} />)
    const concentration = concentrationDetails()
    expect(within(concentration).getByText('오답이 여러 유형에 나뉘어 있어요.')).toBeTruthy()
    expect(within(concentration).getByText('추천 유형 2문항 · 그 외 8문항')).toBeTruthy()
  })

  it('추천 두 유형이 겹치는 오답은 분할막대 범위에서 한 문항으로 센다', () => {
    const otherTag = { ...analysisTag, id: 'other', name: '다른 독해 유형' }
    const answers = [
      analysisAnswer('both-1', 'w', false, [analysisTag, otherTag]),
      analysisAnswer('both-2', 'w', false, [analysisTag, otherTag]),
      analysisAnswer('outside-1', 'w', false, [{ ...analysisTag, id: 'outside-1', name: '기타 유형 1' }]),
      analysisAnswer('outside-2', 'w', false, [{ ...analysisTag, id: 'outside-2', name: '기타 유형 2' }]),
    ]
    render(<Subject data={analysisData(answers, [analysisWeek('w')])} />)
    const concentration = concentrationDetails()
    expect(within(concentration).getByText('추천 유형 2문항 · 그 외 2문항')).toBeTruthy()
  })
})
