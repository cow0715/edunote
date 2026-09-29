// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AnalysisTab } from '@/app/share/[token]/tabs/analysis-tab'
import { useShareModel } from '@/app/share/[token]/use-share-model'
import type { ShareData } from '@/app/share/[token]/share-types'
import { analysisAnswer, analysisData, analysisFixture, analysisTag, analysisWeek } from '../fixtures/share-analysis'

afterEach(cleanup)

function Subject({ data, onTagClick = vi.fn(), onOpenWrongNote = vi.fn() }: {
  data: ShareData; onTagClick?: (id: string, name: string) => void; onOpenWrongNote?: () => void
}) {
  const model = useShareModel(data)
  return <AnalysisTab model={model} periodLabel="9월" onTagClick={onTagClick} onOpenWrongNote={onOpenWrongNote} />
}
describe('분석 화면', () => {
  it('추천과 관련 오답에서 동일한 실제 태그를 전달한다', () => {
    const onTagClick = vi.fn()
    render(<Subject data={analysisFixture} onTagClick={onTagClick} />)
    fireEvent.click(screen.getByRole('button', { name: '빈칸 추론 오답 확인하기' }))
    fireEvent.click(screen.getByRole('button', { name: '빈칸 추론 관련 오답 보기' }))
    expect(onTagClick.mock.calls).toEqual([['blank', '빈칸 추론'], ['blank', '빈칸 추론']])
    expect(screen.getByText('상승 67%p')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /내용 일치/ })).toBeNull()
  })
  it('기간 데이터가 바뀌면 헤드라인과 액션도 갱신한다', () => {
    const { rerender } = render(<Subject data={analysisFixture} />)
    rerender(<Subject data={analysisData([analysisAnswer('ok', 'w', true)], [analysisWeek('w')])} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('모두 맞혔어요')
    expect(screen.queryByRole('button', { name: /오답 확인하기/ })).toBeNull()
    rerender(<Subject data={analysisData([], [])} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('기록이 쌓이면')
    expect(screen.queryByText('어떤 유형에서 틀렸나요?')).toBeNull()
  })
  it('유형 미분류 오답은 전체 오답 조회로 연결한다', () => {
    const onOpenWrongNote = vi.fn()
    render(<Subject data={analysisData([analysisAnswer('a', 'w', false, [])], [analysisWeek('w')])} onOpenWrongNote={onOpenWrongNote} />)
    fireEvent.click(screen.getByRole('button', { name: '오답 1문항 확인하기' }))
    expect(onOpenWrongNote).toHaveBeenCalledOnce()
  })
  it('같은 영역에 속하는 다중 태그의 문항을 중복 계산하지 않는다', () => {
    const data = analysisData([analysisAnswer('a', 'w', false, [analysisTag, { ...analysisTag, id: 'other', name: '다른 독해 유형' }])], [analysisWeek('w')])
    render(<Subject data={data} />)
    expect(screen.getByText('1문항 중 0문항 정답')).toBeTruthy()
  })
  it('많은 유형은 더 보기로 전부 접근할 수 있다', () => {
    const answers = Array.from({ length: 10 }, (_, i) => analysisAnswer(String(i), 'w', false, [{ ...analysisTag, id: `tag${i}`, name: `유형 ${i}` }]))
    render(<Subject data={analysisData(answers, [analysisWeek('w')])} />)
    fireEvent.click(screen.getByRole('button', { name: '유형 2개 더 보기' }))
    expect(screen.getByRole('button', { name: '유형 9 오답 1문항 보기' })).toBeTruthy()
  })
})
