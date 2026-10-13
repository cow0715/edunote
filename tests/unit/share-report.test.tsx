// @vitest-environment jsdom
import { useMemo, useState, type ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ShareReport } from '@/app/share/[token]/share-client'
import { AnalysisTab } from '@/app/share/[token]/tabs/analysis-tab'
import { getShareDesignSample } from '../fixtures/share-design-samples'
import type { TabId } from '@/app/share/[token]/share-types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/components/layout/theme-select', () => ({ ThemeSelect: () => null }))

const clients: QueryClient[] = []
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

type ReportProps = ComponentProps<typeof ShareReport>
function setup(overrides: Partial<ReportProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  const props: ReportProps = {
    data: getShareDesignSample('october'), token: 'share-design-test', selectedPeriodId: 'october',
    onSelectPeriod: vi.fn(), onStartRetake: vi.fn(),
    renderAnalysis: (analysisProps) => <AnalysisTab {...analysisProps} />,
    historyAllData: getShareDesignSample('october'), ...overrides,
  }
  const view = render(<QueryClientProvider client={client}><ShareReport {...props} /></QueryClientProvider>)
  return { ...view, props, client }
}
function selectTab(name: string) {
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name }))
}

describe('공유 리포트 실제 화면 재사용', () => {
  // 다섯 실제 탭을 연속 렌더링하는 통합 흐름은 병렬 빌드 부하도 고려한다.
  // 작은 2회차 입력을 사용하고 이 검사에만 10초를 허용한다.
  it('동일한 셸에서 다섯 실제 탭을 탐색한다', () => {
    setup()
    expect(screen.getByText(/최근 수업 · 10월 학습 2회차/)).toBeTruthy()
    selectTab('기록')
    expect(screen.getByRole('heading', { name: '회차별 기록' })).toBeTruthy()
    expect(screen.getByText('10월 학습 2회차')).toBeTruthy()
    selectTab('분석')
    expect(screen.getByRole('region', { name: '먼저 살펴볼 내용' }).textContent).toContain('확인된 2회차 · 48문항')
    expect(screen.getByRole('button', { name: '기록 부족 8개 유형 보기' })).toBeTruthy()
    selectTab('오답')
    expect(screen.getByRole('button', { name: /^진단평가 \d+$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^\d+문항 다시 풀기/ })).toBeTruthy()
    selectTab('단어')
    expect(screen.getByRole('heading', { name: '단어장' })).toBeTruthy()
    selectTab('홈')
    expect(screen.getByText(/최근 수업 · 10월 학습 2회차/)).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  }, 10_000)

  it('분석의 실제 태그와 오답 문항을 드로어로 전달하고 닫기까지 연결한다', () => {
    const data = getShareDesignSample('september')
    setup({ data, selectedPeriodId: 'september', initialTab: 'analysis' })
    const priorities = screen.getByRole('list', { name: '먼저 확인할 유형의 기간 오답률 비교' })
    const wrongBlank = data.studentAnswers.filter((answer) => !answer.is_correct && answer.exam_question?.exam_question_tag.some((tag) => tag.concept_tag?.id === 'share-design-blank'))
    fireEvent.click(within(priorities).getByRole('button', { name: `빈칸 오답 ${wrongBlank.length}문항 보기` }))
    expect(screen.getByRole('heading', { name: '빈칸 오답노트' })).toBeTruthy()
    expect(screen.getByText(`선택 기간 누적 · 총 ${wrongBlank.length}회 틀림`)).toBeTruthy()
    const drawer = screen.getByRole('heading', { name: '빈칸 오답노트' }).parentElement!.parentElement!.parentElement!
    expect(within(drawer).getAllByRole('article')).toHaveLength(wrongBlank.length)
    expect(drawer.textContent).toContain(wrongBlank[0].exam_question!.passage)
    expect(drawer.textContent).toContain(wrongBlank[0].exam_question!.explanation)
    fireEvent.click(within(drawer).getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('heading', { name: '빈칸 오답노트' })).toBeNull()
    expect(within(screen.getByRole('navigation')).getByRole('button', { name: '분석' }).getAttribute('aria-current')).toBe('page')
  })


  it('기간 선택 시 같은 분석 탭에서 새 기간의 모델로 다시 계산한다', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    clients.push(client)
    const onSelectPeriod = vi.fn()
    function Subject() {
      const [period, setPeriod] = useState('september')
      const [tab, setTab] = useState<TabId>('analysis')
      const data = useMemo(() => getShareDesignSample(period), [period])
      return <ShareReport data={data} token="share-design-test" selectedPeriodId={period}
        activeTab={tab} onTabChange={setTab} onSelectPeriod={(id) => { onSelectPeriod(id); setPeriod(id ?? 'semester') }}
        onStartRetake={vi.fn()} renderAnalysis={(props) => <AnalysisTab {...props} />} />
    }
    render(<QueryClientProvider client={client}><Subject /></QueryClientProvider>)
    expect(screen.getByRole('region', { name: '먼저 살펴볼 내용' }).textContent).toContain('확인된 4회차 · 96문항')
    fireEvent.click(screen.getByRole('button', { name: '기간 선택: 9월 학습' }))
    const sheet = screen.getByRole('dialog', { name: '기간 선택' })
    fireEvent.click(within(sheet).getByRole('button', { name: /고2 영어 심화반 · 10월 학습/ }))
    expect(onSelectPeriod).toHaveBeenCalledWith('october')
    expect(screen.queryByRole('dialog', { name: '기간 선택' })).toBeNull()
    expect(screen.getByRole('button', { name: '기간 선택: 10월 학습' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '먼저 살펴볼 내용' }).textContent).toContain('확인된 2회차 · 48문항')
    expect(screen.getByRole('button', { name: '기록 부족 8개 유형 보기' })).toBeTruthy()
    expect(within(screen.getByRole('navigation')).getByRole('button', { name: '분석' }).getAttribute('aria-current')).toBe('page')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('전체 기간을 주입받은 기록 탭은 API 없이 전체 회차를 조회한다', () => {
    setup({ initialTab: 'score', historyAllData: getShareDesignSample('semester') })
    expect(screen.getByText('10월 학습 2회차')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '전체 기간' }))
    expect(screen.getByText('전체 기간 12회차')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^1회차/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^12회차/ })).toBeTruthy()
    expect(screen.queryByText('전체 기간 기록을 불러오는 중이에요.')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['reading', 'vocab'] as const)('전체 기록의 이전 기간 %s 오답은 해당 기간과 선택 회차를 연다', (kind) => {
    const october = getShareDesignSample('october')
    const september = getShareDesignSample('september')
    const allData = {
      ...october,
      weeks: [...september.weeks, ...october.weeks],
      weekScores: [...september.weekScores, ...october.weekScores],
      studentAnswers: [...september.studentAnswers, ...october.studentAnswers],
      vocabAnswers: [...september.vocabAnswers, ...october.vocabAnswers],
      vocabWords: [...september.vocabWords, ...october.vocabWords],
      attendance: [...september.attendance, ...october.attendance],
      clinicAttendance: [...september.clinicAttendance, ...october.clinicAttendance],
      classAverages: { ...september.classAverages, ...october.classAverages },
    }
    const targetWeek = september.weeks[2]
    const targetScoreId = september.weekScores.find((score) => score.week_id === targetWeek.id)!.id
    const readingWrong = september.studentAnswers.filter((answer) => !answer.is_correct && answer.week_score_id === targetScoreId)
    const vocabWrong = september.vocabAnswers.filter((answer) => answer.week_score_id === targetScoreId)
    const onSelectPeriod = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    clients.push(client)
    function Subject() {
      const [period, setPeriod] = useState('october')
      return <ShareReport data={period === 'october' ? october : september} token="share-design-test" selectedPeriodId={period}
        initialTab="score" historyAllData={allData} onSelectPeriod={(id) => { onSelectPeriod(id); setPeriod(id ?? 'october') }}
        onStartRetake={vi.fn()} renderAnalysis={(props) => <AnalysisTab {...props} />} />
    }
    render(<QueryClientProvider client={client}><Subject /></QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: '전체 기간' }))
    const historyButton = screen.getByRole('button', { name: /^3회차/ })
    fireEvent.click(historyButton)
    const historyRow = historyButton.parentElement!
    fireEvent.click(within(historyRow).getByRole('button', {
      name: kind === 'reading' ? `오답 ${readingWrong.length}문항 보기` : `틀린 단어 ${vocabWrong.length}개`,
    }))

    expect(onSelectPeriod).toHaveBeenCalledOnce()
    expect(onSelectPeriod).toHaveBeenCalledWith('september')
    expect(screen.getByRole('button', { name: '기간 선택: 9월 학습' })).toBeTruthy()
    expect(within(screen.getByRole('navigation')).getByRole('button', { name: '오답' }).getAttribute('aria-current')).toBe('page')
    const main = screen.getByRole('main')
    expect(within(main).getByRole('button', { name: kind === 'reading' ? /^진단평가 \d+$/ : /^단어 \d+$/ }).getAttribute('aria-pressed')).toBe('true')
    const wrongWeekButton = within(main).getByRole('button', { name: /3회차/ })
    expect(wrongWeekButton.getAttribute('aria-expanded')).toBe('true')
    const wrongWeek = wrongWeekButton.closest('section')!
    if (kind === 'reading') {
      expect(within(wrongWeek).getAllByRole('article')).toHaveLength(readingWrong.length)
      expect(wrongWeek.textContent).toContain(readingWrong[0].exam_question!.explanation)
    } else {
      expect(within(wrongWeek).getByText(vocabWrong[0].test_word!)).toBeTruthy()
      expect(within(wrongWeek).getByRole('button', { name: '이 주차 단어장 전체 보기' })).toBeTruthy()
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('기간 로딩 동안 이전 수치를 숨기고 새 데이터가 오면 선택한 탭을 유지한다', () => {
    const { rerender, props, client, container } = setup()
    selectTab('단어')
    expect(screen.getByRole('heading', { name: '단어장' })).toBeTruthy()
    rerender(<QueryClientProvider client={client}><ShareReport {...props} selectedPeriodId="september" loading /></QueryClientProvider>)
    expect(screen.getByRole('status', { name: '리포트 불러오는 중' })).toBeTruthy()
    expect(screen.queryByRole('main')).toBeNull()
    expect(screen.queryByRole('heading', { name: '단어장' })).toBeNull()
    expect(screen.queryByRole('button', { name: '기간 선택: 10월 학습' })).toBeNull()
    expect(container.textContent).toBe('')

    rerender(<QueryClientProvider client={client}><ShareReport {...props} data={getShareDesignSample('september')} selectedPeriodId="september" loading={false} /></QueryClientProvider>)
    expect(screen.queryByRole('status', { name: '리포트 불러오는 중' })).toBeNull()
    expect(screen.getByRole('button', { name: '기간 선택: 9월 학습' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '단어장' })).toBeTruthy()
    expect(within(screen.getByRole('navigation')).getByRole('button', { name: '단어' }).getAttribute('aria-current')).toBe('page')
    expect(screen.queryByText(/최근 수업 ·/)).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('단어 오답의 재시험 시작은 실제 선택 회차를 외부 처리기에 전달한다', () => {
    const onStartRetake = vi.fn()
    const { props } = setup({ initialTab: 'wrongnote', onStartRetake })
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: /^단어 \d+$/ }))
    fireEvent.click(screen.getByRole('button', { name: /^재시험 보기/ }))
    expect(onStartRetake).toHaveBeenCalledWith(props.data.weeks.at(-1)!.id)
    expect(fetch).not.toHaveBeenCalled()
  })
})

