// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { CostOverview } from '@/app/(admin)/settings/costs/cost-overview'
import type { UsageGroup } from '@/lib/costs/model'
afterEach(cleanup)
const usage: UsageGroup[] = [
  { provider: 'claude', feature: 'week.parseAnswers', model: 'claude-sonnet-5', calls: 4, units: 4, input_tokens: 1_000_000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
  { provider: 'naver', feature: '단어시험 사진 OCR 요청', model: '', calls: 120, units: 120, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
]
describe('cost overview separates scopes and sources', () => {
  it('shows an app estimate alongside an account snapshot without adding or relabeling it as an invoice', () => {
    render(<CostOverview usage={usage} snapshots={[{ provider: 'claude', metric: 'monthly_cost', currency: 'USD', amount: 27.75, status: 'ok', updated_at: '2026-10-22T12:00:00Z' }]} loading={false} tracking failed={false} />)
    const claude = within(screen.getByRole('region', { name: 'Claude 조회액' }))
    expect(claude.getByText('US$2.00')).toBeTruthy()
    expect(claude.getByText('US$27.75')).toBeTruthy()
    expect(claude.queryByText('US$29.75')).toBeNull()
    expect(claude.getByText(/확정 청구액 아님/)).toBeTruthy()
    expect(within(screen.getByRole('region', { name: '네이버 CLOVA 조회액' })).getByText('₩360')).toBeTruthy()
    expect(screen.getByText(/월 100건 무료분/)).toBeTruthy()
  })
  it('shows unavailable data honestly and names excluded calls', () => {
    render(<CostOverview usage={[{ ...usage[0], model: 'unpriced' }]} snapshots={[]} loading={false} tracking failed={false} />)
    const claude = within(screen.getByRole('region', { name: 'Claude 조회액' }))
    expect(claude.getByText(/4회는 계산 제외/)).toBeTruthy()
    expect(claude.queryByText('US$0.00')).toBeNull()
    expect(within(screen.getByRole('region', { name: 'GCP 조회액' })).getByText('조회값 없음')).toBeTruthy()
  })
})
