// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HomeTab } from '@/app/share/[token]/tabs/home-tab'
import { ScoreTab } from '@/app/share/[token]/tabs/score-tab'
import type { ShareModel } from '@/app/share/[token]/use-share-model'

const query = vi.hoisted(() => ({ data: undefined, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => query }))
vi.mock('@/app/share/[token]/share-ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/app/share/[token]/share-ui')>(),
  CountUp: ({ value }: { value: number }) => <>{value}</>,
}))
afterEach(() => { cleanup(); query.isLoading = false; query.isError = false; vi.clearAllMocks() })

const week = { id: 'w1', class_id: 'c1', week_number: 9, start_date: '2025-03-01', reading_total: 10, vocab_total: 10, homework_total: 0 }
function model(pending = 2): ShareModel {
  return {
    weeks: [week], weekScores: [{ id: 's1', week_id: 'w1', reading_correct: 7, vocab_correct: 8, homework_done: null, memo: null, vocab_retake_correct: null }],
    classAverages: {}, studentAnswers: [], vocabAnswers: [], attendance: [], clinicAttendance: [], commentFeed: [], attendanceStreak: 0,
    latestReport: { week, headline: '최근 시험 기록', facts: [], memo: null, attendanceStatus: null,
      wrongReading: 1, wrongVocab: 2, retakeTaken: true, retakePending: pending },
    periodSummary: { weekCount: 1, reading: { mean: 70, latest: 80, delta: 10, classDiff: -5, points: [] }, vocab: null, homework: null },
  } as unknown as ShareModel
}

describe('홈의 기간 기준과 액션', () => {
  function renderHome(pending = 2) {
    const onOpenWrongNote = vi.fn()
    render(<HomeTab model={model(pending)} periodLabel="지난 시즌" onOpenWrongNote={onOpenWrongNote}
      onGoHistory={vi.fn()} onGoHistoryWeek={vi.fn()} />)
    return onOpenWrongNote
  }
  it('과거 기록도 최근 수업으로 표시하고 두 비교값의 방향을 독립적으로 표시한다', () => {
    renderHome()
    expect(screen.getByText(/최근 수업 ·/)).toBeTruthy()
    expect(screen.getByText('% · 기간 평균')).toBeTruthy()
    expect(screen.getByText('직전 회차 대비 +10%p').getAttribute('style')).toContain('--share-blue')
    expect(screen.getByText('기간 비교 · 반보다 -5%p').getAttribute('style')).toContain('--share-red')
  })
  it('오답 보기 버튼은 오답 목록으로 이동한다', () => {
    const open = renderHome()
    fireEvent.click(screen.getByRole('button', { name: /진단평가 오답.*오답 보기/ }))
    expect(open).toHaveBeenCalledWith('reading')
  })
  it('재시험 완료 단어는 홈 할 일에서 제외한다', () => {
    renderHome(0)
    expect(screen.queryByRole('button', { name: /단어 오답/ })).toBeNull()
  })
})

describe('전체 기간 조회 상태', () => {
  function openAll() {
    render(<ScoreTab token="test" model={model()} periodLabel="현재 기간" selectedPeriodId={null}
      hasOtherPeriods onOpenWrongNoteWeek={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '전체 기간' }))
  }
  it('전체 기간 로딩 중 현재 기간의 기록을 대체 표시하지 않는다', () => {
    query.isLoading = true
    openAll()
    expect(screen.getByText('전체 기간 기록을 불러오는 중이에요.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /9주차/ })).toBeNull()
    expect(screen.queryByText('아직 기록된 회차가 없어요.')).toBeNull()
  })
  it('조회 실패 후 재시도할 수 있다', () => {
    query.isError = true
    openAll()
    expect(screen.queryByRole('button', { name: /9주차/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(query.refetch).toHaveBeenCalledOnce()
  })
})
