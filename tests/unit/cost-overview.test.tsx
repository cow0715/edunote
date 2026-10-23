// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { CostOverview } from '@/app/(admin)/settings/costs/cost-overview'
import { costReportFixture } from '../fixtures/cost-report'
afterEach(cleanup)
describe('service cost workspace', () => {
  it('puts cost totals first and shows Supabase quotas only when selected', () => {
    const { container } = render(<CostOverview usage={[]} snapshots={[]} loading={false} tracking failed={false} />)
    const summary = screen.getByLabelText('이번 달 비용 요약')
    const table = screen.getByRole('list', { name: '서비스별 사용량과 비용' })
    expect(summary.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector('.cost-visual')?.firstElementChild?.contains(summary)).toBe(true)
    expect(screen.queryByRole('region', { name: 'Supabase 무료 한도' })).toBeNull()
    const button = within(table).getByRole('button', { name: 'Supabase' })
    fireEvent.click(button)
    expect(screen.getByRole('region', { name: 'Supabase 무료 한도' })).toBeTruthy()
    fireEvent.click(button)
    expect(screen.queryByRole('region', { name: 'Supabase 무료 한도' })).toBeNull()
    expect(within(table).getAllByRole('button')).toHaveLength(6)
  })
  it('keeps all six services visible and opens one detail with usage and separate cost sources', () => {
    render(<CostOverview usage={[]} report={costReportFixture()} snapshots={[
      { provider: 'gcp', metric: 'worker_executions', currency: 'COUNT', amount: 15, status: 'ok', updated_at: '2026-10-22T12:00:00Z' },
      { provider: 'solapi', metric: 'balance', currency: 'KRW', amount: 19733, status: 'ok', updated_at: '2026-10-22T12:00:00Z' },
    ]} loading={false} tracking failed={false} />)
    const list = within(screen.getByRole('list', { name: '서비스별 사용량과 비용' }))
    expect(list.getAllByRole('listitem')).toHaveLength(6)
    expect(screen.queryByRole('table', { name: '서비스별 사용량과 비용' })).toBeNull()
    for (const card of list.getAllByRole('button')) {
      expect(within(card).getByText(/실제 비용 ·/)).toBeTruthy()
      expect(within(card).getByText('예상 비용 · 청구 전')).toBeTruthy()
    }
    expect(list.getByText('15회 실행')).toBeTruthy()
    for (const name of ['Claude', '네이버 CLOVA', 'GCP', 'Supabase', 'SOLAPI', 'Vercel']) expect(list.getByRole('button', { name })).toBeTruthy()
    fireEvent.click(list.getByRole('button', { name: 'GCP' }))
    expect(screen.getByRole('region', { name: 'GCP 상세' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Claude 상세' })).toBeNull()
    expect(screen.getByText(/실행 시간은 과금 CPU 시간이 아니며/)).toBeTruthy()
    fireEvent.click(list.getByRole('button', { name: 'SOLAPI' }))
    expect(within(screen.getByRole('region', { name: 'SOLAPI 상세' })).queryByText('₩19,733')).toBeNull()
    expect(screen.getAllByText('미수신 비용·잔액 제외', { exact: false })).toHaveLength(2)
  })
  it('uses a labeled console fallback only until the automatic GCP amount arrives', () => {
    const snapshots = [{ provider: 'gcp', metric: 'console_monthly_cost', currency: 'KRW', amount: 20, status: 'ok', updated_at: '2026-10-22T12:00:00Z' }]
    const props = { usage: [], snapshots, loading: false, tracking: true, failed: false }
    const view = render(<CostOverview {...props} />)
    expect(screen.getByText('콘솔 확인 · 자동 수신 대기')).toBeTruthy()
    view.rerender(<CostOverview {...props} snapshots={[...snapshots, { ...snapshots[0], metric: 'monthly_cost', amount: 21 }]} />)
    expect(screen.queryByText('콘솔 확인 · 자동 수신 대기')).toBeNull()
    expect(within(screen.getByRole('list', { name: '서비스별 사용량과 비용' })).getByText('₩21')).toBeTruthy()
    expect(screen.queryByText('₩41')).toBeNull()
  })
  it('shows provider SMS counts and spend while keeping Supabase plan and old invoice outside monthly totals', () => {
    const snapshot = { provider: 'solapi', metric: 'monthly_cost', currency: 'KRW', amount: 12652.2, status: 'ok', updated_at: '2026-10-23T00:00:00Z' }
    render(<CostOverview usage={[]} snapshots={[snapshot, { ...snapshot, metric: 'sms_succeeded', currency: 'COUNT', amount: 330 }, { ...snapshot, provider: 'supabase', metric: 'plan_free', currency: 'USD', amount: 0 }, { ...snapshot, provider: 'supabase', metric: 'invoice_last_amount', currency: 'USD', amount: 999 }, { ...snapshot, provider: 'supabase', metric: 'monthly_cost', currency: 'USD', amount: 999 }]} loading={false} tracking failed={false} />)
    const table = within(screen.getByRole('list', { name: '서비스별 사용량과 비용' }))
    expect(table.getByText('330건 문자 발송 성공')).toBeTruthy()
    expect(table.getByText('₩12,652.2')).toBeTruthy()
    expect(table.getByText('Free')).toBeTruthy()
    fireEvent.click(table.getByRole('button', { name: 'Supabase' }))
    const detail = within(screen.getByRole('region', { name: 'Supabase 상세' }))
    expect(detail.getByText('현재 DB 상태')).toBeTruthy()
    expect(detail.queryByText(/청구서|청구주기|업체 월 조회액/)).toBeNull()
    expect(screen.queryByText(/US\$999.00/)).toBeNull()
    expect(screen.queryByText('US$999.00', { exact: true })).toBeNull()
  })

})
