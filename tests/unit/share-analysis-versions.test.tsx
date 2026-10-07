// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ShareAnalysisHistory } from '@/components/dev/share-analysis-versions'
import { useShareModel } from '@/app/share/[token]/use-share-model'
import type { ShareData } from '@/app/share/[token]/share-types'
import { analysisAnswer, analysisData, analysisFixture, analysisWeek, manyTypesFixture } from '../fixtures/share-analysis'

afterEach(cleanup)

function Subject({ data = manyTypesFixture, version = 'list', onTagClick = vi.fn(), onOpenWrongNote = vi.fn() }: {
  data?: ShareData; version?: 'list' | 'trend'; onTagClick?: (id: string, name: string) => void; onOpenWrongNote?: () => void
}) {
  const model = useShareModel(data)
  return <ShareAnalysisHistory version={version} model={model} periodLabel="9월" onTagClick={onTagClick} onOpenWrongNote={onOpenWrongNote} />
}

describe('Share 분석 디자인 이력', () => {
  it('목록형은 최대 여덟 유형에서 시작하고 남은 실제 유형도 모두 조회한다', () => {
    render(<Subject />)
    const list = screen.getByRole('region', { name: '유형 목록' })
    expect(within(list).getAllByRole('button', { name: /오답 \d+문항 보기$/ })).toHaveLength(8)
    fireEvent.click(within(list).getByRole('button', { name: '유형 16개 더 보기' }))
    expect(within(list).getAllByRole('button', { name: /오답 \d+문항 보기$/ })).toHaveLength(24)
    expect(within(list).getByRole('button', { name: '문맥 어휘 오답 1문항 보기' })).toBeTruthy()
    fireEvent.click(within(list).getByRole('button', { name: '유형 접기' }))
    expect(within(list).getAllByRole('button', { name: /오답 \d+문항 보기$/ })).toHaveLength(8)
  })

  it('과거 레이아웃도 현재 누적 수치를 사용하고 태그 액션은 원래 ID를 전달한다', () => {
    const onTagClick = vi.fn()
    render(<Subject onTagClick={onTagClick} />)
    const list = screen.getByRole('region', { name: '유형 목록' })
    const blank = within(list).getByRole('button', { name: '빈칸 추론 오답 9문항 보기' })
    expect(within(blank).getByText('45%')).toBeTruthy()
    expect(within(blank).getByText('20문항 중 오답 9 · 4회 출제')).toBeTruthy()
    expect(within(blank).queryByText('70%')).toBeNull()
    fireEvent.click(blank)
    expect(onTagClick).toHaveBeenCalledWith('many-0', '빈칸 추론')
  })

  it('흐름형은 추천 세 유형 뒤에 실제 선 그래프를 기본으로 표시한다', () => {
    render(<Subject version="trend" />)
    const priorities = screen.getByRole('region', { name: '복습할 유형' })
    expect(within(priorities).getAllByRole('button')).toHaveLength(3)
    expect(within(priorities).getAllByText('55%')).toHaveLength(3)
    expect(screen.getByRole('img').querySelector('title')?.textContent).toContain('80% → 80% → 20% → 40%')
    expect(priorities.compareDocumentPosition(screen.getByRole('img')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('region', { name: '유형 목록' })).toBeNull()
  })

  it('상태 선택으로 목록을 열고 이름 검색과 필터를 함께 적용한다', () => {
    render(<Subject version="trend" />)
    fireEvent.click(screen.getByRole('button', { name: '우선 보완 4개 유형 보기' }))
    const list = screen.getByRole('region', { name: '유형 목록' })
    expect(within(list).getAllByRole('button', { name: /오답 \d+문항 보기$/ })).toHaveLength(4)
    fireEvent.change(within(list).getByRole('searchbox', { name: '유형 이름 검색' }), { target: { value: '빈칸' } })
    expect(within(list).getAllByRole('button', { name: /오답 \d+문항 보기$/ })).toHaveLength(1)
    fireEvent.change(within(list).getByRole('combobox', { name: '유형 상태 필터' }), { target: { value: 'stable' } })
    expect(within(list).getByText('조건에 맞는 유형이 없어요.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '안정적 10개 유형 보기' }))
    const resetList = screen.getByRole('region', { name: '유형 목록' })
    expect((within(resetList).getByRole('searchbox') as HTMLInputElement).value).toBe('')
    expect(within(resetList).getByRole('button', { name: '유형 2개 더 보기' })).toBeTruthy()
  })

  it('선택 기간이 달라지면 열린 유형 목록과 검색을 초기화한다', () => {
    const { rerender } = render(<Subject version="trend" />)
    fireEvent.click(screen.getByRole('button', { name: '전체 유형 보기' }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '어법' } })
    rerender(<Subject version="trend" data={analysisFixture} />)
    expect(screen.queryByRole('region', { name: '유형 목록' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '전체 유형 보기' }))
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
    expect((screen.getByRole('combobox', { name: '유형 상태 필터' }) as HTMLSelectElement).value).toBe('all')
  })

  it.each(['list', 'trend'] as const)('%s에서도 미분류 오답은 전체 오답 조회로 연결한다', (version) => {
    const onOpenWrongNote = vi.fn()
    render(<Subject version={version} data={analysisData([analysisAnswer('unknown', 'w', false, [])], [analysisWeek('w')])} onOpenWrongNote={onOpenWrongNote} />)
    fireEvent.click(screen.getByRole('button', { name: '오답 1문항 확인하기' }))
    expect(onOpenWrongNote).toHaveBeenCalledOnce()
    expect(screen.queryByRole('region', { name: '유형 목록' })).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('짧은 기록에 판정 보류를 유지하고 없는 회차를 만들어내지 않는다', () => {
    render(<Subject data={analysisFixture} />)
    const list = screen.getByRole('region', { name: '유형 목록' })
    expect(within(list).getAllByText(/기록 부족/)).toHaveLength(3)
    expect(within(list).queryByText('우선 보완')).toBeNull()
    const details = screen.getByText('출제 회차별 변화').closest('details')!
    fireEvent.click(screen.getByText('출제 회차별 변화'))
    const records = within(details).getByRole('region', { name: '출제 회차 기록' })
    fireEvent.click(within(records).getAllByText('출제 2회 기록 모두 보기')[0])
    expect(within(records).getAllByText(/9\/17/).length).toBeGreaterThan(0)
    expect(within(records).getAllByText(/9\/24/).length).toBeGreaterThan(0)
    expect(within(records).queryByText(/3회차/)).toBeNull()
  })

  it('영역 요약에서도 같은 영역의 다중 태그 문항을 한 번만 센다', () => {
    const firstTag = analysisFixture.studentAnswers[0].exam_question!.exam_question_tag[0].concept_tag!
    const data = analysisData([analysisAnswer('multi', 'w', false, [firstTag, { ...firstTag, id: 'other', name: '다른 유형' }])], [analysisWeek('w')])
    render(<Subject data={data} />)
    fireEvent.click(screen.getByText('영역별 정답률'))
    const area = screen.getByRole('region', { name: '영역별 요약' })
    expect(within(area).getByText('1문항 중 0문항 정답')).toBeTruthy()
    expect(within(area).getByText('포함된 유형 2개')).toBeTruthy()
  })
})
