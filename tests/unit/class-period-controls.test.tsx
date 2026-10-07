// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ClassPeriodControls } from '@/components/classes/class-period-controls'
import type { ClassPeriod, Week } from '@/lib/types'

const periods = [
  { id: 'old', class_id: 'class', label: '1학기 기말', semester: 1, exam_type: 'final', start_date: '2026-05-01', end_date: '2026-07-31', is_current: false, sort_order: 1 },
  { id: 'new', class_id: 'class', label: '2학기 중간', semester: 2, exam_type: 'midterm', start_date: '2026-08-01', end_date: null, is_current: true, sort_order: 2 },
] as ClassPeriod[]
const weeks = [
  { id: 'one', class_id: 'class', start_date: '2026-07-31' },
  { id: 'two', class_id: 'class', start_date: '2026-08-01' },
] as Week[]
function props() {
  return { className: '예시고 2학년', periods, weeks, value: 'new', onValueChange: vi.fn(), onCreate: vi.fn(), onEdit: vi.fn(), onSetDefault: vi.fn(), onDelete: vi.fn(), onRetry: vi.fn() }
}
beforeEach(() => {
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

describe('class period workspace', () => {
  it('viewing an old period invokes only the view callback and retains the shared default', async () => {
    const handlers = props()
    const view = render(<ClassPeriodControls {...handlers} />)
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('option', { name: '1학기 기말' }))
    expect(handlers.onValueChange).toHaveBeenCalledWith('old')
    expect(handlers.onSetDefault).not.toHaveBeenCalled()
    expect(handlers.onEdit).not.toHaveBeenCalled()
    view.rerender(<ClassPeriodControls {...handlers} value="old" />)
    expect(screen.getByText('학부모 공유 기본은 2학기 중간')).toBeTruthy()
    expect(screen.getByText(/수업 1회/)).toBeTruthy()
  })
  it('protects the shared default from deletion but lets a past period be designated explicitly', async () => {
    const handlers = props()
    render(<ClassPeriodControls {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: '기간 관리' }))
    fireEvent.keyDown(screen.getByRole('button', { name: '2학기 중간 관리' }), { key: 'Enter' })
    expect((await screen.findByRole('menuitem', { name: '기간 삭제' })).getAttribute('aria-disabled')).toBe('true')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    fireEvent.keyDown(screen.getByRole('button', { name: '1학기 기말 관리' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: '공유 기본으로 지정' }))
    expect(handlers.onSetDefault).toHaveBeenCalledWith(periods[0])
    expect(handlers.onValueChange).not.toHaveBeenCalled()
  })
  it('shows an actionable error rather than pretending the period list is empty', () => {
    const handlers = props()
    render(<ClassPeriodControls {...handlers} periods={[]} error />)
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(handlers.onRetry).toHaveBeenCalledOnce()
  })
})
